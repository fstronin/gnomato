# Gnomato

A GNOME Shell extension that runs one Interval at a time on the Pomodoro
technique and records how much focus time and rest time has been accumulated.

## Language

**Pomodoro**:
One work Interval — 25 minutes by default.
_Avoid_: session, focus block, work unit, «фокус», «задача»

**Break**:
The rest between Pomodoros. It comes as a **Short Break** (5 minutes by default)
and a **Long Break** (15 minutes by default).
_Avoid_: rest, idle, «отдых»

**Interval**:
The umbrella term for a Pomodoro or a Break — whatever the Timer is running at
the moment.
_Avoid_: session, phase, period

**Set**:
N Pomodoros in a row, followed by a Long Break. N is 4 by default.
_Avoid_: cycle, round, series, «комплект»

**Slot**:
A Pomodoro's place within a Set. Skip spends a slot exactly as a completion
does, so a Set never stretches.
_Avoid_: step, index, «шаг», «позиция в комплекте»

**Timer**:
The state machine that runs exactly one Interval at a time and moves the count
from one Interval to the next.
_Avoid_: session, engine, scheduler

**Pause**:
Suspending the count inside the current Interval: the Interval stays the same
and the remainder is kept.
_Avoid_: stop, hold

**Skip**:
Ending the current Interval early and moving on to the next one; unlike Pause,
the Interval is not resumed.
_Avoid_: stop, cancel, abort, «пропустить перерыв»

**Journal**:
The accumulating record of past Intervals: what ran, how long it lasted, how it
ended.
_Avoid_: history, log, statistics

**Today**:
The local day, midnight to midnight; the unit "today: N" is counted in. An
Interval crossing midnight is split into two records.
_Avoid_: «день», «календарный день»

## How an Interval begins

**Cue**:
The sound that marks an Interval beginning: the Pomodoro cue when a Pomodoro
begins, the Break cue when a Break begins. The two are different sounds, and a
completion announces the incoming Interval's Cue as the Interval ends, so the
Cue sounds even when the next Interval does not start itself.
_Avoid_: sound, signal, «звонок»

## How an Interval ends

**Completed**:
The Interval was counted to the end: either the Timer carried it there, or the
deadline was found to have passed already when you came back.
_Avoid_: done, finished

**Skipped**:
The Interval was closed by Skip — it spends a Slot of the Set, but does not count
towards the completed Pomodoros.
_Avoid_: cancelled, dropped

**Aborted**:
The Interval was cut short by Reset; the time actually spent is kept as the
actual time.
_Avoid_: stopped, failed

**Restored**:
A mark on the record of an Interval closed because its deadline had already
passed rather than by counting it down: the Timer was not running at that moment.
_Avoid_: recovered, восстановленный
