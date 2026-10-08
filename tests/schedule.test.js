// SPDX-License-Identifier: GPL-2.0

import {defineTests, deepEqual, equal, ok} from './harness.js';
import {Kind, advanceAfter, isBreak, shouldAutoStart} from '../lib/schedule.js';

export const tests = defineTests(test => {
    test('after the first pomodoro comes a short break', () =>
        deepEqual(advanceAfter(Kind.POMODORO, 0, 4), {kind: Kind.SHORT_BREAK, slot: 1}));

    test('the fourth pomodoro leads to a long break', () =>
        deepEqual(advanceAfter(Kind.POMODORO, 3, 4), {kind: Kind.LONG_BREAK, slot: 4}));

    test('the long break resets the set', () =>
        deepEqual(advanceAfter(Kind.LONG_BREAK, 4, 4), {kind: Kind.POMODORO, slot: 0}));

    test('a short break keeps the slot', () =>
        deepEqual(advanceAfter(Kind.SHORT_BREAK, 2, 4), {kind: Kind.POMODORO, slot: 2}));

    test('set size 1 makes every pomodoro the last one', () =>
        deepEqual(advanceAfter(Kind.POMODORO, 0, 1), {kind: Kind.LONG_BREAK, slot: 1}));

    test('breaks are recognised', () => {
        ok(isBreak(Kind.SHORT_BREAK));
        ok(isBreak(Kind.LONG_BREAK));
        ok(!isBreak(Kind.POMODORO));
    });

    test('work does not auto-start with the default policy', () =>
        equal(shouldAutoStart(Kind.POMODORO, {autoStartBreaks: true, autoStartWork: false}), false));

    test('breaks auto-start with the default policy', () =>
        equal(shouldAutoStart(Kind.SHORT_BREAK, {autoStartBreaks: true, autoStartWork: false}), true));
});
