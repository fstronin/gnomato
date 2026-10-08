// SPDX-License-Identifier: GPL-2.0

import {Kind} from './schedule.js';

/**
 * The popup draws the current interval as a ring and the set as a row of
 * tomatoes. Both are plain functions of the timer's numbers, so they live in
 * this module and run under plain gjs, away from the shell.
 */

/** Above this many slots the row would outgrow the popup: it becomes `N/M`. */
export const COMPACT_SET_SIZE = 6;

/**
 * Share of the interval still ahead of the timer.
 *
 * A plan of zero has no share — the interval is not measurable — so it reads as
 * an empty ring rather than as a division by zero.
 *
 * @param {number} remainingMs
 * @param {number} plannedMs
 * @returns {number} between 0 and 1
 */
export function ringFraction(remainingMs, plannedMs) {
    if (!(plannedMs > 0))
        return 0;
    return Math.min(1, Math.max(0, remainingMs / plannedMs));
}

/**
 * The set as it stands right now.
 *
 * The row is as long as the set that is *running*, not as long as the current
 * `set-size` setting, so changing the setting mid-set does not redraw history.
 * A skipped pomodoro has consumed its slot exactly like a finished one, and only
 * a running pomodoro highlights a slot — a break is not a slot, and a timer that
 * is not running has no slot to highlight, which is what a null `kind` says.
 *
 * @param {number} slot pomodoro slots already consumed
 * @param {number} setSize size of the running set
 * @param {string|null} kind current interval kind, or null when none is running
 * @returns {{compact: boolean, label: string, slots: Array<{filled: boolean, current: boolean}>}}
 */
export function setProgress(slot, setSize, kind) {
    const size = Math.max(0, Math.trunc(setSize));
    const consumed = Math.min(Math.max(0, Math.trunc(slot)), size);

    return {
        compact: size > COMPACT_SET_SIZE,
        label: `${consumed}/${size}`,
        slots: Array.from({length: size}, (_, index) => ({
            filled: index < consumed,
            current: kind === Kind.POMODORO && index === consumed,
        })),
    };
}
