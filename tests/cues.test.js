// SPDX-License-Identifier: GPL-2.0

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import {defineTests, equal, ok} from './harness.js';
import {CUE_FILES, cueFile} from '../lib/cues.js';
import {Kind} from '../lib/schedule.js';

/** The sounds sit next to the tests, in the repository they are run from. */
const repoRoot = GLib.path_get_dirname(
    GLib.path_get_dirname(GLib.filename_from_uri(import.meta.url)[0]));

export const tests = defineTests(test => {
    test('every interval kind has a cue of its own name', () => {
        for (const kind of Object.values(Kind)) {
            const name = CUE_FILES[kind];
            ok(typeof name === 'string', `${kind} has no cue`);
            equal(name.includes('/'), false);
            ok(name.endsWith('.wav'), `${kind}: ${name}`);
        }
    });

    test('the breaks share one cue and the pomodoro has another', () => {
        equal(CUE_FILES[Kind.SHORT_BREAK], CUE_FILES[Kind.LONG_BREAK]);
        ok(CUE_FILES[Kind.POMODORO] !== CUE_FILES[Kind.SHORT_BREAK]);
    });

    test('every cue is a WAV in the repository', () => {
        const decoder = new TextDecoder();
        for (const kind of Object.values(Kind)) {
            const path = GLib.build_filenamev([repoRoot, cueFile(kind)]);
            const file = Gio.File.new_for_path(path);
            ok(file.query_exists(null), `missing ${path}`);
            const [, bytes] = file.load_contents(null);
            equal(decoder.decode(bytes.subarray(0, 4)), 'RIFF');
            equal(decoder.decode(bytes.subarray(8, 12)), 'WAVE');
        }
    });
});
