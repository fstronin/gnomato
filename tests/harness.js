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
    const got = canonical(actual);
    const want = canonical(expected);
    if (got !== want)
        fail(`${msg} expected ${want}, got ${got}`.trim());
}

function canonical(value) {
    if (Array.isArray(value))
        return `[${value.map(canonical).join(',')}]`;
    if (value !== null && typeof value === 'object') {
        const keys = Object.keys(value).sort();
        return `{${keys.map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

export function ok(value, msg = '') {
    if (!value)
        fail(`${msg} expected truthy, got ${JSON.stringify(value)}`.trim());
}
