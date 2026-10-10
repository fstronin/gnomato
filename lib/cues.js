// SPDX-License-Identifier: GPL-2.0

import {Kind} from './schedule.js';

/**
 * The Cue of each Interval kind, as a file under the extension's own `sounds/`.
 *
 * Own files rather than sound-theme events: every theme event short enough for
 * a boundary read as "a notification arrived" to the ear that has to act on it,
 * and the theme decides its own timbre, length and loudness. These are made by
 * `tools/sounds/make-sounds.py`, which keeps its motifs as numbers, so a cue can
 * be retuned instead of searched for among the event ids. The pair is mirrored —
 * the pomodoro rises, the break falls — and both break kinds share one sound, as
 * they always have.
 */
export const CUE_FILES = {
    [Kind.POMODORO]: 'pomodoro.wav',
    [Kind.SHORT_BREAK]: 'break.wav',
    [Kind.LONG_BREAK]: 'break.wav',
};

/** @returns {string} the cue of that kind, relative to the extension directory */
export function cueFile(kind) {
    return `sounds/${CUE_FILES[kind]}`;
}
