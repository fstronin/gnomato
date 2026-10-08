# Gnomato

Расширение GNOME Shell, которое ведёт один Interval за раз по технике Помодоро и записывает, сколько времени фокусировки и отдыха набрано.

## Language

**Pomodoro**:
Один Interval работы — по умолчанию 25 минут.
_Avoid_: session, focus block, work unit, «фокус», «задача»

**Break**:
Перерыв между Pomodoro. Бывает **Short Break** (по умолчанию 5 минут) и **Long Break** (по умолчанию 15 минут).
_Avoid_: rest, idle, «отдых»

**Interval**:
Родовое понятие для Pomodoro или Break — то, что Timer ведёт в данный момент.
_Avoid_: session, phase, period

**Set**:
N Pomodoro подряд, после которых идёт Long Break. N по умолчанию 4.
_Avoid_: cycle, round, series, «комплект»

**Timer**:
Автомат, который ведёт ровно один Interval за раз и переводит счёт от одного Interval к следующему.
_Avoid_: session, engine, scheduler

**Pause**:
Приостановка счёта внутри текущего Interval: Interval остаётся тем же, остаток сохраняется.
_Avoid_: stop, hold

**Skip**:
Досрочное завершение текущего Interval с переходом к следующему; в отличие от Pause, Interval не возобновляется.
_Avoid_: stop, cancel, abort, «пропустить перерыв»

**Journal**:
Накопительная запись прошедших Interval: что шло, сколько длилось, чем закончилось.
_Avoid_: history, log, statistics

**Today**:
Локальные сутки, от полуночи до полуночи; единица, по которой считается «сегодня: N». Interval, пересекающий полночь, делится на две записи.
_Avoid_: день, календарный день

## Как Interval заканчивается

**Completed**:
Interval отсчитан до конца: либо Timer его довёл, либо по возвращении обнаружилось, что дедлайн уже прошёл.
_Avoid_: done, finished

**Skipped**:
Interval закрыт командой Skip — расходует слот Set, но в число завершённых Pomodoro не входит.
_Avoid_: cancelled, dropped

**Aborted**:
Interval прерван командой Reset; набранное время сохраняется как фактическое.
_Avoid_: stopped, failed

**Restored**:
Отметка на записи Interval, закрытого по обнаруженному прошедшему дедлайну, а не по отсчёту: в этот момент Timer не работал.
_Avoid_: recovered, восстановленный
