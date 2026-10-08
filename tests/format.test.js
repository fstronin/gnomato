// SPDX-License-Identifier: GPL-2.0

import {defineTests, equal} from './harness.js';
import {formatRemaining} from '../lib/format.js';

export const tests = defineTests(test => {
    test('full pomodoro renders as 25:00', () =>
        equal(formatRemaining(1500000), '25:00'));

    test('rounds up so the first second still shows the full value', () =>
        equal(formatRemaining(1499000), '24:59'));

    test('sub-second remainder shows a full second', () =>
        equal(formatRemaining(999), '0:01'));

    test('zero renders as 0:00', () =>
        equal(formatRemaining(0), '0:00'));

    test('negative remaining clamps to 0:00', () =>
        equal(formatRemaining(-5), '0:00'));

    test('minutes are not padded past 59', () =>
        equal(formatRemaining(3600000), '60:00'));

    test('a single minute is 1:00', () =>
        equal(formatRemaining(60000), '1:00'));
});
