// SPDX-License-Identifier: GPL-2.0

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {formatRemaining} from '../lib/format.js';
import {State} from '../lib/timer.js';
import {GnomatoPopup} from './popup.js';

const ICON_NAME = 'alarm-symbolic';
const PAUSED_ICON_NAME = 'media-playback-pause-symbolic';

/**
 * The panel button, with two surfaces: a popup on the left click that shows the
 * interval and drives it, and the ordinary menu on the right click, which keeps
 * the day's count and the way into the preferences.
 *
 * The panel row itself is unchanged: the icon is always there, the countdown
 * only while an interval runs, the pause mark while it is paused.
 */
export const GnomatoIndicator = GObject.registerClass(
class GnomatoIndicator extends PanelMenu.Button {
    /**
     * @param {object} callbacks
     * @param {Function} callbacks.onToggle start, pause or resume
     * @param {Function} callbacks.onSkip finish the current interval early
     * @param {Function} callbacks.onReset rewind the current interval
     * @param {Function} callbacks.onPreferences open the preferences window
     */
    _init({onToggle, onSkip, onReset, onPreferences}) {
        super._init(0.0, 'Gnomato', false);

        this._onPreferences = onPreferences;

        const box = new St.BoxLayout({style_class: 'panel-status-menu-box'});
        box.add_child(new St.Icon({
            icon_name: ICON_NAME,
            style_class: 'system-status-icon',
        }));
        this._label = new St.Label({y_align: Clutter.ActorAlign.CENTER});
        this._pausedIcon = new St.Icon({
            icon_name: PAUSED_ICON_NAME,
            style_class: 'system-status-icon',
        });
        box.add_child(this._label);
        box.add_child(this._pausedIcon);
        this.add_child(box);

        this._popup = new GnomatoPopup(this, {onToggle, onSkip, onReset});
        this.setMenu(this._popup);

        // The right click gets the ordinary menu, without controls. The panel
        // only knows about `indicator.menu`, which is the popup, so this one is
        // registered with the menu manager by hand to get a grab, Escape and
        // closing on a click outside.
        this._rightMenu = new PopupMenu.PopupMenu(this, 0.0, St.Side.TOP);
        this._todayItem = new PopupMenu.PopupMenuItem(_('Today: %d').format(0));
        this._todayItem.reactive = false;
        this._todayItem.can_focus = false;
        this._rightMenu.addMenuItem(this._todayItem);
        this._rightMenu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const prefsItem = new PopupMenu.PopupMenuItem(_('Preferences'));
        prefsItem.connect('activate', () => this._onPreferences());
        this._rightMenu.addMenuItem(prefsItem);

        // `setMenu()` is the only place the shell marks a menu as a panel one,
        // and it never sees this menu.
        this._rightMenu.actor.add_style_class_name('panel-menu');
        Main.uiGroup.add_child(this._rightMenu.actor);
        this._rightMenu.actor.hide();
        Main.panel.menuManager.addMenu(this._rightMenu);

        // The built-in gesture of the button answers every mouse button, so the
        // surfaces cannot be told apart by adding a gesture: it is disarmed and
        // replaced by two of our own.
        this._disarmPanelGesture();
        this._addClickGesture(Clutter.BUTTON_PRIMARY, () => this._popup.toggle());
        this._addClickGesture(Clutter.BUTTON_SECONDARY, () => this._rightMenu.toggle());

        this._label.visible = false;
        this._pausedIcon.visible = false;
    }

    /**
     * The panel row and the popup, from one reading of the timer.
     *
     * @param {object} interval
     * @param {string} interval.state IDLE, RUNNING or PAUSED
     * @param {string} interval.kind POMODORO, SHORT_BREAK or LONG_BREAK
     * @param {number} interval.remainingMs while idle, the length still ahead
     * @param {number} interval.plannedMs what the interval is measured against
     * @param {number} interval.slot pomodoro slots already consumed
     * @param {number} interval.setSize size of the running set
     */
    setInterval(interval) {
        const running = interval.state !== State.IDLE;

        this._label.visible = running;
        if (running)
            this._label.text = formatRemaining(interval.remainingMs);
        this._pausedIcon.visible = interval.state === State.PAUSED;

        this._popup.setInterval(interval);
    }

    /** The per-second update: the countdown on the panel and in the popup. */
    setRemaining(remainingMs) {
        this._label.text = formatRemaining(remainingMs);
        this._popup.setRemaining(remainingMs);
    }

    setTodayCount(count) {
        this._todayItem.label.text = _('Today: %d').format(count);
    }

    _onDestroy() {
        this._rightMenu?.destroy();
        this._rightMenu = null;
        super._onDestroy();
    }

    /**
     * The button's own gesture is found through the public action list, by the
     * one property that reads "any button"; the private field is left alone.
     */
    _disarmPanelGesture() {
        for (const action of this.get_actions()) {
            if (action instanceof Clutter.ClickGesture && action.required_button === 0)
                action.set_enabled(false);
        }
    }

    _addClickGesture(button, callback) {
        const gesture = new Clutter.ClickGesture({
            recognize_on_press: true,
            required_button: button,
        });
        gesture.connect('recognize', callback);
        this.add_action(gesture);
    }
});
