// SPDX-License-Identifier: GPL-2.0

import {defineTests, deepEqual, equal} from './harness.js';
import {ringFraction, setProgress} from '../lib/progress.js';
import {Kind} from '../lib/schedule.js';

const slots = (...states) => states.map(([filled, current]) => ({filled, current}));

export const tests = defineTests(test => {
    test('half of the plan elapsed leaves half of the ring', () =>
        equal(ringFraction(750000, 1500000), 0.5));

    test('a full and an exhausted interval are the ends of the ring', () => {
        equal(ringFraction(1500000, 1500000), 1);
        equal(ringFraction(0, 1500000), 0);
    });

    test('the fraction is clamped to the unit interval', () => {
        equal(ringFraction(3000000, 1500000), 1);
        equal(ringFraction(-1000, 1500000), 0);
    });

    test('a plan of zero has no fraction instead of a division by zero', () => {
        equal(ringFraction(1000, 0), 0);
        equal(ringFraction(0, 0), 0);
        equal(ringFraction(1000, -5), 0);
    });

    test('a set before any pomodoro highlights the first slot', () =>
        deepEqual(setProgress(0, 4, Kind.POMODORO), {
            compact: false,
            label: '0/4',
            slots: slots([false, true], [false, false], [false, false], [false, false]),
        }));

    test('consumed slots are filled and the running pomodoro is highlighted', () =>
        deepEqual(setProgress(2, 4, Kind.POMODORO).slots,
            slots([true, false], [true, false], [false, true], [false, false])));

    test('a skipped pomodoro consumes its slot like a finished one', () =>
        deepEqual(setProgress(1, 4, Kind.POMODORO).slots,
            slots([true, false], [false, true], [false, false], [false, false])));

    test('a break highlights no slot', () =>
        deepEqual(setProgress(2, 4, Kind.SHORT_BREAK).slots,
            slots([true, false], [true, false], [false, false], [false, false])));

    test('an idle timer highlights no slot', () =>
        deepEqual(setProgress(1, 4, null).slots,
            slots([true, false], [false, false], [false, false], [false, false])));

    test('a long break after the last pomodoro highlights no slot', () =>
        deepEqual(setProgress(4, 4, Kind.LONG_BREAK).slots,
            slots([true, false], [true, false], [true, false], [true, false])));

    test('a slot beyond the set fills the row and highlights nothing', () => {
        deepEqual(setProgress(5, 4, Kind.POMODORO), {
            compact: false,
            label: '4/4',
            slots: slots([true, false], [true, false], [true, false], [true, false]),
        });
    });

    test('a set of six still shows the row', () => {
        const progress = setProgress(0, 6, Kind.POMODORO);
        equal(progress.compact, false);
        equal(progress.slots.length, 6);
    });

    test('a set larger than six collapses to a count', () => {
        const progress = setProgress(2, 12, Kind.POMODORO);
        equal(progress.compact, true);
        equal(progress.label, '2/12');
        equal(progress.slots.length, 12);
    });

    test('a set without slots does not break the row', () =>
        deepEqual(setProgress(0, 0, Kind.POMODORO).slots, []));
});
