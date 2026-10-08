// SPDX-License-Identifier: GPL-2.0

/**
 * Deterministic wall clock for tests. `advance` moves time forward, `setWall`
 * puts it anywhere — that is how a clock jump (NTP after resume) is modelled.
 */
export function fakeClock(startWallMs = 1700000000000) {
    let wall = startWallMs;
    return {
        now: {wallMs: () => wall},
        advance(ms) {
            wall += ms;
        },
        setWall(ms) {
            wall = ms;
        },
    };
}
