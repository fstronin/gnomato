// SPDX-License-Identifier: GPL-2.0

import {defineTests, deepEqual, equal} from './harness.js';
import {toSettingsValues, fromSettingsValues} from '../lib/state.js';

export const tests = defineTests(test => {
    test('state round-trips through settings values', () => {
        const values = {
            state: 'RUNNING',
            kind: 'SHORT_BREAK',
            slot: 2,
            endWallMs: 1700000000000,
            remainingMs: 299000,
            startedWallMs: 1699999000000,
        };
        deepEqual(fromSettingsValues(toSettingsValues(values)), values);
    });

    test('unknown strings fall back to idle pomodoro', () => {
        const result = fromSettingsValues({timerState: 'SLEEPING', timerKind: 'SUNBATHING'});
        equal(result.state, 'IDLE');
        equal(result.kind, 'POMODORO');
    });

    test('missing numeric values become zero', () => {
        const result = fromSettingsValues({});
        equal(result.endWallMs, 0);
        equal(result.startedWallMs, 0);
        equal(result.slot, 0);
    });
});
