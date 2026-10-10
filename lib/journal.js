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

/** The `mark` a Count Reset leaves behind in the journal. */
export const COUNT_RESET_MARK = 'count-reset';

/**
 * A Count Reset is written into the journal like everything else that happened:
 * "Today" is a reading of that file, so the moment the count restarts has to be
 * in there too, or the same file would read two ways. The mark carries no day —
 * only the records of one day are ever counted, so any mark is older than the
 * day in front of it, and the newest mark in the file is the one that counts.
 */
export function makeCountResetRecord(wallMs) {
    return {v: 1, mark: COUNT_RESET_MARK, at_ms: Math.floor(wallMs)};
}

/**
 * Completed pomodoros of one local day, counted from the newest Count Reset.
 * Only the head of an interval counts, and only a finished one: skipped and
 * aborted intervals are history, not progress. The mark is a moment, compared
 * with the moment an interval ended — so one that was already over when the
 * count was reset does not come back into it, while one still counting does.
 */
export function todayCount(records, key) {
    let since = 0;
    for (const record of records) {
        if (record.mark === COUNT_RESET_MARK && Number.isFinite(record.at_ms))
            since = Math.max(since, record.at_ms);
    }

    return records.filter(record =>
        record.outcome === 'completed' && record.part === 1 && record.day === key &&
        record.ended_ms > since).length;
}
