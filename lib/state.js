// SPDX-License-Identifier: GPL-2.0

import {Kind, State} from './timer.js';

/**
 * The live timer state travels through GSettings, so that a shell restart, an
 * extension reload or a screen lock does not throw away a running interval.
 * These two functions are the whole mapping; reading and writing the settings
 * themselves stays in extension.js.
 */

const STATES = Object.values(State);
const KINDS = Object.values(Kind);

export function toSettingsValues(values) {
    return {
        timerState: values.state,
        timerKind: values.kind,
        timerSlot: values.slot,
        timerEndWallMs: values.endWallMs,
        timerRemainingMs: values.remainingMs,
        timerStartedWallMs: values.startedWallMs,
    };
}

export function fromSettingsValues(raw) {
    return {
        state: STATES.includes(raw.timerState) ? raw.timerState : State.IDLE,
        kind: KINDS.includes(raw.timerKind) ? raw.timerKind : Kind.POMODORO,
        slot: Number.isFinite(raw.timerSlot) ? raw.timerSlot : 0,
        endWallMs: Number.isFinite(raw.timerEndWallMs) ? raw.timerEndWallMs : 0,
        remainingMs: Number.isFinite(raw.timerRemainingMs) ? raw.timerRemainingMs : 0,
        startedWallMs: Number.isFinite(raw.timerStartedWallMs) ? raw.timerStartedWallMs : 0,
    };
}
