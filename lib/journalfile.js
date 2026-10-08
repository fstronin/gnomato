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
        const file = Gio.File.new_for_path(path);
        const stream = file.append_to(Gio.FileCreateFlags.NONE, null);
        try {
            // A write interrupted mid-batch leaves a line without its newline.
            // Appending onto it would weld the first new record to the broken
            // tail and lose it, so close that line off first.
            const prefix = hasUnterminatedTail(file) ? '\n' : '';
            const text = records.map(record => `${JSON.stringify(record)}\n`).join('');
            stream.write_all(new TextEncoder().encode(prefix + text), null);
        } finally {
            stream.close(null);
        }
        return true;
    } catch (e) {
        console.error(`gnomato: cannot write ${path}: ${e.message}`);
        return false;
    }
}

function hasUnterminatedTail(file) {
    if (!file.query_exists(null))
        return false;

    const info = file.query_info(Gio.FILE_ATTRIBUTE_STANDARD_SIZE,
        Gio.FileQueryInfoFlags.NONE, null);
    if (info.get_size() === 0)
        return false;

    const stream = file.read(null);
    try {
        stream.seek(-1, GLib.SeekType.END, null);
        return stream.read_bytes(1, null).toArray()[0] !== 0x0A;
    } finally {
        stream.close(null);
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
