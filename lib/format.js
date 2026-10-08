// SPDX-License-Identifier: GPL-2.0

/**
 * Format a remaining duration for the panel label: `25:00`, `5:00`, `0:07`.
 *
 * Rounds up, so the label only drops a second once a whole second has
 * passed, and clamps at zero. Minutes are not padded past 59 (`90:00`).
 *
 * @param {number} ms remaining milliseconds
 * @returns {string} label text
 */
export function formatRemaining(ms) {
    const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
