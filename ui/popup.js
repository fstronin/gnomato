// SPDX-License-Identifier: GPL-2.0

import cairo from 'gi://cairo';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {formatRemaining} from '../lib/format.js';
import {ringFraction, rowFits, setProgress} from '../lib/progress.js';
import {Kind, State} from '../lib/timer.js';

const PLAY_ICON_NAME = 'media-playback-start-symbolic';
const PAUSE_ICON_NAME = 'media-playback-pause-symbolic';
const SKIP_ICON_NAME = 'media-skip-forward-symbolic';
const RESET_ICON_NAME = 'edit-undo-symbolic';
const TOOLTIP_DELAY_MS = 400;

const KIND_CLASSES = {
    [Kind.POMODORO]: 'gnomato-popup--pomodoro',
    [Kind.SHORT_BREAK]: 'gnomato-popup--break',
    [Kind.LONG_BREAK]: 'gnomato-popup--break',
};

/**
 * `gettext` is a per-extension function: it can only be called while the shell
 * runs an extension, which is why the labels are built on demand rather than
 * when this module is evaluated.
 */
function kindLabel(kind) {
    if (kind === Kind.POMODORO)
        return _('Pomodoro');
    if (kind === Kind.SHORT_BREAK)
        return _('Short Break');
    return _('Long Break');
}

const STATE_CLASSES = {
    [State.RUNNING]: 'gnomato-popup--running',
    [State.PAUSED]: 'gnomato-popup--paused',
    [State.IDLE]: 'gnomato-popup--idle',
};

/** Every class the popup can carry from a kind or a state, for clearing them. */
const POPUP_CLASSES = new Set([
    ...Object.values(KIND_CLASSES),
    ...Object.values(STATE_CLASSES),
]);

/**
 * The ring of the popup.
 *
 * Cairo draws it, so the theme supplies both colors and the stroke width as
 * custom CSS properties; the drawing area itself is sized by its stylesheet.
 * The fraction is the share of the interval still ahead: full at the start,
 * empty at the deadline.
 */
export const GnomatoRing = GObject.registerClass(
class GnomatoRing extends St.DrawingArea {
    _init() {
        super._init({style_class: 'gnomato-ring-area'});
        this._fraction = 1;
        this.connect('style-changed', () => this.queue_repaint());
    }

    get fraction() {
        return this._fraction;
    }

    set fraction(value) {
        const clamped = Math.min(1, Math.max(0, value));
        if (clamped === this._fraction)
            return;
        this._fraction = clamped;
        this.queue_repaint();
    }

    vfunc_repaint() {
        const cr = this.get_context();
        const node = this.get_theme_node();
        const [width, height] = this.get_surface_size();

        const lineWidth = node.get_length('-gnomato-ring-width');
        const radius = Math.max(0, Math.min(width, height) / 2 - lineWidth / 2);
        const centerX = width / 2;
        const centerY = height / 2;

        cr.setLineWidth(lineWidth);
        cr.setLineCap(cairo.LineCap.ROUND);

        cr.arc(centerX, centerY, radius, 0, 2 * Math.PI);
        cr.setSourceColor(node.get_color('-gnomato-ring-track-color'));
        cr.stroke();

        if (this._fraction > 0) {
            const start = -Math.PI / 2;
            cr.arc(centerX, centerY, radius, start,
                start + 2 * Math.PI * this._fraction);
            cr.setSourceColor(node.get_foreground_color());
            cr.stroke();
        }

        cr.$dispose();
    }
});

/**
 * A tooltip for the popup buttons.
 *
 * St widgets have no tooltip of their own in Shell 50, and the shell's own
 * tooltip lives inside the screenshot UI, so this is the small part of it the
 * popup needs: an `St.Label` in the ui group, shown above the actor after a
 * short hover delay.
 */
export const GnomatoTooltip = GObject.registerClass(
class GnomatoTooltip extends St.Label {
    _init() {
        super._init({
            style_class: 'gnomato-tooltip',
            visible: false,
        });
        this._timeoutId = 0;
        this._alive = true;
        Main.uiGroup.add_child(this);
    }

    /**
     * @param {St.Widget} actor
     * @param {Function} text returns the text to show, read when it is shown
     */
    track(actor, text) {
        actor.connect('notify::hover', () => {
            if (actor.hover)
                this._open(actor, text);
            else
                this.close();
        });
        // A button of a popup that is being torn down still emits this, so the
        // tooltip has to survive being closed after it is gone.
        actor.connect('destroy', () => this.close());
    }

    close() {
        if (!this._alive)
            return;
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = 0;
        }
        this.hide();
    }

    destroy() {
        this.close();
        this._alive = false;
        super.destroy();
    }

    _open(actor, text) {
        this.close();
        this._timeoutId = GLib.timeout_add_once(GLib.PRIORITY_DEFAULT, TOOLTIP_DELAY_MS, () => {
            this._timeoutId = 0;
            this.text = text();
            this.show();
            this.get_parent().set_child_above_sibling(this, null);

            const [, width] = this.get_preferred_width(-1);
            const [, height] = this.get_preferred_height(-1);
            const extents = actor.get_transformed_extents();
            const x = extents.get_x() + (extents.get_width() - width) / 2;
            const y = extents.get_y() - height -
                this.get_theme_node().get_length('-y-offset');

            this.set_position(
                Math.clamp(Math.floor(x), 0, global.stage.width - width),
                Math.max(0, Math.floor(y)));
        });
        GLib.Source.set_name_by_id(this._timeoutId, '[gnomato] tooltip.open');
    }
});

/**
 * The panel screen of the timer, hung off the panel button.
 *
 * It is a `PopupMenu` so that the panel's menu manager gives it an arrow, a
 * modal grab, closing on a click outside and on Escape, for free. Its content
 * is plain `St` actors in `menu.box`: `addMenuItem` is type-checked and there
 * is no `addActor` in Shell 50.
 */
export class GnomatoPopup extends PopupMenu.PopupMenu {
    /**
     * @param {St.Widget} sourceActor the panel button the popup hangs from
     * @param {object} callbacks
     * @param {Function} callbacks.onToggle start, pause or resume
     * @param {Function} callbacks.onSkip finish the current interval early
     * @param {Function} callbacks.onReset rewind the current interval
     */
    constructor(sourceActor, {onToggle, onSkip, onReset}) {
        super(sourceActor, 0.0, St.Side.TOP);

        this._plannedMs = 0;
        // The set as the popup was last told about it: a restyle and an open
        // both fit the row again, so both need to know what to draw.
        this._progress = null;

        this.actor.add_style_class_name('gnomato-popup');
        this.box.add_style_class_name('gnomato-popup-content');

        this._tooltip = new GnomatoTooltip();

        this._ring = new GnomatoRing();
        this._timeLabel = new St.Label({
            style_class: 'gnomato-time',
            x_align: Clutter.ActorAlign.CENTER,
        });
        this._pauseIcon = new St.Icon({
            icon_name: PAUSE_ICON_NAME,
            style_class: 'gnomato-pause-icon',
            x_align: Clutter.ActorAlign.CENTER,
        });
        this._kindLabel = new St.Label({
            style_class: 'gnomato-kind',
            x_align: Clutter.ActorAlign.CENTER,
        });

        const center = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'gnomato-center',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        center.add_child(this._timeLabel);
        center.add_child(this._pauseIcon);
        center.add_child(this._kindLabel);

        const ring = new St.Widget({
            style_class: 'gnomato-ring',
            layout_manager: new Clutter.BinLayout(),
            x_align: Clutter.ActorAlign.CENTER,
        });
        ring.add_child(this._ring);
        ring.add_child(center);
        this.box.add_child(ring);

        this._tomatoes = new St.BoxLayout({
            style_class: 'gnomato-tomatoes',
            x_align: Clutter.ActorAlign.CENTER,
        });
        this.box.add_child(this._tomatoes);

        this._mainButton = this._makeButton({
            styleClass: 'gnomato-button--primary',
            iconName: PLAY_ICON_NAME,
            text: _('Start'),
            callback: onToggle,
        });
        this._mainIcon = this._mainButton.get_child();
        this._skipButton = this._makeButton({
            iconName: SKIP_ICON_NAME,
            text: _('Skip'),
            callback: onSkip,
        });
        this._resetButton = this._makeButton({
            iconName: RESET_ICON_NAME,
            text: _('Reset'),
            callback: onReset,
        });

        const controls = new St.BoxLayout({
            style_class: 'gnomato-controls',
            x_align: Clutter.ActorAlign.CENTER,
        });
        controls.add_child(this._mainButton);
        controls.add_child(this._skipButton);
        controls.add_child(this._resetButton);
        this.box.add_child(controls);

        this.connect('open-state-changed', (menu, open) => {
            if (!open) {
                this._tooltip.close();
                return;
            }
            // A popup that has never been shown measures nothing, so the row is
            // fitted again over the width it has now — the first open included.
            this._renderSet();
        });

        // The width the row is fitted into comes from the stylesheet, the theme
        // and the font, and all three move under a running popup.
        for (const actor of [this.box, this._tomatoes])
            actor.connect('style-changed', () => this._renderSet());
    }

    /**
     * Everything the popup shows, from one reading of the timer.
     *
     * @param {object} interval
     * @param {string} interval.state IDLE, RUNNING or PAUSED
     * @param {string} interval.kind POMODORO, SHORT_BREAK or LONG_BREAK
     * @param {number} interval.remainingMs while idle, the length still ahead
     * @param {number} interval.plannedMs what the interval is measured against
     * @param {number} interval.slot pomodoro slots already consumed
     * @param {number} interval.setSize size of the running set
     */
    setInterval({state, kind, remainingMs, plannedMs, slot, setSize}) {
        this._plannedMs = plannedMs;

        this._applyIntervalClasses(kind, state);
        this._timeLabel.text = formatRemaining(remainingMs);
        this._kindLabel.text = kindLabel(kind);
        this._pauseIcon.visible = state === State.PAUSED;
        this._ring.fraction = ringFraction(remainingMs, plannedMs);
        this._progress = setProgress(slot, setSize,
            state === State.IDLE ? null : kind);
        this._renderSet();

        const running = state !== State.IDLE;
        this._mainIcon.icon_name = state === State.RUNNING
            ? PAUSE_ICON_NAME : PLAY_ICON_NAME;
        this._mainButton.accessible_name = this._toggleLabel(state);
        this._setEnabled(this._skipButton, running);
        this._setEnabled(this._resetButton, running);
    }

    /** The per-second repaint: the countdown and the ring, nothing else. */
    setRemaining(remainingMs) {
        this._timeLabel.text = formatRemaining(remainingMs);
        this._ring.fraction = ringFraction(remainingMs, this._plannedMs);
    }

    destroy() {
        // The buttons of the popup report their own destruction to the tooltip,
        // so it outlives the actor tree.
        super.destroy();
        this._tooltip.destroy();
    }

    /** @returns {St.Button} */
    _makeButton({styleClass = '', iconName, text, callback}) {
        const button = new St.Button({
            style_class: `gnomato-button icon-button ${styleClass}`.trim(),
            can_focus: true,
            reactive: true,
            accessible_name: text,
            child: new St.Icon({icon_name: iconName}),
        });
        button.connect('clicked', () => callback());
        this._tooltip.track(button, () => button.accessible_name);
        return button;
    }

    _toggleLabel(state) {
        if (state === State.RUNNING)
            return _('Pause');
        if (state === State.PAUSED)
            return _('Resume');
        return _('Start');
    }

    _applyIntervalClasses(kind, state) {
        for (const className of POPUP_CLASSES)
            this.box.remove_style_class_name(className);
        this.box.add_style_class_name(KIND_CLASSES[kind]);
        this.box.add_style_class_name(STATE_CLASSES[state]);
    }

    /**
     * The row of tomatoes, or the count in the place of it when the row is
     * wider than the popup has room for.
     *
     * The fit is measured, never assumed: the width the popup has for the row
     * is read with the tomatoes empty, the row is built, and the row is kept
     * only if what it asks for is inside what there is. Everything else the
     * popup holds — the ring, the buttons — is wider than the count, so the
     * width read this way is the popup's own, and a row is fitted into the
     * popup rather than the other way round: the popup is the same width
     * whether the row or the count stands there. The count is never in the way
     * of the row — it goes in only where the row cannot.
     */
    _renderSet() {
        const progress = this._progress;
        if (!progress)
            return;

        this._tomatoes.destroy_all_children();
        const available = this._availableRowWidth();

        for (const slot of progress.slots)
            this._tomatoes.add_child(this._tomato(slot));

        const [, rowWidth] = this._tomatoes.get_preferred_width(-1);
        if (rowFits(rowWidth, available))
            return;

        this._tomatoes.destroy_all_children();
        this._tomatoes.add_child(this._count(progress.label));
    }

    /**
     * The width the row may use: the popup's own, with the padding and the
     * border the row cannot draw into taken off. Measured rather than read off
     * the stylesheet, so another `min-width`, another ring or another font is
     * accounted for by being there.
     */
    _availableRowWidth() {
        const [, width] = this.box.get_preferred_width(-1);
        const node = this.box.get_theme_node();
        const used = [St.Side.LEFT, St.Side.RIGHT].reduce((total, side) =>
            total + node.get_padding(side) + node.get_border_width(side), 0);

        return width - used;
    }

    _count(label) {
        return new St.Label({
            text: label,
            style_class: 'gnomato-tomatoes-label',
        });
    }

    _tomato(slot) {
        const classes = ['gnomato-tomato'];
        if (slot.filled)
            classes.push('gnomato-tomato--filled');
        if (slot.current)
            classes.push('gnomato-tomato--current');
        return new St.Widget({
            style_class: classes.join(' '),
            y_align: Clutter.ActorAlign.CENTER,
        });
    }

    _setEnabled(button, enabled) {
        button.reactive = enabled;
        button.can_focus = enabled;
        if (enabled)
            button.remove_style_class_name('gnomato-button--inactive');
        else
            button.add_style_class_name('gnomato-button--inactive');
    }
}
