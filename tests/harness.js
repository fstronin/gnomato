// SPDX-License-Identifier: GPL-2.0

export function defineTests(body) {
    const tests = [];
    body((name, fn) => tests.push({name, fn}));
    return tests;
}

function fail(message) {
    throw new Error(message);
}

export function equal(actual, expected, msg = '') {
    if (actual !== expected)
        fail(`${msg} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`.trim());
}

export function deepEqual(actual, expected, msg = '') {
    const got = JSON.stringify(actual);
    const want = JSON.stringify(expected);
    if (got !== want)
        fail(`${msg} expected ${want}, got ${got}`.trim());
}

export function ok(value, msg = '') {
    if (!value)
        fail(`${msg} expected truthy, got ${JSON.stringify(value)}`.trim());
}
