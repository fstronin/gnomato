// SPDX-License-Identifier: GPL-2.0
// Throwaway extension for tools/cue-probe. It patches the sound player, drives
// the extension under test through interval boundaries and writes a report of
// every cue id that reached the player, with its own checks. It is not part of
// the package and lives in the throwaway shell only.
//
// The interval lengths stay inside the schema range (60 s), so completions are
// forced by moving the open interval's deadline into the past: the boundary
// itself is the timer's business and is covered by the unit tests.

import GLib from 'gi://GLib';
import Meta from 'gi://Meta';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const ROOT = GLib.getenv('GN_CUE_ROOT') ?? '/tmp/gnomato-cue-probe';
const UUID = GLib.getenv('GN_CUE_UUID') ?? 'gnomato@fstronin.github.io';
const REPORT = `${ROOT}/report.json`;
const WAIT_MS = 20000;

export default class CueProbeExtension extends Extension {
    enable() {
        this._cues = [];
        this._snapshots = [];
        this._checks = [];
        this._silenceBaseline = 0;
        this._step = 'boot';
        this._patchSoundPlayer();
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            // The shell enables extensions a moment after it is up.
            this._waitForActive(Date.now());
            return GLib.SOURCE_REMOVE;
        });
    }

    disable() {}

    /** Every call the extension makes is recorded, and still reaches the real player. */
    _patchSoundPlayer() {
        const original = Meta.Display.prototype.get_sound_player;
        const probe = this;
        Meta.Display.prototype.get_sound_player = function () {
            const player = original.call(this);
            return {
                play_from_theme(eventId, description, cancellable) {
                    probe._cues.push({step: probe._step, eventId});
                    return player.play_from_theme(eventId, description, cancellable);
                },
                play_from_file(file, description, cancellable) {
                    probe._cues.push({step: probe._step, file: file?.get_path?.()});
                    return player.play_from_file(file, description, cancellable);
                },
            };
        };
    }

    _waitForActive(startedAt) {
        try {
            const state = Main.extensionManager.lookup(UUID);
            // The state object exists only once the shell has enabled the
            // extension, which happens a moment after the shell is up.
            if (state?.stateObj?._settings) {
                this._drive();
                return;
            }
            if (Date.now() - startedAt > WAIT_MS) {
                this._finish(`the extension never became active: ${JSON.stringify({
                    state: state?.state ?? null,
                    error: state?.error ?? null,
                    path: state?.path ?? null,
                    enabled: global.settings.get_strv('enabled-extensions'),
                })}`);
                return;
            }
        } catch (e) {
            this._finish(`the wait threw: ${e.message}\n${e.stack}`);
            return;
        }
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
            this._waitForActive(startedAt);
            return GLib.SOURCE_REMOVE;
        });
    }

    _drive() {
        const ext = Main.extensionManager.lookup(UUID)?.stateObj ?? null;
        if (!ext?._settings) {
            this._finish('the extension has no state object to drive');
            return;
        }
        this._ext = ext;

        const settings = ext._settings;
        settings.set_boolean('sound-enabled', true);
        settings.set_boolean('auto-start-breaks', true);
        settings.set_boolean('auto-start-work', false);
        settings.set_int('pomodoro-seconds', 60);
        settings.set_int('short-break-seconds', 60);

        this._snapshot('settings applied');
        this._check('the schema accepted the settings used here',
            () => settings.get_int('pomodoro-seconds') === 60 &&
                settings.get_int('short-break-seconds') === 60,
            `pomodoro=${settings.get_int('pomodoro-seconds')}s break=${settings.get_int('short-break-seconds')}s`);

        this._queue = [
            ['start the pomodoro by hand', 0, () => {
                const before = this._cues.length;
                this._ext._toggle();
                this._snapshot('pomodoro started');
                this._check('a hand-started pomodoro stays silent',
                    () => this._cues.length === before, `${before} -> ${this._cues.length} cues`);
                this._check('the pomodoro is running',
                    () => this._ext._timer.state === 'RUNNING' && this._ext._timer.kind === 'POMODORO');
            }],
            ['arm the pomodoro deadline', 300, () => this._expire()],
            ['the pomodoro completes', 1700, () => {
                this._snapshot('after the pomodoro');
                this._check('the completion cues the incoming break',
                    () => this._lastCue() === 'complete');
                this._check('the break auto-started',
                    () => this._ext._timer.state === 'RUNNING' && this._ext._timer.kind === 'SHORT_BREAK');
            }],
            ['arm the break deadline', 300, () => this._expire()],
            ['the break completes', 1700, () => {
                this._snapshot('after the break');
                this._check('the completion cues the incoming pomodoro',
                    () => this._lastCue() === 'alarm-clock-elapsed');
                this._check('the pomodoro did not auto-start, so the timer is idle on it',
                    () => this._ext._timer.state === 'IDLE' && this._ext._timer.kind === 'POMODORO');
            }],
            ['start that very pomodoro by hand', 300, () => {
                const before = this._cues.length;
                this._ext._toggle();
                this._snapshot('pomodoro started after the completion');
                this._check('a hand-started pomodoro stays silent',
                    () => this._cues.length === before, `${before} -> ${this._cues.length} cues`);
            }],
            ['pause it', 300, () => {
                const before = this._cues.length;
                this._ext._toggle();
                this._snapshot('paused');
                this._check('a pause is silent', () => this._cues.length === before);
            }],
            ['resume it', 300, () => {
                const before = this._cues.length;
                this._ext._toggle();
                this._snapshot('resumed');
                this._check('a resume is silent', () => this._cues.length === before);
                this._check('the resume kept the count running',
                    () => this._ext._timer.state === 'RUNNING');
            }],
            ['skip it', 300, () => {
                const before = this._cues.length;
                this._ext._skip();
                this._snapshot('skipped');
                this._check('a skip is silent', () => this._cues.length === before);
                this._check('the skip advanced to a break',
                    () => this._ext._timer.state === 'IDLE' && this._ext._timer.kind === 'SHORT_BREAK');
            }],
            ['start that break by hand', 300, () => {
                const before = this._cues.length;
                this._ext._toggle();
                this._snapshot('break started');
                this._check('a hand-started break stays silent',
                    () => this._cues.length === before, `${before} -> ${this._cues.length} cues`);
            }],
            ['arm the silenced break deadline', 300, () => {
                this._silenceBaseline = this._cues.length;
                this._ext._settings.set_boolean('sound-enabled', false);
                this._expire();
            }],
            ['the sound switch silences a completion', 1700, () => {
                this._snapshot('completed with the sound off');
                this._check('the sound switch silenced the completion',
                    () => this._cues.length === this._silenceBaseline,
                    `${this._silenceBaseline} -> ${this._cues.length} cues`);
                this._check('the pomodoro is idle after the silenced completion',
                    () => this._ext._timer.state === 'IDLE' && this._ext._timer.kind === 'POMODORO');
            }],
            ['the sound switch back on', 300, () => {
                this._ext._settings.set_boolean('sound-enabled', true);
                const before = this._cues.length;
                this._ext._toggle();
                this._snapshot('pomodoro started with the sound back on');
                this._check('a hand-started pomodoro stays silent after the switch',
                    () => this._cues.length === before, `${before} -> ${this._cues.length} cues`);
            }],
            ['arm the last pomodoro deadline', 300, () => this._expire()],
            ['the pomodoro completes with the sound back on', 1700, () => {
                this._snapshot('after the last completion');
                this._check('the completion sounds again once the switch is back on',
                    () => this._lastCue() === 'complete');
            }],
        ];
        this._next();
    }

    /** Moves the open interval's deadline into the past; the next tick closes it. */
    _expire() {
        const open = this._ext._timer._open;
        if (!open || open.endWallMs === null)
            throw new Error('nothing running to expire');
        open.endWallMs = Math.floor(GLib.get_real_time() / 1000) - 1;
    }

    _next() {
        if (this._queue.length === 0) {
            this._finish(null);
            return;
        }
        const [step, delay, run] = this._queue.shift();
        this._step = step;
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
            try {
                run();
            } catch (e) {
                this._checks.push({name: `${step} ran`, pass: false, detail: `threw: ${e.message}`});
            }
            this._next();
            return GLib.SOURCE_REMOVE;
        });
    }

    _lastCue() {
        return this._cues.length === 0 ? null : this._cues[this._cues.length - 1].eventId;
    }

    _check(name, predicate, detail = null) {
        let pass = false;
        try {
            pass = predicate();
        } catch (e) {
            this._checks.push({name, pass: false, detail: `threw: ${e.message}`});
            return;
        }
        this._checks.push({name, pass, detail});
    }

    _snapshot(label) {
        const timer = this._ext._timer;
        this._snapshots.push({
            label,
            state: timer?.state ?? null,
            kind: timer?.kind ?? null,
            slot: timer?.slot ?? null,
            cues: this._cues.length,
        });
    }

    _finish(error) {
        const failed = this._checks.filter(check => !check.pass);
        const text = JSON.stringify({
            error,
            verdict: error ? 'ERROR' : `${this._checks.length - failed.length}/${this._checks.length} checks passed`,
            checks: this._checks,
            cues: this._cues,
            snapshots: this._snapshots,
        }, null, 2);
        try {
            GLib.file_set_contents(REPORT, text);
        } catch (e) {
            console.error(`cue probe: cannot write ${REPORT}: ${e.message}`);
        }
    }
}
