// SPDX-License-Identifier: GPL-2.0

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {Kind, State, Timer} from './lib/timer.js';
import {shouldAutoStart, isBreak} from './lib/schedule.js';
import {fromSettingsValues} from './lib/state.js';
import {dayKey, makeRecords, todayCount} from './lib/journal.js';
import {appendRecords, journalPath, readRecords} from './lib/journalfile.js';
import {GnomatoIndicator} from './ui/indicator.js';

const INTERVAL_KEYS = ['pomodoro-seconds', 'short-break-seconds', 'long-break-seconds'];

export default class GnomatoExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._soundSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.sound'});
        this._tickId = 0;
        this._signalIds = [];

        this._timer = new Timer({
            durations: this._durations(),
            setSize: this._settings.get_int('set-size'),
            now: {wallMs: () => Math.floor(GLib.get_real_time() / 1000)},
        });
        this._timer.restore(fromSettingsValues(this._readPersisted()));

        this._indicator = new GnomatoIndicator({
            onToggle: () => this._toggle(),
            onSkip: () => this._skip(),
            onReset: () => this._reset(),
            onPreferences: () => this.openPreferences(),
        });
        Main.panel.addToStatusArea(this.uuid, this._indicator);

        Main.wm.addKeybinding('toggle-keybinding', this._settings,
            Meta.KeyBindingFlags.NONE, Shell.ActionMode.ALL, () => this._toggle());
        Main.wm.addKeybinding('skip-keybinding', this._settings,
            Meta.KeyBindingFlags.NONE, Shell.ActionMode.ALL, () => this._skip());

        for (const key of INTERVAL_KEYS) {
            this._signalIds.push(this._settings.connect(`changed::${key}`, () => {
                this._timer.setDurations(this._durations());
                // A length changed while the popup sits open in Idle: it shows
                // the plan of the next interval, so it has to be redrawn.
                this._syncUI();
            }));
        }
        this._signalIds.push(this._settings.connect('changed::set-size', () => {
            this._timer.setSetSize(this._settings.get_int('set-size'));
            this._syncUI();
        }));

        this._syncUI();
        this._syncTickSource();
        this._refreshTodayCount();

        // Catches up with an interval whose deadline passed while the extension
        // was not running: this is what a shell restart, a screen lock and a
        // suspend all look like from here.
        this._onTick();
    }

    disable() {
        if (this._tickId) {
            GLib.source_remove(this._tickId);
            this._tickId = 0;
        }

        Main.wm.removeKeybinding('toggle-keybinding');
        Main.wm.removeKeybinding('skip-keybinding');

        for (const id of this._signalIds)
            this._settings.disconnect(id);
        this._signalIds = [];

        this._indicator?.destroy();
        this._indicator = null;

        // `g_settings_sync()` is a function of Gio.Settings, not a method of the
        // settings object: flushing the pending writes is a global operation.
        Gio.Settings.sync();
        this._settings = null;
        this._soundSettings = null;
        this._timer = null;
    }

    _durations() {
        return {
            [Kind.POMODORO]: this._settings.get_int('pomodoro-seconds') * 1000,
            [Kind.SHORT_BREAK]: this._settings.get_int('short-break-seconds') * 1000,
            [Kind.LONG_BREAK]: this._settings.get_int('long-break-seconds') * 1000,
        };
    }

    _readPersisted() {
        return {
            timerState: this._settings.get_string('timer-state'),
            timerKind: this._settings.get_string('timer-kind'),
            timerSlot: this._settings.get_int('timer-slot'),
            timerEndWallMs: this._settings.get_int64('timer-end-wall-ms'),
            timerRemainingMs: this._settings.get_int64('timer-remaining-ms'),
            timerStartedWallMs: this._settings.get_int64('timer-started-wall-ms'),
        };
    }

    _persist() {
        const persisted = this._timer.toPersisted();
        this._settings.set_string('timer-state', persisted.state);
        this._settings.set_string('timer-kind', persisted.kind);
        this._settings.set_int('timer-slot', persisted.slot);
        this._settings.set_int64('timer-end-wall-ms', persisted.endWallMs);
        this._settings.set_int64('timer-remaining-ms', persisted.remainingMs);
        this._settings.set_int64('timer-started-wall-ms', persisted.startedWallMs);
    }

    _toggle() {
        if (this._timer.state === State.RUNNING)
            this._timer.pause();
        else if (this._timer.state === State.PAUSED)
            this._timer.resume();
        else
            this._timer.start();
        this._afterTransition();
    }

    _skip() {
        this._writeRecords(this._timer.skip());
        this._afterTransition();
    }

    _reset() {
        this._writeRecords(this._timer.reset());
        this._afterTransition();
    }

    /**
     * The journal is history, not the timer's memory: a failed write is logged
     * and the countdown carries on.
     */
    _writeRecords(closed) {
        if (!closed)
            return;
        if (!appendRecords(journalPath(), makeRecords(closed)))
            return;
        this._refreshTodayCount();
    }

    _refreshTodayCount() {
        const {records} = readRecords(journalPath());
        const today = dayKey(Math.floor(GLib.get_real_time() / 1000));
        this._indicator.setTodayCount(todayCount(records, today));
    }

    /** Persisting, retiming the tick source and repainting, in that order. */
    _afterTransition() {
        this._persist();
        this._syncTickSource();
        this._syncUI();
    }

    _syncUI() {
        this._indicator.setInterval({
            state: this._timer.state,
            kind: this._timer.kind,
            remainingMs: this._timer.remainingMs,
            plannedMs: this._timer.plannedMs,
            slot: this._timer.slot,
            setSize: this._timer.setSize,
        });
    }

    /** A second-by-second source exists only while an interval is running. */
    _syncTickSource() {
        const running = this._timer.state === State.RUNNING;
        if (running && !this._tickId) {
            this._tickId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
                this._onTick();
                return GLib.SOURCE_CONTINUE;
            });
        } else if (!running && this._tickId) {
            GLib.source_remove(this._tickId);
            this._tickId = 0;
        }
    }

    _onTick() {
        const event = this._timer.tick();
        if (!event) {
            if (this._timer.state === State.RUNNING)
                this._indicator.setRemaining(this._timer.remainingMs);
            return;
        }

        this._announce(event);
        this._writeRecords(event.record);
        if (this._shouldAutoStart())
            this._timer.start();
        this._afterTransition();
    }

    /**
     * One banner per finished interval, plus the theme sound. A restored
     * completion happened while the timer was not running, so it says so.
     * A skipped or reset interval gets neither: it was not a transition the
     * user could miss.
     */
    _announce(event) {
        const isBreakKind = isBreak(event.record.kind);
        let title;
        let body;

        if (event.restored) {
            title = isBreakKind
                ? _('Break ended while you were away')
                : _('Pomodoro finished while you were away');
            body = isBreakKind
                ? _('Ready for the next pomodoro.')
                : _('The journal has been updated.');
        } else {
            title = isBreakKind ? _('Break over') : _('Pomodoro finished');
            body = isBreakKind ? _('Back to work.') : _('Time for a break.');
        }

        Main.notify(title, body);
        this._playSound();
    }

    /** The sound comes from the theme, gated by both our switch and the system one. */
    _playSound() {
        if (!this._settings.get_boolean('sound-enabled'))
            return;
        if (!this._soundSettings.get_boolean('event-sounds'))
            return;

        try {
            global.display.get_sound_player().play_from_theme('complete', _('Pomodoro timer'), null);
        } catch (e) {
            console.error(`gnomato: cannot play the sound: ${e.message}`);
        }
    }

    _shouldAutoStart() {
        return shouldAutoStart(this._timer.kind, {
            autoStartBreaks: this._settings.get_boolean('auto-start-breaks'),
            autoStartWork: this._settings.get_boolean('auto-start-work'),
        });
    }
}
