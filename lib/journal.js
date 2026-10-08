// SPDX-License-Identifier: GPL-2.0

import GLib from 'gi://GLib';

/**
 * Journal records are written when an interval closes, and one record per
 * calendar day: an interval that crosses local midnight is written twice, so
 * the seconds land on the day they were spent. The first part stays the head of
 * the interval — it carries `planned_s` and it is the one `todayCount()` counts,
 * which is what keeps one midnight-spanning pomodoro from counting as two.
 */

/** Local midnight of the day `wallMs` falls on. */
function localMidnight(wallMs) {
    const dt = GLib.DateTime.new_from_unix_local(Math.floor(wallMs / 1000));
    return GLib.DateTime.new_local(dt.get_year(), dt.get_month(),
        dt.get_day_of_month(), 0, 0, 0);
}

/** @returns {string} local `YYYY-MM-DD` of a wall-clock timestamp */
export function dayKey(wallMs) {
    return GLib.DateTime.new_from_unix_local(Math.floor(wallMs / 1000)).format('%Y-%m-%d');
}

/**
 * @param {object} closed a `ClosedInterval` from lib/timer.js
 * @returns {Array<object>} one record, or two when the interval crossed midnight
 */
export function makeRecords(closed) {
    const common = {
        v: 1,
        interval_id: closed.intervalId,
        kind: closed.kind,
        outcome: closed.outcome,
        restored: closed.restored,
        set_index: closed.slot,
        set_size: closed.setSize,
    };
    const plannedSeconds = Math.round(closed.plannedMs / 1000);
    const actualSeconds = Math.round(closed.actualMs / 1000);

    const midnight = localMidnight(closed.startedWallMs).add_days(1).to_unix() * 1000;
    if (closed.endedWallMs <= midnight) {
        return [{
            ...common,
            day: dayKey(closed.startedWallMs),
            part: 1,
            started_ms: closed.startedWallMs,
            ended_ms: closed.endedWallMs,
            planned_s: plannedSeconds,
            actual_s: actualSeconds,
        }];
    }

    const beforeWall = Math.max(0, midnight - closed.startedWallMs);
    const afterWall = Math.max(0, closed.endedWallMs - midnight);
    const totalWall = beforeWall + afterWall;
    const spillSeconds = totalWall === 0 ? 0 : Math.round(actualSeconds * afterWall / totalWall);

    return [
        {
            ...common,
            day: dayKey(closed.startedWallMs),
            part: 1,
            started_ms: closed.startedWallMs,
            ended_ms: midnight,
            planned_s: plannedSeconds,
            actual_s: actualSeconds - spillSeconds,
        },
        {
            ...common,
            day: dayKey(midnight),
            part: 2,
            started_ms: midnight,
            ended_ms: closed.endedWallMs,
            actual_s: spillSeconds,
        },
    ];
}

/**
 * Completed pomodoros of one local day. Only the head of an interval counts, and
 * only a finished one: skipped and aborted intervals are history, not progress.
 */
export function todayCount(records, key) {
    return records.filter(record =>
        record.outcome === 'completed' && record.part === 1 && record.day === key).length;
}
