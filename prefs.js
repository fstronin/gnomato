// SPDX-License-Identifier: GPL-2.0

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';

// The preferences window runs in the D-Bus activated gjs service, whose bundle
// ships its own ExtensionPreferences — the shell's own bundle has no prefs.js.
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {journalPath} from './lib/journalfile.js';

const MINUTES_MIN = 1;
const MINUTES_MAX = 180;
const SET_SIZE_MIN = 1;
const SET_SIZE_MAX = 12;

export default class GnomatoPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const page = new Adw.PreferencesPage();
        window.add(page);

        const durations = new Adw.PreferencesGroup({
            title: this.gettext('Durations'),
            description: this.gettext('Whole minutes, from 1 to 180.'),
        });
        page.add(durations);
        durations.add(this._minutesRow(settings, 'pomodoro-seconds',
            this.gettext('Pomodoro'), this.gettext('Length of one work interval')));
        durations.add(this._minutesRow(settings, 'short-break-seconds',
            this.gettext('Short break'), this.gettext('Break after a pomodoro')));
        durations.add(this._minutesRow(settings, 'long-break-seconds',
            this.gettext('Long break'), this.gettext('Break that ends a set')));

        const setGroup = new Adw.PreferencesGroup({title: this.gettext('Set')});
        page.add(setGroup);
        setGroup.add(this._countRow(settings, 'set-size',
            this.gettext('Pomodoros per set'),
            this.gettext('How many pomodoros come before a long break'),
            SET_SIZE_MIN, SET_SIZE_MAX));

        const behaviour = new Adw.PreferencesGroup({title: this.gettext('Behaviour')});
        page.add(behaviour);
        behaviour.add(this._switchRow(settings, 'auto-start-breaks',
            this.gettext('Start breaks automatically')));
        behaviour.add(this._switchRow(settings, 'auto-start-work',
            this.gettext('Start pomodoros automatically')));
        behaviour.add(this._switchRow(settings, 'sound-enabled',
            this.gettext('Sound when an interval ends')));

        const keys = new Adw.PreferencesGroup({
            title: this.gettext('Keys'),
            // Adw renders these as Pango markup, and an accelerator looks like a tag.
            description: GLib.markup_escape_text(
                this.gettext('Accelerator such as <Control><Alt>p. Leave empty to disable the shortcut.'), -1),
        });
        page.add(keys);
        keys.add(this._acceleratorRow(settings, 'toggle-keybinding',
            this.gettext('Start or pause')));
        keys.add(this._acceleratorRow(settings, 'skip-keybinding',
            this.gettext('Skip the current interval')));

        const data = new Adw.PreferencesGroup({title: this.gettext('Data')});
        page.add(data);
        data.add(new Adw.ActionRow({
            title: this.gettext('Journal'),
            subtitle: journalPath(),
        }));
    }

    _minutesRow(settings, key, title, subtitle) {
        return this._spinRow({
            settings, key, title, subtitle,
            lower: MINUTES_MIN, upper: MINUTES_MAX,
            toDisplay: seconds => seconds / 60,
            toSetting: minutes => Math.round(minutes) * 60,
        });
    }

    _countRow(settings, key, title, subtitle, lower, upper) {
        return this._spinRow({
            settings, key, title, subtitle, lower, upper,
            toDisplay: value => value,
            toSetting: value => Math.round(value),
        });
    }

    /**
     * `Adw.SpinRow` owns a `Gtk.Adjustment`, so the conversion between what the
     * row shows (minutes) and what the schema stores (seconds) lives on the
     * adjustment's own signal.
     */
    _spinRow({settings, key, title, subtitle, lower, upper, toDisplay, toSetting}) {
        const adjustment = new Gtk.Adjustment({
            lower,
            upper,
            step_increment: 1,
            page_increment: 5,
            value: toDisplay(settings.get_int(key)),
        });
        adjustment.connect('value-changed', () => {
            const next = toSetting(adjustment.value);
            if (next !== settings.get_int(key))
                settings.set_int(key, next);
        });
        return new Adw.SpinRow({
            title,
            subtitle,
            adjustment,
            digits: 0,
            climb_rate: 1,
        });
    }

    _switchRow(settings, key, title) {
        const row = new Adw.SwitchRow({title});
        settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
        return row;
    }

    /**
     * Accelerators are committed on Enter or the apply button, not on every
     * keystroke: a half-typed `<Control><Alt>` is not a mistake, it is a
     * work in progress. An unparseable value is refused and flagged instead of
     * written into the schema.
     */
    _acceleratorRow(settings, key, title) {
        const row = new Adw.EntryRow({title, show_apply_button: true});
        row.text = settings.get_strv(key)[0] ?? '';

        row.connect('apply', () => {
            const accelerator = row.text.trim();
            if (accelerator === '') {
                settings.set_strv(key, []);
                row.remove_css_class('error');
                return;
            }

            const [parses] = Gtk.accelerator_parse(accelerator);
            if (parses) {
                settings.set_strv(key, [accelerator]);
                row.remove_css_class('error');
            } else {
                row.add_css_class('error');
            }
        });

        return row;
    }
}
