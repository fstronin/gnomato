// SPDX-License-Identifier: GPL-2.0

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

/**
 * The journal is an append-only JSONL file under `XDG_STATE_HOME`: it is
 * machine-local state, not configuration and not something worth backing up.
 * Writing is best effort — a full disk or a read-only home must never stop the
 * timer — while reading tolerates a half-written last line.
 */

/** @returns {string} `~/.local/state/gnomato/journal.jsonl` */
export function journalPath() {
    return GLib.build_filenamev([GLib.get_user_state_dir(), 'gnomato', 'journal.jsonl']);
}

/**
 * @param {string} path
 * @param {Array<object>} records
 * @returns {boolean} false when nothing could be written
 */
export function appendRecords(path, records) {
    try {
        GLib.mkdir_with_parents(GLib.path_get_dirname(path), 0o755);
        const stream = Gio.File.new_for_path(path).append_to(Gio.FileCreateFlags.NONE, null);
        try {
            const text = records.map(record => `${JSON.stringify(record)}\n`).join('');
            stream.write_all(new TextEncoder().encode(text), null);
        } finally {
            stream.close(null);
        }
        return true;
    } catch (e) {
        console.error(`gnomato: cannot write ${path}: ${e.message}`);
        return false;
    }
}

/**
 * @param {string} path
 * @returns {{records: Array<object>, skipped: number}} parsed records and the
 *   number of lines that were not valid JSON (a truncated write, for example)
 */
export function readRecords(path) {
    const file = Gio.File.new_for_path(path);
    if (!file.query_exists(null))
        return {records: [], skipped: 0};

    let contents;
    try {
        const [, bytes] = file.load_contents(null);
        contents = new TextDecoder().decode(bytes);
    } catch (e) {
        console.error(`gnomato: cannot read ${path}: ${e.message}`);
        return {records: [], skipped: 0};
    }

    const records = [];
    let skipped = 0;
    for (const line of contents.split('\n')) {
        if (line.trim() === '')
            continue;
        try {
            records.push(JSON.parse(line));
        } catch {
            skipped++;
        }
    }
    return {records, skipped};
}
