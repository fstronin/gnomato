// SPDX-License-Identifier: GPL-2.0

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {formatRemaining} from '../lib/format.js';

const ICON_NAME = 'alarm-symbolic';
const PAUSED_ICON_NAME = 'media-playback-pause-symbolic';

/**
 * The panel button: an icon that is always there, a countdown that is there only
 * while an interval runs, and the menu that drives the timer.
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

        this._onToggle = onToggle;
        this._onSkip = onSkip;
        this._onReset = onReset;
        this._onPreferences = onPreferences;

        const box = new St.BoxLayout({style_class: 'panel-status-menu-box'});
        this._icon = new St.Icon({
            icon_name: ICON_NAME,
            style_class: 'system-status-icon',
        });
        this._label = new St.Label({y_align: Clutter.ActorAlign.CENTER});
        this._pausedIcon = new St.Icon({
            icon_name: PAUSED_ICON_NAME,
            style_class: 'system-status-icon',
        });
        box.add_child(this._icon);
        box.add_child(this._label);
        box.add_child(this._pausedIcon);
        this.add_child(box);

        this._toggleItem = new PopupMenu.PopupMenuItem(_('Start'));
        this._toggleItem.connect('activate', () => this._onToggle());
        this.menu.addMenuItem(this._toggleItem);

        this._skipItem = new PopupMenu.PopupMenuItem(_('Skip'));
        this._skipItem.connect('activate', () => this._onSkip());
        this.menu.addMenuItem(this._skipItem);

        this._resetItem = new PopupMenu.PopupMenuItem(_('Reset'));
        this._resetItem.connect('activate', () => this._onReset());
        this.menu.addMenuItem(this._resetItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._todayItem = new PopupMenu.PopupMenuItem(_('Today: %d').format(0));
        this._todayItem.reactive = false;
        this._todayItem.can_focus = false;
        this.menu.addMenuItem(this._todayItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._prefsItem = new PopupMenu.PopupMenuItem(_('Preferences'));
        this._prefsItem.connect('activate', () => this._onPreferences());
        this.menu.addMenuItem(this._prefsItem);

        this.setRemaining(null);
        this.setPaused(false);
        this.setIntervalActionsEnabled(false);
    }

    /**
     * Skip and Reset have nothing to act on while no interval is open, so they
     * are greyed out instead of silently doing nothing.
     */
    setIntervalActionsEnabled(enabled) {
        this._skipItem.reactive = enabled;
        this._resetItem.reactive = enabled;
    }

    /** @param {number|null} ms remaining time, or null while the timer is idle */
    setRemaining(ms) {
        if (ms === null) {
            this._label.visible = false;
            return;
        }
        this._label.text = formatRemaining(ms);
        this._label.visible = true;
    }

    setPaused(paused) {
        this._pausedIcon.visible = paused;
    }

    setToggleLabel(text) {
        this._toggleItem.label.text = text;
    }

    setTodayCount(count) {
        this._todayItem.label.text = _('Today: %d').format(count);
    }
});
