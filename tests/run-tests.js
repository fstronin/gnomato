// SPDX-License-Identifier: GPL-2.0

import system from 'system';

import {tests as formatTests} from './format.test.js';
import {tests as scheduleTests} from './schedule.test.js';
import {tests as timerTests} from './timer.test.js';
import {tests as journalTests} from './journal.test.js';
import {tests as journalfileTests} from './journalfile.test.js';
import {tests as stateTests} from './state.test.js';
import {tests as progressTests} from './progress.test.js';
import {tests as cuesTests} from './cues.test.js';

const suites = [
    ['format', formatTests],
    ['schedule', scheduleTests],
    ['timer', timerTests],
    ['journal', journalTests],
    ['journalfile', journalfileTests],
    ['state', stateTests],
    ['progress', progressTests],
    ['cues', cuesTests],
];

let passed = 0;
let failed = 0;

for (const [suite, tests] of suites) {
    for (const {name, fn} of tests) {
        try {
            fn();
            passed++;
            print(`ok - ${suite}: ${name}`);
        } catch (e) {
            failed++;
            printerr(`not ok - ${suite}: ${name}\n    ${e.message}`);
        }
    }
}

print(`${passed} passing, ${failed} failing`);

if (failed > 0)
    system.exit(1);
