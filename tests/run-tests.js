// SPDX-License-Identifier: GPL-2.0

import system from 'system';

import {tests as formatTests} from './format.test.js';

const suites = [
    ['format', formatTests],
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
