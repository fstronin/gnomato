// SPDX-License-Identifier: GPL-2.0

import {Kind, advanceAfter} from './schedule.js';

export {Kind};

export const State = {
    IDLE: 'IDLE',
    RUNNING: 'RUNNING',
    PAUSED: 'PAUSED',
};

/**
 * An interval is a commitment on the wall clock: it ends at `start + duration`
 * no matter what happened in between (see docs/adr/0001). So the timer keeps a
 * deadline rather than accumulating ticks, and it never pauses itself.
 *
 * A wall clock can jump backwards (NTP after resume). Left alone, that jump
 * would hand the running interval free time. `CLOCK_JUMP_TOLERANCE_MS` bounds
 * what counts as clock noise: if the remaining time grew by more than that
 * between two reads, the deadline is shifted by the growth so the countdown
 * continues where it was.
 *
 * The clock is injected so the whole state machine runs outside GNOME Shell.
 */
const CLOCK_JUMP_TOLERANCE_MS = 2000;

export class Timer {
    /**
     * @param {object} options
     * @param {{POMODORO: number, SHORT_BREAK: number, LONG_BREAK: number}} options.durations milliseconds
     * @param {number} options.setSize pomodoros per set
     * @param {{wallMs(): number}} options.now
     */
    constructor({durations, setSize, now}) {
        this._durations = {...durations};
        this._setSize = setSize;
        this._now = now;

        this._state = State.IDLE;
        this._kind = Kind.POMODORO;
        this._slot = 0;
        this._open = null;
        this._remainingMs = this._durations[this._kind];
        this._expiredOnRestore = false;
    }

    get state() {
        return this._state;
    }

    get kind() {
        return this._kind;
    }

    get slot() {
        return this._slot;
    }

    get startedWallMs() {
        return this._open?.startedWallMs ?? 0;
    }

    get endWallMs() {
        return this._open?.endWallMs ?? 0;
    }

    get remainingMs() {
        return this._computeRemaining();
    }

    start() {
        if (this._state !== State.IDLE)
            return;
        this._openInterval(this._durations[this._kind]);
        this._state = State.RUNNING;
    }

    pause() {
        if (this._state !== State.RUNNING || !this._open)
            return;
        this._remainingMs = this._computeRemaining();
        this._open.pausedAtMs = this._now.wallMs();
        this._open.endWallMs = null;
        this._state = State.PAUSED;
    }

    resume() {
        if (this._state !== State.PAUSED || !this._open)
            return;
        const wall = this._now.wallMs();
        if (this._open.pausedAtMs !== null)
            this._open.pausedAccumMs += wall - this._open.pausedAtMs;
        this._open.pausedAtMs = null;
        this._open.endWallMs = wall + this._remainingMs;
        this._open.lastRemainingMs = this._remainingMs;
        this._state = State.RUNNING;
    }

    /**
     * New lengths are for the next interval: the running one keeps the deadline
     * it was started with.
     */
    setDurations(durations) {
        this._durations = {...durations};
        if (this._state === State.IDLE)
            this._remainingMs = this._durations[this._kind];
    }

    /** Applies to the next interval, like `setDurations`. */
    setSetSize(setSize) {
        this._setSize = setSize;
    }

    /**
     * @returns {null|{outcome: 'completed', restored: boolean, record: object}}
     */
    tick() {
        if (this._state !== State.RUNNING || !this._open)
            return null;
        if (this._computeRemaining() > 0)
            return null;

        const restored = this._expiredOnRestore;
        this._expiredOnRestore = false;
        const record = this._close('completed', restored);
        this._advance();
        return {outcome: 'completed', restored, record};
    }

    /** @returns {null|object} the closed interval, or null when nothing was open */
    skip() {
        if (this._state === State.IDLE || !this._open)
            return null;
        const record = this._close('skipped');
        this._advance();
        return record;
    }

    /** Rewinds the current kind; the position inside the set does not move. */
    reset() {
        if (this._state === State.IDLE || !this._open)
            return null;
        return this._close('aborted');
    }

    toPersisted() {
        return {
            state: this._state,
            kind: this._kind,
            slot: this._slot,
            endWallMs: this.endWallMs,
            remainingMs: this._state === State.RUNNING ? this.remainingMs : this._remainingMs,
            startedWallMs: this.startedWallMs,
        };
    }

    /**
     * Restores as it was: a running interval keeps running, a paused one stays
     * paused. An interval whose deadline has already passed is left for the next
     * `tick()` to close, marked `restored` — the timer was not there to observe it.
     */
    restore(values) {
        this._state = values.state;
        this._kind = values.kind;
        this._slot = values.slot;
        this._remainingMs = values.remainingMs;
        this._expiredOnRestore = false;

        if (this._state === State.IDLE) {
            this._open = null;
            this._remainingMs = this._durations[this._kind];
            return;
        }

        const wall = this._now.wallMs();
        const plannedMs = this._durations[this._kind];
        // Wall time that was not spent running was spent paused: the countdown
        // consumed exactly `plannedMs - remainingMs` of running time. Deriving
        // it here keeps a pause that happened before the reload out of the row.
        const runMs = Math.max(0, plannedMs - values.remainingMs);
        const pausedAccumMs = Math.max(0, wall - values.startedWallMs - runMs);

        this._open = {
            plannedMs,
            startedWallMs: values.startedWallMs,
            endWallMs: this._state === State.RUNNING ? values.endWallMs : null,
            pausedAccumMs,
            pausedAtMs: this._state === State.PAUSED ? wall : null,
            lastRemainingMs: values.remainingMs,
        };

        if (this._state === State.RUNNING && values.endWallMs <= wall)
            this._expiredOnRestore = true;
    }

    _openInterval(plannedMs) {
        const wall = this._now.wallMs();
        this._open = {
            plannedMs,
            startedWallMs: wall,
            endWallMs: wall + plannedMs,
            pausedAccumMs: 0,
            pausedAtMs: null,
            lastRemainingMs: plannedMs,
        };
        this._remainingMs = plannedMs;
    }

    _computeRemaining() {
        if (this._state !== State.RUNNING || !this._open)
            return this._remainingMs;

        const open = this._open;
        let remaining = open.endWallMs - this._now.wallMs();

        if (remaining > open.lastRemainingMs + CLOCK_JUMP_TOLERANCE_MS) {
            console.debug(`gnomato: wall clock moved back by ${remaining - open.lastRemainingMs}ms, deadline shifted`);
            open.endWallMs += remaining - open.lastRemainingMs;
            remaining = open.lastRemainingMs;
        }

        remaining = Math.max(0, remaining);
        open.lastRemainingMs = remaining;
        return remaining;
    }

    _close(outcome, restored = false) {
        const open = this._open;
        // A completed interval ends at its deadline, not at the moment someone
        // looked at it: after a suspend or a restart those can be days apart,
        // and the journal must attribute the seconds to the day it ran on.
        const endedWallMs = outcome === 'completed' ? open.endWallMs : this._now.wallMs();
        const pauseExtra = open.pausedAtMs === null ? 0 : endedWallMs - open.pausedAtMs;
        const elapsedMs = endedWallMs - open.startedWallMs - open.pausedAccumMs - pauseExtra;

        const record = {
            intervalId: open.startedWallMs,
            kind: this._kind,
            plannedMs: open.plannedMs,
            actualMs: outcome === 'completed'
                ? open.plannedMs
                : Math.max(0, Math.min(elapsedMs, open.plannedMs)),
            outcome,
            restored,
            startedWallMs: open.startedWallMs,
            endedWallMs,
            slot: this._slot,
            setSize: this._setSize,
        };

        this._open = null;
        this._state = State.IDLE;
        this._remainingMs = this._durations[this._kind];
        return record;
    }

    _advance() {
        const next = advanceAfter(this._kind, this._slot, this._setSize);
        this._kind = next.kind;
        this._slot = next.slot;
        this._remainingMs = this._durations[this._kind];
    }
}
