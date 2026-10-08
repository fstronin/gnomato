// SPDX-License-Identifier: GPL-2.0

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import {defineTests, equal, ok} from './harness.js';
import {appendRecords, readRecords} from '../lib/journalfile.js';

const tmpPath = () => GLib.build_filenamev([GLib.get_tmp_dir(),
    `gnomato-test-${GLib.get_monotonic_time()}`, 'nested', 'journal.jsonl']);

const rec = (over = {}) => ({
    v: 1,
    interval_id: 1,
    day: '2026-10-08',
    part: 1,
    started_ms: 1,
    ended_ms: 2,
    kind: 'POMODORO',
    planned_s: 1500,
    actual_s: 1500,
    outcome: 'completed',
    restored: false,
    set_index: 0,
    set_size: 4,
    ...over,
});

export const tests = defineTests(test => {
    test('a missing file reads as empty', () => {
        const result = readRecords(tmpPath());
        equal(result.records.length, 0);
        equal(result.skipped, 0);
    });

    test('appended records come back in order', () => {
        const path = tmpPath();
        ok(appendRecords(path, [rec({started_ms: 1}), rec({started_ms: 2})]));
        const {records, skipped} = readRecords(path);
        equal(records.length, 2);
        equal(skipped, 0);
        equal(records[0].started_ms, 1);
        equal(records[1].started_ms, 2);
    });

    test('a corrupt line is skipped without losing earlier records', () => {
        const path = tmpPath();
        appendRecords(path, [rec({started_ms: 1})]);
        const file = Gio.File.new_for_path(path);
        const out = file.append_to(Gio.FileCreateFlags.NONE, null);
        out.write_all(new TextEncoder().encode('{"v":1,"part"\n'), null);
        out.close(null);
        const {records, skipped} = readRecords(path);
        equal(records.length, 1);
        equal(records[0].started_ms, 1);
        equal(skipped, 1);
    });

    test('an unwritable path reports failure instead of throwing', () => {
        equal(appendRecords('/proc/gnomato/journal.jsonl', [rec()]), false);
    });

    test('a partial line without a newline does not swallow the next record', () => {
        const path = tmpPath();
        const file = Gio.File.new_for_path(path);
        GLib.mkdir_with_parents(GLib.path_get_dirname(path), 0o755);
        const out = file.append_to(Gio.FileCreateFlags.NONE, null);
        out.write_all(new TextEncoder().encode('{"v":1,"started_ms":1}\n{"v":1,"par'), null);
        out.close(null);

        ok(appendRecords(path, [rec({started_ms: 7})]));
        const {records, skipped} = readRecords(path);
        equal(records.length, 2);
        equal(records[1].started_ms, 7);
        equal(skipped, 1);
    });
});
