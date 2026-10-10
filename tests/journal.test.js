// SPDX-License-Identifier: GPL-2.0

import GLib from 'gi://GLib';

import {defineTests, deepEqual, equal} from './harness.js';
import {dayKey, makeCountResetRecord, makeRecords, todayCount} from '../lib/journal.js';

const localMs = (y, mo, d, h, mi, s = 0) =>
    GLib.DateTime.new_local(y, mo, d, h, mi, s).to_unix() * 1000;

const closed = (over = {}) => ({
    intervalId: localMs(2026, 10, 8, 10, 0),
    kind: 'POMODORO',
    plannedMs: 1500000,
    actualMs: 1500000,
    outcome: 'completed',
    restored: false,
    startedWallMs: localMs(2026, 10, 8, 10, 0),
    endedWallMs: localMs(2026, 10, 8, 10, 25),
    slot: 0,
    setSize: 4,
    ...over,
});

export const tests = defineTests(test => {
    test('an interval inside one day becomes a single first-part record', () => {
        const records = makeRecords(closed());
        equal(records.length, 1);
        equal(records[0].day, '2026-10-08');
        equal(records[0].part, 1);
        equal(records[0].planned_s, 1500);
        equal(records[0].actual_s, 1500);
        equal(records[0].outcome, 'completed');
        equal(records[0].restored, false);
        equal(records[0].set_index, 0);
        equal(records[0].set_size, 4);
    });

    test('an interval crossing local midnight splits into two parts', () => {
        const start = localMs(2026, 10, 8, 23, 50);
        const records = makeRecords(closed({
            startedWallMs: start,
            endedWallMs: localMs(2026, 10, 9, 0, 15),
            intervalId: start,
            actualMs: 1500000,
        }));
        equal(records.length, 2);
        equal(records[0].day, '2026-10-08');
        equal(records[0].part, 1);
        equal(records[1].day, '2026-10-09');
        equal(records[1].part, 2);
        equal(records[0].ended_ms, localMs(2026, 10, 9, 0, 0));
        equal(records[1].started_ms, localMs(2026, 10, 9, 0, 0));
        equal(records[0].actual_s + records[1].actual_s, 1500);
        equal(records[1].planned_s, undefined);
    });

    test('a midnight-spanning pomodoro counts once, on its start day', () => {
        const start = localMs(2026, 10, 8, 23, 50);
        const records = makeRecords(closed({
            startedWallMs: start,
            endedWallMs: localMs(2026, 10, 9, 0, 15),
            intervalId: start,
        }));
        equal(todayCount(records, '2026-10-08'), 1);
        equal(todayCount(records, '2026-10-09'), 0);
    });

    test('skipped intervals are not counted', () => {
        equal(todayCount(makeRecords(closed({outcome: 'skipped'})), '2026-10-08'), 0);
    });

    test('aborted intervals are not counted', () => {
        equal(todayCount(makeRecords(closed({outcome: 'aborted'})), '2026-10-08'), 0);
    });

    test('a restored completion still counts once', () => {
        const records = makeRecords(closed({restored: true}));
        equal(records[0].restored, true);
        equal(todayCount(records, '2026-10-08'), 1);
    });

    test('records from another day are not counted', () => {
        const records = makeRecords(closed());
        equal(todayCount(records, '2026-10-07'), 0);
    });

    test('a count reset leaves a mark that is no interval', () => {
        deepEqual(makeCountResetRecord(localMs(2026, 10, 8, 12, 0)),
            {v: 1, mark: 'count-reset', at_ms: localMs(2026, 10, 8, 12, 0)});
    });

    test('the day starts over at the mark', () => {
        const records = [
            ...makeRecords(closed()),
            makeCountResetRecord(localMs(2026, 10, 8, 12, 0)),
        ];
        equal(todayCount(records, '2026-10-08'), 0);
    });

    test('a pomodoro still counting when the count was reset comes into the new one', () => {
        const start = localMs(2026, 10, 8, 11, 50);
        const records = [
            makeCountResetRecord(localMs(2026, 10, 8, 12, 0)),
            ...makeRecords(closed({
                startedWallMs: start,
                endedWallMs: localMs(2026, 10, 8, 12, 15),
                intervalId: start,
            })),
        ];
        equal(todayCount(records, '2026-10-08'), 1);
    });

    test('the newest mark is the one the day restarts from', () => {
        const records = [
            makeCountResetRecord(localMs(2026, 10, 8, 9, 0)),
            ...makeRecords(closed()),
            makeCountResetRecord(localMs(2026, 10, 8, 12, 0)),
        ];
        equal(todayCount(records, '2026-10-08'), 0);
    });

    test("a mark from another day does not touch today's count", () => {
        const records = [
            makeCountResetRecord(localMs(2026, 10, 7, 12, 0)),
            ...makeRecords(closed()),
        ];
        equal(todayCount(records, '2026-10-08'), 1);
    });

    test('dayKey follows local time', () => {
        equal(dayKey(localMs(2026, 10, 8, 0, 0)), '2026-10-08');
        equal(dayKey(localMs(2026, 10, 8, 23, 59, 59)), '2026-10-08');
    });
});
