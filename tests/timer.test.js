// SPDX-License-Identifier: GPL-2.0

import {defineTests, equal, ok} from './harness.js';
import {fakeClock} from './helpers.js';
import {Timer, State} from '../lib/timer.js';
import {Kind} from '../lib/schedule.js';

const DUR = {POMODORO: 1500000, SHORT_BREAK: 300000, LONG_BREAK: 900000};

function newTimer(clock, overrides = {}) {
    return new Timer({
        durations: {...DUR, ...overrides.durations},
        setSize: overrides.setSize ?? 4,
        now: clock.now,
    });
}

export const tests = defineTests(test => {
    test('start reports the full interval as remaining', () => {
        const clock = fakeClock();
        const t = newTimer(clock);
        t.start();
        equal(t.state, State.RUNNING);
        equal(t.kind, Kind.POMODORO);
        equal(t.remainingMs, 1500000);
    });

    test('an interval that has not expired does not complete', () => {
        const clock = fakeClock();
        const t = newTimer(clock);
        t.start();
        clock.advance(1500000 - 1);
        equal(t.tick(), null);
        equal(t.remainingMs, 1);
    });

    test('expiry returns a completed record and moves to the short break', () => {
        const clock = fakeClock();
        const t = newTimer(clock);
        t.start();
        clock.advance(1500000);
        const event = t.tick();
        equal(event.outcome, 'completed');
        equal(event.restored, false);
        equal(event.record.kind, Kind.POMODORO);
        equal(event.record.actualMs, 1500000);
        equal(event.record.plannedMs, 1500000);
        equal(event.record.outcome, 'completed');
        equal(t.state, State.IDLE);
        equal(t.kind, Kind.SHORT_BREAK);
        equal(t.slot, 1);
    });

    test('a long pause does not complete the interval on resume', () => {
        const clock = fakeClock();
        const t = newTimer(clock);
        t.start();
        clock.advance(10000);
        t.pause();
        clock.advance(3600000);
        t.resume();
        equal(t.remainingMs, 1490000);
        equal(t.tick(), null);
    });

    test('paused time is excluded from actualMs of a skipped interval', () => {
        const clock = fakeClock();
        const t = newTimer(clock);
        t.start();
        clock.advance(60000);
        t.pause();
        clock.advance(600000);
        const record = t.skip();
        equal(record.outcome, 'skipped');
        equal(record.actualMs, 60000);
    });

    test('skip advances the schedule without counting a completed pomodoro', () => {
        const clock = fakeClock();
        const t = newTimer(clock);
        t.start();
        clock.advance(1000);
        const record = t.skip();
        equal(record.outcome, 'skipped');
        equal(t.kind, Kind.SHORT_BREAK);
        equal(t.slot, 1);
    });

    test('reset rewinds the same kind and keeps the slot', () => {
        const clock = fakeClock();
        const t = newTimer(clock);
        t.start();
        clock.advance(600000);
        const record = t.reset();
        equal(record.outcome, 'aborted');
        equal(record.actualMs, 600000);
        equal(t.state, State.IDLE);
        equal(t.kind, Kind.POMODORO);
        equal(t.slot, 0);
        equal(t.remainingMs, 1500000);
    });

    test('reset from idle writes nothing', () => {
        const clock = fakeClock();
        const t = newTimer(clock);
        equal(t.reset(), null);
    });

    test('a completed interval with a missed deadline is marked restored', () => {
        const clock = fakeClock();
        const t = newTimer(clock);
        t.start();
        clock.advance(1500001);
        const persisted = t.toPersisted();
        const revived = newTimer(clock);
        revived.restore(persisted);
        const event = revived.tick();
        equal(event.outcome, 'completed');
        equal(event.restored, true);
    });

    test('restore keeps a paused interval paused', () => {
        const clock = fakeClock();
        const t = newTimer(clock);
        t.start();
        clock.advance(1000);
        t.pause();
        const revived = newTimer(clock);
        revived.restore(t.toPersisted());
        equal(revived.state, State.PAUSED);
        equal(revived.remainingMs, 1499000);
    });

    test('restore of a running interval with a future deadline keeps it running', () => {
        const clock = fakeClock();
        const t = newTimer(clock);
        t.start();
        clock.advance(1000);
        const revived = newTimer(clock);
        revived.restore(t.toPersisted());
        equal(revived.state, State.RUNNING);
        equal(revived.remainingMs, 1499000);
    });

    test('a backward wall-clock jump is compensated instead of adding time', () => {
        const clock = fakeClock();
        const t = newTimer(clock);
        t.start();
        clock.advance(60000);
        const before = t.remainingMs;
        clock.setWall(clock.now.wallMs() - 300000);
        equal(t.tick(), null);
        ok(t.remainingMs <= before, `remaining grew from ${before} to ${t.remainingMs}`);
    });

    test('new durations apply to the next interval only', () => {
        const clock = fakeClock();
        const t = newTimer(clock);
        t.start();
        clock.advance(600000);
        t.setDurations({...DUR, POMODORO: 3000000});
        equal(t.remainingMs, 900000);
        clock.advance(900000);
        t.tick();
        equal(t.remainingMs, 300000);
        equal(t.toPersisted().slot, 1);
    });

    test('persisted state round-trips', () => {
        const clock = fakeClock();
        const t = newTimer(clock);
        t.start();
        clock.advance(12345);
        const revived = newTimer(clock);
        revived.restore(t.toPersisted());
        equal(revived.remainingMs, t.remainingMs);
        equal(revived.startedWallMs, t.startedWallMs);
    });

    test('a completion observed late is recorded at its deadline', () => {
        const clock = fakeClock();
        const t = newTimer(clock);
        t.start();
        clock.advance(3 * 24 * 3600 * 1000);   // three days before anyone looked again
        const revived = newTimer(clock);
        revived.restore(t.toPersisted());
        const event = revived.tick();
        equal(event.record.endedWallMs, event.record.startedWallMs + 1500000);
    });

    test('pause time before a reload is not counted as work', () => {
        const clock = fakeClock();
        const t = newTimer(clock);
        t.start();
        clock.advance(60000);
        t.pause();
        clock.advance(1800000);
        const revived = newTimer(clock);
        revived.restore(t.toPersisted());
        equal(revived.skip().actualMs, 60000);
    });

    test('the set size is public and follows the last command', () => {
        const clock = fakeClock();
        const t = newTimer(clock, {setSize: 3});
        equal(t.setSize, 3);
        t.setSetSize(5);
        equal(t.setSize, 5);
    });

    test('a set size chosen mid-set is the next set of the row', () => {
        const clock = fakeClock();
        const t = newTimer(clock, {setSize: 2});

        t.start();
        clock.advance(1500000);
        t.tick();
        equal(t.slot, 1);

        t.setSetSize(5);
        equal(t.setSize, 2, 'the running set keeps the size it started with');

        t.start();
        clock.advance(300000);
        t.tick();
        equal(t.kind, Kind.POMODORO);
        equal(t.setSize, 2);

        t.start();
        clock.advance(1500000);
        t.tick();
        equal(t.kind, Kind.LONG_BREAK, 'the set ends after its own two pomodoros');
        equal(t.slot, 2);

        t.start();
        clock.advance(900000);
        t.tick();
        equal(t.kind, Kind.POMODORO);
        equal(t.slot, 0);
        equal(t.setSize, 5, 'the next set is the size chosen mid-set');
    });

    test('a size edited while the first pomodoro of a set runs is for the next set', () => {
        const clock = fakeClock();
        const t = newTimer(clock, {setSize: 4});
        const consume = ms => {
            t.start();
            clock.advance(ms);
            t.tick();
        };

        t.start();
        t.setSetSize(6);
        equal(t.setSize, 4, 'the running set keeps the size it started with');

        clock.advance(1500000);
        t.tick();
        equal(t.slot, 1);
        // walk the set out: one break and one pomodoro per remaining slot
        for (let slot = 1; slot < 4; slot++) {
            consume(300000);
            consume(1500000);
        }
        equal(t.kind, Kind.LONG_BREAK, 'the set still ends after its own four pomodoros');
        equal(t.slot, 4);

        consume(900000);
        equal(t.kind, Kind.POMODORO);
        equal(t.setSize, 6, 'the next set is the size edited during the first one');
    });

    test('a size edited while the first pomodoro is paused is for the next set', () => {
        const clock = fakeClock();
        const t = newTimer(clock, {setSize: 4});
        t.start();
        t.pause();
        t.setSetSize(6);
        equal(t.setSize, 4);
    });

    test('a size edited before the set has started applies at once', () => {
        const clock = fakeClock();
        const t = newTimer(clock, {setSize: 4});
        t.setSetSize(6);
        equal(t.setSize, 6, 'nothing has been consumed and no interval is open');
    });

    test('the plan of the next interval is the plan while idle', () => {
        const clock = fakeClock();
        const t = newTimer(clock);
        equal(t.plannedMs, 1500000);
        t.start();
        clock.advance(1500000);
        t.tick();
        equal(t.plannedMs, 300000);
    });

    test('an open interval keeps its own plan when durations change', () => {
        const clock = fakeClock();
        const t = newTimer(clock);
        t.start();
        clock.advance(600000);
        t.setDurations({...DUR, POMODORO: 3000000});
        equal(t.plannedMs, 1500000);
        t.reset();
        equal(t.plannedMs, 3000000);
    });

    test('pause time before a resume is not counted as work after a reload', () => {
        const clock = fakeClock();
        const t = newTimer(clock);
        t.start();
        clock.advance(60000);
        t.pause();
        clock.advance(600000);
        t.resume();
        clock.advance(60000);
        const revived = newTimer(clock);   // reload while the interval runs
        revived.restore(t.toPersisted());
        equal(revived.skip().actualMs, 120000);
    });
});
