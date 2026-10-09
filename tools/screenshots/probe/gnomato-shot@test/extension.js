// The README screenshot harness. Loaded only by tools/screenshots/run.sh, into
// a headless gnome-shell whose only output is a virtual monitor; it drives the
// real extension and writes the crops into docs/images/.
//
// A screenshot of a running shell is the only honest way to document the UI, so
// the harness poses real states instead of drawing mock-ups: a real completion
// (which is what puts a number in "Today"), a real long break reached by
// skipping, a real default-length pomodoro part way through.
//
// Coordinates below are logical; the crop helper does the conversion to
// physical pixels that the shell's own screenshot D-Bus handler does, and each
// entry in the report records the logical rectangle and the PNG that came out
// of it.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const UUID = 'gnomato@fstronin.github.io';
const ROOT = GLib.getenv('GN_SHOT_ROOT') ?? '/tmp/gnomato-screenshots';
const CONFIG = `${ROOT}/config.json`;
const REPORT = `${ROOT}/report.json`;
const JOURNAL = `${ROOT}/state/gnomato/journal.jsonl`;

const DEFAULT_POMODORO_S = 1500;   // the schema default: the headline shot uses it
const SHORT_POMODORO_S = 60;       // the schema minimum: one real completion, cheaply
const TARGET_FRACTION = 0.70;      // where in the interval the headline shot is taken

let report = {shots: []};
let shotsDir = `${ROOT}/shots`;

const wait = ms => new Promise(r => GLib.timeout_add_once(GLib.PRIORITY_DEFAULT, ms, () => r()));

function flush(step, extra) {
    report.step = step;
    Object.assign(report, extra ?? {});
    GLib.file_set_contents(REPORT, JSON.stringify(report, null, 2));
}

function pngSize(path) {
    const bytes = GLib.file_get_contents(path)[1];
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return [view.getUint32(16), view.getUint32(20)];
}

function journalTail() {
    try {
        return GLib.file_get_contents(JOURNAL)[1].toString().trim().split('\n').slice(-6)
            .map(line => JSON.stringify(JSON.parse(line)));
    } catch (e) {
        return [];
    }
}

const boxOf = (actor, padX, padY, padTop = padY) => {
    const [x, y] = actor.get_transformed_position();
    return {x: x - padX, y: y - padTop, w: actor.width + 2 * padX, h: actor.height + padTop + padY};
};

// org.gnome.Shell.Screenshot.ScreenshotArea is a D-Bus method restricted to a
// list of allowed senders (DBusSenderChecker in the shell), so the crop goes
// through the same class the shell uses for itself. That call wants physical
// coordinates -- the shell's D-Bus handler multiplies the logical rectangle by
// the stage scale factor the same way.
Gio._promisify(Shell.Screenshot.prototype, 'screenshot_area');

async function crop(name, box, note, dir = shotsDir) {
    const primary = Main.layoutManager.primaryMonitor;
    const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
    const mon = {x: primary.x * scale, y: primary.y * scale,
        width: primary.width * scale, height: primary.height * scale};
    const x = Math.round(Math.max(mon.x, box.x * scale));
    const y = Math.round(Math.max(mon.y, box.y * scale));
    const w = Math.round(Math.min(box.w * scale, mon.x + mon.width - x));
    const h = Math.round(Math.min(box.h * scale, mon.y + mon.height - y));
    const path = `${dir}/${name}.png`;
    const stream = Gio.File.new_for_path(path).replace(null, false, Gio.FileCreateFlags.NONE, null);
    try {
        await new Shell.Screenshot().screenshot_area(x, y, w, h, stream);
    } finally {
        stream.close(null);
    }
    report.shots.push({name, note: note ?? null, scale, logical: box, x, y, w, h, png: pngSize(path)});
    flush(`shot-${name}`);
}

// A headless session brings up windows of its own (a keyring prompt, a login
// banner), and the extension raises a notification when an interval ends.
// Neither belongs in a README shot. The keyring prompt is the shell's own
// actor, so it has to be closed through the shell, not minimized.
function quiet() {
    const hidden = [];
    for (const actor of global.get_window_actors()) {
        try {
            if (!actor.meta_window.minimized) {
                hidden.push(actor.meta_window.get_title() ?? '?');
                actor.meta_window.minimize();
            }
        } catch (e) {
        }
    }
    let banner = false;
    try {
        banner = !!Main.messageTray._banner;
        Main.messageTray._banner?.destroy();
    } catch (e) {
    }
    let keyring = null;
    try {
        keyring = typeof Main.keyring;
        Main.keyring?._prompt?.destroy?.();
        Main.keyring?.close?.();
        Main.keyring?._keyringDialogs?.forEach?.(dialog => dialog.destroy?.());
    } catch (e) {
        keyring = `${keyring} (${e})`;
    }
    return {hidden, banner, keyring};
}

export default class GnomatoShot extends Extension {
    enable() {
        this._run().catch(e => flush('harnessError', {error: `${e}`, stack: e.stack ?? null}));
    }

    disable() {
    }

    async _run() {
        let cfg = {mode: 'quick', background: 'flat', shotsDir};
        try {
            cfg = Object.assign(cfg, JSON.parse(GLib.file_get_contents(CONFIG)[1].toString()));
        } catch (e) {
        }
        shotsDir = cfg.shotsDir;
        flush('booting', {cfg});
        await wait(4000);

        const primary = Main.layoutManager.primaryMonitor;
        flush('monitors', {
            layoutMonitors: Main.layoutManager.monitors,
            primaryMonitor: primary,
            stageScale: St.ThemeContext.get_for_stage(global.stage).scale_factor,
        });

        const manager = Main.extensionManager;
        manager.enableExtension(UUID);
        await wait(3500);

        const ext = manager.lookup(UUID);
        const ind = Main.panel.statusArea[UUID];
        if (!ind)
            return flush('no-indicator', {state: ext.state, error: `${ext.error}`});

        const popup = ind.menu;
        const settings = ext.stateObj._settings;
        const timer = () => ext.stateObj._timer;
        const panelHeight = Main.panel.height || Main.layoutManager.panelBox.height;
        const mon = {x: primary.x, y: primary.y, width: primary.width, height: primary.height};
        const rightEdge = mon.x + mon.width;

        const panelStrip = () => {
            const [ix] = ind.get_transformed_position();
            const x = Math.max(mon.x, ix - 230);
            return {x, y: mon.y, w: rightEdge - x, h: panelHeight + 2};
        };
        const popupBox = () => boxOf(popup.actor, 14, 14, 2);
        const heroBox = () => {
            const [px, py] = popup.actor.get_transformed_position();
            const x = px - 44;
            return {x, y: mon.y, w: rightEdge - x, h: (py - mon.y) + panelHeight + popup.actor.height + 44};
        };
        const menuBox = () => {
            const [ix] = ind.get_transformed_position();
            const [mx] = ind._rightMenu.actor.get_transformed_position();
            const x = Math.max(mon.x, Math.min(ix, mx) - 24);
            return {x, y: mon.y, w: rightEdge - x, h: panelHeight + ind._rightMenu.actor.height + 20};
        };
        const ringColor = () => {
            try {
                const c = popup._ring.get_theme_node().get_color('color');
                return `#${[c.red, c.green, c.blue].map(v => v.toString(16).padStart(2, '0')).join('')}`;
            } catch (e) {
                return null;
            }
        };
        const state = () => ({
            state: timer().state,
            kind: timer().kind,
            slot: timer().slot,
            setSize: timer().setSize,
            remainingMs: Math.round(timer().remainingMs),
            plannedMs: timer().plannedMs,
            panelLabel: ind._label.text,
            panelLabelVisible: ind._label.visible,
            panelPausedVisible: ind._pausedIcon.visible,
            popupTime: popup._timeLabel.text,
            popupKind: popup._kindLabel.text,
            popupClasses: popup.box.get_style_class_name(),
            ringClasses: popup._ring.get_style_class_name(),
            ringColor: ringColor(),
            fraction: popup._ring.fraction,
            tomatoClasses: popup._tomatoes.get_children().map(c => c.style_class),
            popupOpen: popup.isOpen,
            today: ind._todayItem.label.text,
        });

        flush('enabled', {
            enabled: {state: ext.state, settings: {
                pomodoro: settings.get_int('pomodoro-seconds'),
                shortBreak: settings.get_int('short-break-seconds'),
                longBreak: settings.get_int('long-break-seconds'),
                setSize: settings.get_int('set-size'),
            }},
            windows: global.get_window_actors().map(a => a.meta_window.get_title()),
        });

        // 0. The whole monitor as it stands: what else the headless session
        //    has put on the screen, before anything is hidden. Kept out of
        //    docs/images -- it is a diagnostic, not a README shot.
        await crop('desktop', {x: mon.x, y: mon.y, w: mon.width, h: mon.height},
            'the whole virtual monitor, before anything is hidden', ROOT);
        flush('desktop', {quiet: quiet()});

        // 1. Idle: the icon alone in the panel, the plan for the first interval.
        await crop('panel-idle', panelStrip(), 'idle: the icon alone');
        popup.open();
        await wait(800);
        flush('idle', {idle: state()});
        await crop('popup-idle', popupBox(), 'idle: the planned interval, dimmed');
        popup.close();
        await wait(400);

        // 2. One real completed pomodoro, at the shortest length the schema
        //    allows. It is what puts a number in Today and starts a break.
        settings.set_int('pomodoro-seconds', SHORT_POMODORO_S);
        ext.stateObj._toggle();
        await wait(SHORT_POMODORO_S * 1000 + 8000);
        await wait(4000);            // let the end-of-interval banner go
        flush('short-pomodoro-done', {afterCompletion: state(), journal: journalTail(),
            quiet: quiet()});

        // 3. The break that followed it, started by the extension itself.
        popup.open();
        await wait(800);
        flush('break', {break: state()});
        await crop('popup-break', popupBox(), 'short break: its own colour and label');
        popup.close();
        await wait(400);
        await crop('panel-break', panelStrip(), 'the break counting down in the panel');

        // 4. The right-click menu.
        ind._rightMenu.toggle();
        await wait(800);
        flush('menu', {menu: state(),
            menuItems: ind._rightMenu._getMenuItems().map(i => (i.label ? i.label.text : i.constructor.name))});
        await crop('menu', menuBox(), 'right click: Today and Preferences');
        ind._rightMenu.close();
        await wait(500);

        // 5. A long break, reached by skipping the rest of the set.
        const steps = [];
        for (let i = 0; i < 14 && timer().kind !== 'LONG_BREAK'; i++) {
            ext.stateObj._toggle();
            await wait(200);
            ext.stateObj._skip();
            await wait(250);
            steps.push(`${timer().kind}/${timer().slot}`);
        }
        popup.open();
        await wait(800);
        flush('long-break', {steps, longBreak: state()});
        await crop('popup-long-break', popupBox(), 'long break: same colour, its own length');
        popup.close();
        await wait(400);

        // 6. The headline: a fresh set, a default-length pomodoro, part way
        //    through. Skipping the long break lands on pomodoro of slot 0.
        ext.stateObj._toggle();
        await wait(200);
        ext.stateObj._skip();
        await wait(600);
        settings.set_int('pomodoro-seconds', DEFAULT_POMODORO_S);
        await wait(600);
        flush('fresh-set', {freshSet: state()});
        ext.stateObj._toggle();
        if (cfg.mode === 'full') {
            for (let i = 0; i < 900; i++) {
                if (timer().remainingMs <= TARGET_FRACTION * timer().plannedMs)
                    break;
                await wait(1000);
            }
        }
        await wait(1200);
        flush('running', {running: state(), quiet: quiet()});
        await crop('panel-running', panelStrip(), 'the countdown in the panel');
        popup.open();
        await wait(900);
        await crop('hero-running', heroBox(), 'running: panel and popup');
        await crop('popup-running', popupBox(), 'running: ring, countdown, set row');

        ext.stateObj._toggle();      // pause
        await wait(1500);
        flush('paused', {paused: state()});
        await crop('popup-paused', popupBox(), 'paused: the pause mark and a still ring');
        popup.close();
        await wait(500);
        await crop('panel-paused', panelStrip(), 'paused: the pause mark in the panel');

        // 7. Preferences: a window of its own process, so it may not come up.
        const prefsApi = {
            extension: typeof ext.openPreferences,
            manager: typeof manager.openExtensionPrefs,
        };
        try {
            if (typeof ext.openPreferences === 'function')
                await Promise.resolve(ext.openPreferences());
            else if (typeof manager.openExtensionPrefs === 'function')
                await Promise.resolve(manager.openExtensionPrefs(UUID, '', {}));
            await wait(7000);
            flush('prefs', {prefsApi,
                prefsWindows: global.get_window_actors()
                    .map(a => [a.meta_window.get_title(), a.meta_window.get_wm_class()])});
            const actor = global.get_window_actors()
                .find(a => (a.meta_window.get_wm_class() ?? '').startsWith('gnomato') ||
                    /gnomato/i.test(a.meta_window.get_title() ?? ''));
            if (actor) {
                const rect = actor.meta_window.get_frame_rect();
                await crop('prefs', {x: rect.x - 24, y: rect.y - 24, w: rect.width + 48, h: rect.height + 48},
                    'Preferences');
                try {
                    actor.meta_window.delete(global.get_current_time());
                } catch (e) {
                }
                await wait(1500);
            }
        } catch (e) {
            flush('prefs-failed', {prefsApi, prefsError: `${e}`});
        }

        flush('done', {finalState: state(), shots: report.shots});
    }
}
