# Gnomato Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Расширение GNOME Shell 50, которое ведёт один Interval за раз по технике Помодоро, показывает отсчёт в панели и пишет Journal прошедших Interval.

**Architecture:** Одно расширение ESM без сборки. Чистая логика (автомат состояний, Set, арифметика дедлайна, записи Journal, маппинг GSettings) живёт в `lib/*.js` и запускается под обычным `gjs` вне shell — там её и проверяют скрипты-ассерты. Всё, что требует shell (панель, меню, уведомления, звук), живёт в `extension.js` и `ui/indicator.js`; prefs — отдельный процесс на Adw/Gtk4. Живое состояние Timer переносится через GSettings, записи Journal — append-only файл, поэтому перезапуск шелла, экран блокировки и сон ничего не теряют.

**Tech Stack:** GJS 1.88 (ESM), GNOME Shell 50.1, Gio/GLib, GSettings + `glib-compile-schemas`, Adw/Gtk4 в prefs, `gjs -m` как тест-раннер, deb-упаковка вручную.

**Spec:** `docs/spec.md` (среда, решения, что вне области), `CONTEXT.md` (термины), `docs/adr/0001-wall-clock-interval-semantics.md`, `docs/adr/0002-deb-package-distribution.md`. План спорит от спеки — исполнитель читает оба документа.

## Global Constraints

- GNOME Shell 50.1, gjs 1.88, только ESM: `import X from 'gi://X'` и `resource:///org/gnome/shell/...`. Никаких `imports.*`.
- `metadata.json`: `uuid` = `gnomato@fstronin`, `name` = `Gnomato`, `shell-version` = `["50"]`, `version` = 1, `settings-schema` = `org.gnome.shell.extensions.gnomato`, `gettext-domain` = `gnomato@fstronin`. Имя каталога расширения обязано совпадать с `uuid`.
- `lib/*.js` не импортирует ничего из shell (`Main`, `St`, `Clutter`, `PanelMenu`, `PopupMenu`, `Meta`, `Shell`) — только относительные модули и `gi://GLib`/`gi://Gio`. Иначе модуль нельзя запустить под `gjs -m`.
- `extension.js` не импортирует Gtk/Adw; `prefs.js` не импортирует St/Clutter/Meta/Shell/Main.
- Симметрия `enable()`/`disable()`: на уровне модуля не создаётся ни один объект, сигнал или источник; в `disable()` удаляются **все** источники (`GLib.source_remove`, даже если колбэк возвращает `SOURCE_REMOVE`), разрываются все `connect`, уничтожается индикатор.
- Схема: id `org.gnome.shell.extensions.gnomato`, path `/org/gnome/shell/extensions/gnomato/`, файл `schemas/org.gnome.shell.extensions.gnomato.gschema.xml`, компилируется `glib-compile-schemas` в `schemas/gschemas.compiled` и коммитится в дерево.
- Длительности: в схеме секунды (1500 / 300 / 900), в prefs целые минуты 1–180, размер Set 1–12 (по умолчанию 4).
- Путь Journal: `GLib.get_user_state_dir()/gnomato/journal.jsonl`.
- Все пользовательские строки — через gettext: `this.gettext` в расширении, `this.gettext` у `ExtensionPreferences` в prefs. Каталог `po/` не создаётся.
- В каждом `.js` первой строкой SPDX-заголовок `// SPDX-License-Identifier: GPL-2.0`; в корне `LICENSE` (GPL-2.0).
- Тесты: `gjs -m tests/run-tests.js`, ненулевой код возврата при падении. Тесты не пишут вне `GLib.get_tmp_dir()` и никуда не ходят по сети.
- Коммит после каждой задачи.

## File Structure

| Путь | Ответственность |
|---|---|
| `metadata.json` | манифест расширения |
| `schemas/org.gnome.shell.extensions.gnomato.gschema.xml` | все настройки и `timer-*` ключи состояния |
| `lib/format.js` | форматирование остатка для панели |
| `lib/schedule.js` | `Kind`, порядок Interval и Set, политика авто-старта |
| `lib/timer.js` | автомат состояний, арифметика дедлайна, восстановление |
| `lib/journal.js` | построение записей, разбиение по полуночи, счёт завершённых Pomodoro |
| `lib/journalfile.js` | путь Journal, append и чтение JSONL через Gio |
| `lib/state.js` | маппинг состояния Timer ↔ значения GSettings |
| `ui/indicator.js` | панельная кнопка, label, popup-меню |
| `extension.js` | жизненный цикл, связывание Timer/индикатора/Journal/уведомлений, хоткеи |
| `prefs.js` | окно настроек на Adw/Gtk4 |
| `tests/harness.js`, `tests/run-tests.js`, `tests/*.test.js` | тест-раннер и тесты чистой логики |
| `debian/`, `build-deb.sh`, `README.md` | упаковка и документация установки |

---

### Task 1: Скелет расширения, которое загружается

**Files:**
- Create: `metadata.json`, `schemas/org.gnome.shell.extensions.gnomato.gschema.xml`, `extension.js`, `ui/indicator.js`, `LICENSE`, `.gitignore`

**Interfaces:**
- Produces: `ui/indicator.js` → `export const GnomatoIndicator` (класс `PanelMenu.Button`, `_init()` без настроек; расширенные методы добавляет Task 8).
- Produces: схема `org.gnome.shell.extensions.gnomato` с ключами `pomodoro-seconds`, `short-break-seconds`, `long-break-seconds`, `set-size`, `auto-start-breaks`, `auto-start-work`, `sound-enabled`, `toggle-keybinding`, `skip-keybinding`, `timer-state`, `timer-kind`, `timer-slot`, `timer-end-wall-ms`, `timer-remaining-ms`, `timer-started-wall-ms`.

- [ ] **Step 1: Инициализировать репозиторий и лицензию**

```bash
git init
cp /usr/share/common-licenses/GPL-2 .
mv GPL-2 LICENSE
printf '*.deb\n*.zip\n' > .gitignore
```

- [ ] **Step 2: Написать `metadata.json`**

```json
{
  "uuid": "gnomato@fstronin",
  "name": "Gnomato",
  "description": "Pomodoro timer: counts down one interval at a time in the panel and keeps a journal of finished focus and break intervals.",
  "shell-version": ["50"],
  "version": 1,
  "settings-schema": "org.gnome.shell.extensions.gnomato",
  "gettext-domain": "gnomato@fstronin"
}
```

- [ ] **Step 3: Написать схему `schemas/org.gnome.shell.extensions.gnomato.gschema.xml`**

Ключи и точные значения: `pomodoro-seconds` (i, 1500, range 60–10800), `short-break-seconds` (i, 300, 60–10800), `long-break-seconds` (i, 900, 60–10800), `set-size` (i, 4, 1–12), `auto-start-breaks` (b, true), `auto-start-work` (b, false), `sound-enabled` (b, true), `toggle-keybinding` (as, `[]`), `skip-keybinding` (as, `[]`), `timer-state` (s, `IDLE`), `timer-kind` (s, `POMODORO`), `timer-slot` (i, 0), `timer-end-wall-ms` (x, 0), `timer-remaining-ms` (x, 1500000), `timer-started-wall-ms` (x, 0). У каждого ключа `<summary>` и `<description>`; `<schema id="org.gnome.shell.extensions.gnomato" path="/org/gnome/shell/extensions/gnomato/">`.

- [ ] **Step 4: Скомпилировать схему и проверить**

Run: `glib-compile-schemas schemas/`
Expected: код возврата 0, появился `schemas/gschemas.compiled`.
Проверка значений: `GSETTINGS_SCHEMA_DIR=./schemas gsettings get org.gnome.shell.extensions.gnomato pomodoro-seconds` → `1500`.

- [ ] **Step 5: Написать минимальные `ui/indicator.js` и `extension.js`**

`ui/indicator.js`: `GObject.registerClass` вокруг `PanelMenu.Button`, `_init()` вызывает `super._init(0.0, 'Gnomato', false)`, кладёт `St.BoxLayout` с `St.Icon({icon_name: 'alarm-symbolic', style_class: 'system-status-icon'})` и пустым `PopupMenu` (`super._init` уже создаёт `this.menu`).
`extension.js`: `export default class GnomatoExtension extends Extension` с `enable()`, который создаёт индикатор и вызывает `Main.panel.addToStatusArea(this.uuid, this._indicator)`, и `disable()`, который уничтожает индикатор и обнуляет поле.

- [ ] **Step 6: Поставить в сессию и проверить загрузку**

```bash
mkdir -p ~/.local/share/gnome-shell/extensions
ln -s /home/fstronin/Fun/gnomato ~/.local/share/gnome-shell/extensions/gnomato@fstronin
gnome-extensions list | grep gnomato@fstronin
gnome-extensions enable gnomato@fstronin
gnome-extensions info gnomato@fstronin
```

Expected: расширение видно в списке, `State: ACTIVE`, в панели — иконка `alarm-symbolic`, клик открывает пустое меню.
Если `list` его не показывает — перезайти в сессию (Wayland не умеет перезапускать shell) и повторить; если и после этого не видно, заменить симлинк копией (`cp -r`) и записать это в README как dev-процедуру.
Лог без исключений: `journalctl -f -o cat /usr/bin/gnome-shell` (в отдельном терминале).

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: extension skeleton with panel button and settings schema"
```

---

### Task 2: Формат отсчёта и тест-харнесс

**Files:**
- Create: `lib/format.js`, `tests/harness.js`, `tests/run-tests.js`, `tests/format.test.js`

**Interfaces:**
- Produces: `formatRemaining(ms: number) -> string` — `MM:SS`, минуты без ведущего нуля, секунды двумя цифрами, округление вверх, отрицательное и ноль → `0:00`.
- Produces: `tests/harness.js` → `defineTests(body) -> Array<{name, fn}>`, `equal(actual, expected, msg?)`, `ok(value, msg?)`, `deepEqual(actual, expected, msg?)`, `throws(fn, msg?)`.
- Produces: `tests/run-tests.js` — раннер; список сьютов расширяется по мере появления `tests/*.test.js`.

- [ ] **Step 1: Написать тесты**

`tests/format.test.js`:

```js
import {defineTests, equal} from './harness.js';
import {formatRemaining} from '../lib/format.js';

export const tests = defineTests(test => {
  test('full pomodoro renders as 25:00', () => equal(formatRemaining(1500000), '25:00'));
  test('rounds up so the first second still shows the full value', () => equal(formatRemaining(1499000), '24:59'));
  test('sub-second remainder shows a full second', () => equal(formatRemaining(999), '0:01'));
  test('zero renders as 0:00', () => equal(formatRemaining(0), '0:00'));
  test('negative remaining clamps to 0:00', () => equal(formatRemaining(-5), '0:00'));
  test('minutes are not padded past 59', () => equal(formatRemaining(3600000), '60:00'));
  test('a single minute is 1:00', () => equal(formatRemaining(60000), '1:00'));
});
```

- [ ] **Step 2: Написать раннер и харнесс**, затем запустить тесты и убедиться, что они падают

`tests/run-tests.js` импортирует `tests as formatTests from './format.test.js'`, прогоняет каждую пару `{name, fn}`, печатает `ok - <suite>: <name>` / `not ok - <suite>: <name>` с сообщением ошибки, в конце печатает число падений и вызывает `system.exit(1)`, если падений больше нуля (`import system from 'system'`).
`tests/harness.js` реализует `defineTests`, `equal`, `ok`, `deepEqual` (сравнение через `JSON.stringify`), `throws`.

Run: `gjs -m tests/run-tests.js`
Expected: FAIL — `Cannot find module '../lib/format.js'`; код возврата ненулевой.

- [ ] **Step 3: Реализовать `formatRemaining`**

Секунды: `Math.ceil(ms / 1000)`, отрицательное значение → 0. Минуты: `Math.floor(s / 60)`, секунды: `s % 60`, секунды дополняются до двух цифр.

- [ ] **Step 4: Прогнать тесты**

Run: `gjs -m tests/run-tests.js`
Expected: PASS, `7 passing`, код возврата 0.

- [ ] **Step 5: Commit**

```bash
git add lib/format.js tests && git commit -m "feat: interval countdown formatting with gjs test harness"
```

---

### Task 3: Порядок Interval и политика авто-старта

**Files:**
- Create: `lib/schedule.js`, `tests/schedule.test.js`
- Modify: `tests/run-tests.js` (добавить сьют)

**Interfaces:**
- Produces: `Kind` = `{POMODORO: 'POMODORO', SHORT_BREAK: 'SHORT_BREAK', LONG_BREAK: 'LONG_BREAK'}`.
- Produces: `isBreak(kind) -> boolean`.
- Produces: `advanceAfter(kind, slot, setSize) -> {kind, slot}` — `slot` это число израсходованных слотов Set до текущего Interval; Skip расходует слот так же, как завершение.
- Produces: `shouldAutoStart(nextKind, {autoStartBreaks, autoStartWork}) -> boolean`.

- [ ] **Step 1: Написать тесты**

```js
import {defineTests, deepEqual, equal, ok} from './harness.js';
import {Kind, advanceAfter, isBreak, shouldAutoStart} from '../lib/schedule.js';

export const tests = defineTests(test => {
  test('after the first pomodoro comes a short break', () =>
    deepEqual(advanceAfter(Kind.POMODORO, 0, 4), {kind: Kind.SHORT_BREAK, slot: 1}));
  test('the fourth pomodoro leads to a long break', () =>
    deepEqual(advanceAfter(Kind.POMODORO, 3, 4), {kind: Kind.LONG_BREAK, slot: 4}));
  test('the long break resets the set', () =>
    deepEqual(advanceAfter(Kind.LONG_BREAK, 4, 4), {kind: Kind.POMODORO, slot: 0}));
  test('a short break keeps the slot', () =>
    deepEqual(advanceAfter(Kind.SHORT_BREAK, 2, 4), {kind: Kind.POMODORO, slot: 2}));
  test('set size 1 makes every pomodoro the last one', () =>
    deepEqual(advanceAfter(Kind.POMODORO, 0, 1), {kind: Kind.LONG_BREAK, slot: 1}));
  test('breaks are recognised', () => {
    ok(isBreak(Kind.SHORT_BREAK));
    ok(isBreak(Kind.LONG_BREAK));
    ok(!isBreak(Kind.POMODORO));
  });
  test('work does not auto-start with default policy', () =>
    equal(shouldAutoStart(Kind.POMODORO, {autoStartBreaks: true, autoStartWork: false}), false));
  test('breaks auto-start with default policy', () =>
    equal(shouldAutoStart(Kind.SHORT_BREAK, {autoStartBreaks: true, autoStartWork: false}), true));
});
```

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `gjs -m tests/run-tests.js`
Expected: FAIL — модуль `../lib/schedule.js` не найден.

- [ ] **Step 3: Реализовать `lib/schedule.js`**

`advanceAfter`: после `POMODORO` считать `consumed = slot + 1`; если `consumed >= setSize` → `LONG_BREAK` с `slot: consumed`, иначе `SHORT_BREAK` с `slot: consumed`. После `SHORT_BREAK` → `POMODORO` с тем же `slot`. После `LONG_BREAK` → `POMODORO` с `slot: 0`.

- [ ] **Step 4: Прогнать тесты**

Run: `gjs -m tests/run-tests.js`
Expected: PASS, `15 passing`.

- [ ] **Step 5: Commit**

```bash
git add lib/schedule.js tests && git commit -m "feat: set order and auto-start policy"
```

---

### Task 4: Автомат Timer

**Files:**
- Create: `lib/timer.js`, `tests/helpers.js`, `tests/timer.test.js`
- Modify: `tests/run-tests.js`

**Interfaces:**
- Consumes: `Kind`, `advanceAfter` из Task 3.
- Produces: `State` = `{IDLE: 'IDLE', RUNNING: 'RUNNING', PAUSED: 'PAUSED'}`.
- Produces: `new Timer({durations, setSize, now})`, где `durations` = `{POMODORO: ms, SHORT_BREAK: ms, LONG_BREAK: ms}`, `now` = `{wallMs(): number}`.
- Produces: геттеры `state`, `kind`, `slot`, `startedWallMs`, `endWallMs`, `remainingMs`.
- Produces: команды `start()`, `pause()`, `resume()`, `setDurations(durations)`, `setSetSize(n)`, `tick()`, `skip()`, `reset()`, `toPersisted()`, `restore(values)`.
- Produces: `ClosedInterval` = `{intervalId, kind, plannedMs, actualMs, outcome, restored, startedWallMs, endedWallMs, slot, setSize}`; `outcome` ∈ `'completed' | 'skipped' | 'aborted'`; `intervalId` = `startedWallMs`.
- Produces: `tests/helpers.js` → `fakeClock(startWallMs?) -> {now, advance(ms), setWall(ms)}`.

Поведение, которое обязано быть реализовано: `tick()` возвращает `null` вне RUNNING; по исчерпании остатка возвращает `{outcome: 'completed', restored, record}`, переводит Timer в IDLE и сдвигает `kind`/`slot` по `advanceAfter`. `skip()` закрывает Interval как `'skipped'` и сдвигает позицию, `reset()` закрывает как `'aborted'`, позицию не сдвигает и возвращает остаток к полной длительности текущего `kind`; `reset()` из IDLE возвращает `null` и записи не создаёт. `setDurations`/`setSetSize` не влияют на идущий Interval и действуют со следующего. `restore()` при `state: RUNNING` и уже прошедшем дедлайне помечает завершение как `restored: true`.

- [ ] **Step 1: Написать тесты**

```js
import {defineTests, equal, ok} from './harness.js';
import {fakeClock} from './helpers.js';
import {Timer, State} from '../lib/timer.js';
import {Kind} from '../lib/schedule.js';

const DUR = {POMODORO: 1500000, SHORT_BREAK: 300000, LONG_BREAK: 900000};

function newTimer(clock, overrides = {}) {
  return new Timer({durations: {...DUR, ...overrides.durations}, setSize: overrides.setSize ?? 4, now: clock.now});
}

export const tests = defineTests(test => {
  test('start reports the full interval as remaining', () => {
    const clock = fakeClock(); const t = newTimer(clock);
    t.start();
    equal(t.state, State.RUNNING); equal(t.kind, Kind.POMODORO); equal(t.remainingMs, 1500000);
  });

  test('an interval that has not expired does not complete', () => {
    const clock = fakeClock(); const t = newTimer(clock);
    t.start(); clock.advance(1500000 - 1);
    equal(t.tick(), null); equal(t.remainingMs, 1);
  });

  test('expiry returns a completed record and moves to the short break', () => {
    const clock = fakeClock(); const t = newTimer(clock);
    t.start(); clock.advance(1500000);
    const event = t.tick();
    equal(event.outcome, 'completed'); equal(event.restored, false);
    equal(event.record.kind, Kind.POMODORO); equal(event.record.actualMs, 1500000);
    equal(event.record.outcome, 'completed'); equal(event.record.plannedMs, 1500000);
    equal(t.state, State.IDLE); equal(t.kind, Kind.SHORT_BREAK); equal(t.slot, 1);
  });

  test('a long pause does not complete the interval on resume', () => {
    const clock = fakeClock(); const t = newTimer(clock);
    t.start(); clock.advance(10000); t.pause(); clock.advance(3600000); t.resume();
    equal(t.remainingMs, 1490000); equal(t.tick(), null);
  });

  test('paused time is excluded from actualMs of a skipped interval', () => {
    const clock = fakeClock(); const t = newTimer(clock);
    t.start(); clock.advance(60000); t.pause(); clock.advance(600000);
    const record = t.skip();
    equal(record.outcome, 'skipped'); equal(record.actualMs, 60000);
  });

  test('skip advances the schedule without counting a completed pomodoro', () => {
    const clock = fakeClock(); const t = newTimer(clock);
    t.start(); clock.advance(1000);
    const record = t.skip();
    equal(record.outcome, 'skipped'); equal(t.kind, Kind.SHORT_BREAK); equal(t.slot, 1);
  });

  test('reset rewinds the same kind and keeps the slot', () => {
    const clock = fakeClock(); const t = newTimer(clock);
    t.start(); clock.advance(600000);
    const record = t.reset();
    equal(record.outcome, 'aborted'); equal(record.actualMs, 600000);
    equal(t.state, State.IDLE); equal(t.kind, Kind.POMODORO); equal(t.slot, 0);
    equal(t.remainingMs, 1500000);
  });

  test('reset from idle writes nothing', () => {
    const clock = fakeClock(); const t = newTimer(clock);
    equal(t.reset(), null);
  });

  test('a completed interval with a missed deadline is marked restored', () => {
    const clock = fakeClock(); const t = newTimer(clock);
    t.start(); clock.advance(1500001);
    const persisted = t.toPersisted();
    const revived = newTimer(clock); revived.restore(persisted);
    const event = revived.tick();
    equal(event.outcome, 'completed'); equal(event.restored, true);
  });

  test('restore keeps a paused interval paused', () => {
    const clock = fakeClock(); const t = newTimer(clock);
    t.start(); clock.advance(1000); t.pause();
    const revived = newTimer(clock); revived.restore(t.toPersisted());
    equal(revived.state, State.PAUSED); equal(revived.remainingMs, 1499000);
  });

  test('restore of a running interval with a future deadline keeps it running', () => {
    const clock = fakeClock(); const t = newTimer(clock);
    t.start(); clock.advance(1000);
    const revived = newTimer(clock); revived.restore(t.toPersisted());
    equal(revived.state, State.RUNNING); equal(revived.remainingMs, 1499000);
  });

  test('a backward wall-clock jump is compensated instead of adding time', () => {
    const clock = fakeClock(); const t = newTimer(clock);
    t.start(); clock.advance(60000);
    const before = t.remainingMs;
    clock.setWall(clock.now.wallMs() - 300000);   // NTP sync back, monotonic untouched
    equal(t.tick(), null);
    ok(t.remainingMs <= before, `remaining grew from ${before} to ${t.remainingMs}`);
  });

  test('new durations apply to the next interval only', () => {
    const clock = fakeClock(); const t = newTimer(clock);
    t.start(); clock.advance(600000);
    t.setDurations({...DUR, POMODORO: 3000000});
    equal(t.remainingMs, 900000);
    clock.advance(900000); t.tick();
    equal(t.remainingMs, 300000);   // short break is still the old 5 minutes
    equal(t.toPersisted().slot, 1);
  });

  test('persisted state round-trips', () => {
    const clock = fakeClock(); const t = newTimer(clock);
    t.start(); clock.advance(12345);
    const revived = newTimer(clock); revived.restore(t.toPersisted());
    equal(revived.remainingMs, t.remainingMs);
    equal(revived.startedWallMs, t.startedWallMs);
  });
});
```

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `gjs -m tests/run-tests.js`
Expected: FAIL — `../lib/timer.js` не найден.

- [ ] **Step 3: Реализовать `lib/timer.js` и `tests/helpers.js`**

`fakeClock(startWallMs = 1700000000000)`: `advance(ms)` двигает часы вперёд, `setWall(ms)` ставит их в произвольное значение — так моделируется скачок часов.
Внутри Timer хранить `_open = {kind, slot, setSize, plannedMs, startedWallMs, endWallMs, pausedRemainingMs, pausedAccumMs, lastRemainingMs}` и закрывать Interval единой функцией, которая считает `actualMs`: для `completed` — `plannedMs`, для `skipped`/`aborted` — `endedWallMs - startedWallMs - pausedAccumMs`, зажатое в `[0, plannedMs]`. В `tick()` после расчёта остатка: если он вырос больше чем на 2 секунды относительно предыдущего тика — сдвинуть `endWallMs` на величину роста (компенсация обратного скачка часов). `restore()` при `RUNNING` и `endWallMs <= now.wallMs()` помечает `_expiredOnRestore = true`, чтобы первый `tick()` вернул `restored: true`. `resume()` восстанавливает дедлайн от `remainingMs`.

- [ ] **Step 4: Прогнать тесты**

Run: `gjs -m tests/run-tests.js`
Expected: PASS, `29 passing`.

- [ ] **Step 5: Commit**

```bash
git add lib/timer.js tests && git commit -m "feat: timer state machine with wall-clock deadline"
```

---

### Task 5: Записи Journal и разбиение по полуночи

**Files:**
- Create: `lib/journal.js`, `tests/journal.test.js`
- Modify: `tests/run-tests.js`

**Interfaces:**
- Consumes: `ClosedInterval` из Task 4.
- Produces: `dayKey(wallMs) -> string` (`YYYY-MM-DD` по локальному времени).
- Produces: `makeRecords(closed) -> Array<Record>`, где `Record` = `{v: 1, interval_id, day, part, started_ms, ended_ms, kind, planned_s, actual_s, outcome, restored, set_index, set_size}`; при пересечении полуночи возвращаются две записи, `planned_s` присутствует только у `part: 1`, сумма `actual_s` равна секундам закрытого Interval.
- Produces: `todayCount(records, key) -> number` — считает записи с `outcome === 'completed'`, `part === 1` и `day === key`.

- [ ] **Step 1: Написать тесты**

```js
import GLib from 'gi://GLib';
import {defineTests, equal} from './harness.js';
import {dayKey, makeRecords, todayCount} from '../lib/journal.js';

const localMs = (y, mo, d, h, mi, s = 0) => GLib.DateTime.new_local(y, mo, d, h, mi, s).to_unix() * 1000;

const closed = (over = {}) => ({
  intervalId: localMs(2026, 10, 8, 10, 0), kind: 'POMODORO', plannedMs: 1500000, actualMs: 1500000,
  outcome: 'completed', restored: false, startedWallMs: localMs(2026, 10, 8, 10, 0),
  endedWallMs: localMs(2026, 10, 8, 10, 25), slot: 0, setSize: 4, ...over,
});

export const tests = defineTests(test => {
  test('an interval inside one day becomes a single first-part record', () => {
    const records = makeRecords(closed());
    equal(records.length, 1);
    equal(records[0].day, '2026-10-08'); equal(records[0].part, 1);
    equal(records[0].planned_s, 1500); equal(records[0].actual_s, 1500);
    equal(records[0].outcome, 'completed'); equal(records[0].restored, false);
    equal(records[0].set_index, 0); equal(records[0].set_size, 4);
  });

  test('an interval crossing local midnight splits into two parts', () => {
    const records = makeRecords(closed({
      startedWallMs: localMs(2026, 10, 8, 23, 50), endedWallMs: localMs(2026, 10, 9, 0, 15),
      intervalId: localMs(2026, 10, 8, 23, 50), actualMs: 1500000,
    }));
    equal(records.length, 2);
    equal(records[0].day, '2026-10-08'); equal(records[0].part, 1);
    equal(records[1].day, '2026-10-09'); equal(records[1].part, 2);
    equal(records[0].ended_ms, localMs(2026, 10, 9, 0, 0));
    equal(records[1].started_ms, localMs(2026, 10, 9, 0, 0));
    equal(records[0].actual_s + records[1].actual_s, 1500);
    equal(records[1].planned_s, undefined);
  });

  test('a midnight-spanning pomodoro counts once, on its start day', () => {
    const records = makeRecords(closed({
      startedWallMs: localMs(2026, 10, 8, 23, 50), endedWallMs: localMs(2026, 10, 9, 0, 15),
      intervalId: localMs(2026, 10, 8, 23, 50),
    }));
    equal(todayCount(records, '2026-10-08'), 1);
    equal(todayCount(records, '2026-10-09'), 0);
  });

  test('skipped and aborted intervals are not counted', () => {
    const aborted = makeRecords(closed({outcome: 'aborted'}));
    equal(todayCount(aborted, '2026-10-08'), 0);
    const skipped = makeRecords(closed({outcome: 'skipped'}));
    equal(todayCount(skipped, '2026-10-08'), 0);
  });

  test('a restored completion still counts once', () => {
    const records = makeRecords(closed({restored: true}));
    equal(records[0].restored, true);
    equal(todayCount(records, '2026-10-08'), 1);
  });

  test('dayKey follows local time', () => {
    equal(dayKey(localMs(2026, 10, 8, 0, 0)), '2026-10-08');
    equal(dayKey(localMs(2026, 10, 8, 23, 59, 59)), '2026-10-08');
  });
});
```

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `gjs -m tests/run-tests.js`
Expected: FAIL — `../lib/journal.js` не найден.

- [ ] **Step 3: Реализовать `lib/journal.js`**

`dayKey` — через `GLib.DateTime.new_from_unix_local(Math.floor(wallMs / 1000))`. Граница полуночи — `GLib.DateTime.new_from_unix_local(started_s).add_days(1).to_unix() * 1000`; если `endedWallMs > midnight`, отдать две записи, распределив `actual_s` пропорционально wall-времени каждой части с округлением, а остаток от округления добавив в `part: 1`, чтобы сумма сходилась. `planned_s` и `outcome`/`restored`/`set_index`/`set_size` есть в обеих частях, `planned_s` — только в первой.

- [ ] **Step 4: Прогнать тесты**

Run: `gjs -m tests/run-tests.js`
Expected: PASS, `35 passing`.

- [ ] **Step 5: Commit**

```bash
git add lib/journal.js tests && git commit -m "feat: journal records with local-midnight split"
```

---

### Task 6: Файл Journal

**Files:**
- Create: `lib/journalfile.js`, `tests/journalfile.test.js`
- Modify: `tests/run-tests.js`

**Interfaces:**
- Produces: `journalPath() -> string` = `GLib.get_user_state_dir()/gnomato/journal.jsonl`.
- Produces: `appendRecords(path, records) -> boolean` — одна JSON-строка на запись, каталог создаётся при необходимости; при ошибке возвращает `false` и логирует, не бросает.
- Produces: `readRecords(path) -> {records, skipped}` — отсутствующий файл даёт `{records: [], skipped: 0}`; строки, которые не парсятся, считаются в `skipped` и не прерывают чтение.

- [ ] **Step 1: Написать тесты**

```js
import GLib from 'gi://GLib';
import {defineTests, equal, ok} from './harness.js';
import {appendRecords, readRecords} from '../lib/journalfile.js';

const tmpPath = () => GLib.build_filenamev([GLib.get_tmp_dir(),
  `gnomato-test-${GLib.get_monotonic_time()}`, 'nested', 'journal.jsonl']);

const rec = over => ({v: 1, interval_id: 1, day: '2026-10-08', part: 1, started_ms: 1,
  ended_ms: 2, kind: 'POMODORO', planned_s: 1500, actual_s: 1500, outcome: 'completed',
  restored: false, set_index: 0, set_size: 4, ...over});

export const tests = defineTests(test => {
  test('missing file reads as empty', () => {
    const result = readRecords(tmpPath());
    equal(result.records.length, 0); equal(result.skipped, 0);
  });

  test('appended records come back in order', () => {
    const path = tmpPath();
    ok(appendRecords(path, [rec({started_ms: 1}), rec({started_ms: 2})]));
    const {records, skipped} = readRecords(path);
    equal(records.length, 2); equal(skipped, 0);
    equal(records[0].started_ms, 1); equal(records[1].started_ms, 2);
  });

  test('a corrupt or truncated line is skipped without losing earlier records', () => {
    const path = tmpPath();
    appendRecords(path, [rec({started_ms: 1})]);
    const file = Gio.File.new_for_path(path);
    const out = file.append_to(Gio.FileCreateFlags.NONE, null);
    out.write_all(new TextEncoder().encode('{"v":1,"part"\n'), null);   // обрыв записи
    out.close(null);
    const {records, skipped} = readRecords(path);
    equal(records.length, 1); equal(records[0].started_ms, 1); equal(skipped, 1);
  });

  test('an unwritable path reports failure instead of throwing', () => {
    equal(appendRecords('/proc/gnomato/journal.jsonl', [rec()]), false);
  });
});
```

В тесте нужен `import Gio from 'gi://Gio';`.

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `gjs -m tests/run-tests.js`
Expected: FAIL — `../lib/journalfile.js` не найден.

- [ ] **Step 3: Реализовать `lib/journalfile.js`**

Append — `Gio.File.append_to(Gio.FileCreateFlags.NONE, null)` + `write_all` + `close` в `try/catch`, каталог создаётся `GLib.mkdir_with_parents`. Чтение — `load_contents` в `try/catch`, разбить по `\n`, каждую непустую строку прогнать через `JSON.parse` в `try/catch`.

- [ ] **Step 4: Прогнать тесты**

Run: `gjs -m tests/run-tests.js`
Expected: PASS, `39 passing`.

- [ ] **Step 5: Commit**

```bash
git add lib/journalfile.js tests && git commit -m "feat: append-only journal file storage"
```

---

### Task 7: Маппинг состояния в GSettings

**Files:**
- Create: `lib/state.js`, `tests/state.test.js`
- Modify: `tests/run-tests.js`

**Interfaces:**
- Produces: `toSettingsValues(values) -> {timerState, timerKind, timerSlot, timerEndWallMs, timerRemainingMs, timerStartedWallMs}`.
- Produces: `fromSettingsValues(raw) -> {state, kind, slot, endWallMs, remainingMs, startedWallMs}` — неизвестные строки приводятся к `IDLE`/`POMODORO`, отсутствующие числа к 0.

- [ ] **Step 1: Написать тесты**

```js
import {defineTests, deepEqual, equal} from './harness.js';
import {toSettingsValues, fromSettingsValues} from '../lib/state.js';

export const tests = defineTests(test => {
  test('state round-trips through settings values', () => {
    const values = {state: 'RUNNING', kind: 'SHORT_BREAK', slot: 2, endWallMs: 1700000000000,
      remainingMs: 299000, startedWallMs: 1699999000000};
    deepEqual(fromSettingsValues(toSettingsValues(values)), values);
  });

  test('unknown strings fall back to idle pomodoro', () => {
    const result = fromSettingsValues({timerState: 'SLEEPING', timerKind: 'SUNBATHING'});
    equal(result.state, 'IDLE'); equal(result.kind, 'POMODORO');
  });

  test('missing numeric values become zero', () => {
    const result = fromSettingsValues({});
    equal(result.endWallMs, 0); equal(result.startedWallMs, 0); equal(result.slot, 0);
  });
});
```

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `gjs -m tests/run-tests.js`
Expected: FAIL — `../lib/state.js` не найден.

- [ ] **Step 3: Реализовать `lib/state.js`** — чистые функции, никаких Gio.Settings внутри.

- [ ] **Step 4: Прогнать тесты**

Run: `gjs -m tests/run-tests.js`
Expected: PASS, `42 passing`.

- [ ] **Step 5: Commit**

```bash
git add lib/state.js tests && git commit -m "feat: timer state mapping for GSettings"
```

---

### Task 8: Панель, меню, тик, восстановление и хоткеи

**Files:**
- Modify: `ui/indicator.js` (полная версия), `extension.js` (полная версия)

**Interfaces:**
- Consumes: `Timer`, `State`, `Kind` (Task 4), `formatRemaining` (Task 2), `shouldAutoStart` (Task 3), `toSettingsValues`/`fromSettingsValues` (Task 7).
- Produces: `GnomatoIndicator._init({onToggle, onSkip, onReset, onPreferences})`, методы `setRemaining(ms|null)`, `setPaused(bool)`, `setTodayCount(n)`, `setToggleLabel(text)`.

- [ ] **Step 1: Дописать `ui/indicator.js`**

`St.BoxLayout({style_class: 'panel-status-menu-box'})` с `St.Icon({icon_name: 'alarm-symbolic'})`, `St.Label` (`y_align: Clutter.ActorAlign.CENTER`), `St.Icon({icon_name: 'media-playback-pause-symbolic'})`. `setRemaining(null)` прячет label и иконку паузы. Пункты меню: `_toggleItem`, `_skipItem`, `_resetItem`, `PopupSeparatorMenuItem`, `_todayItem` (`reactive = false`), `PopupSeparatorMenuItem`, `_prefsItem`; каждый активный пункт делает `connect('activate', …)` и зовёт колбэк из `_init`.

- [ ] **Step 2: Написать `extension.js`**

`enable()` по порядку: `this._settings = this.getSettings()`; `this._soundSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.sound'})`; собрать `Timer` с `now = {wallMs: () => Math.floor(GLib.get_real_time() / 1000)}`; `restore(fromSettingsValues(...))` с чтением ключей `timer-*`; создать индикатор и `Main.panel.addToStatusArea(this.uuid, this._indicator)`; зарегистрировать `Main.wm.addKeybinding('toggle-keybinding', this._settings, Meta.KeyBindingFlags.NONE, Shell.ActionMode.ALL, cb)` и то же для `skip-keybinding`; подписаться на `changed::pomodoro-seconds`/`short-break-seconds`/`long-break-seconds`/`set-size` (переносить в Timer через `setDurations`/`setSetSize`) и на `changed::auto-start-breaks`/`auto-start-work`; вызвать `_syncUI()` и `_syncTickSource()`; сделать первый `this._onTick()` (он же обрабатывает завершение, прошедшее в отсутствие Timer).
`disable()` снимает источники (`this._tickId`), снимает хоткеи (`Main.wm.removeKeybinding`), разрывает подписки, уничтожает индикатор, обнуляет поля и вызывает `this._settings.sync()`.
`_syncTickSource()` создаёт `GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, cb)` только когда состояние `RUNNING`, и удаляет источник при любом другом состоянии. `_onTick()` дергает `timer.tick()`, при событии пишет запись через `appendRecords`, обновляет UI, играет звук и зовёт `_maybeAutoStart(nextKind)`. Действия меню: toggle = `start`/`pause`/`resume` по состоянию, skip = `timer.skip()` + запись + авто-старт, reset = `timer.reset()` + запись при непустом результате, preferences = `this.openPreferences()`. Каждый переход состояния персистится в ключи `timer-*` и обновляет UI; на «Сегодня: N» пока ставим 0 (Task 11 подключит счёт).
`_maybeAutoStart(nextKind)` = `if (shouldAutoStart(nextKind, {autoStartBreaks: this._settings.get_boolean('auto-start-breaks'), autoStartWork: this._settings.get_boolean('auto-start-work')})) this._timer.start()`, и вызывается он одинаково после завершения Interval и после Skip — Skip расходует слот Set и потому тоже может привести к перерыву, который по политике по умолчанию стартует сам. После Reset авто-старта нет.
Строки меню (`Start`, `Pause`, `Resume`, `Skip`, `Reset`, `Today: N`, `Preferences`) — через `this.gettext`.

- [ ] **Step 3: Проверить руками в живой сессии**

Перезайти в сессию (правка `extension.js` требует повторного входа), затем:
`gnome-extensions enable gnomato@fstronin`, `gnome-extensions info gnomato@fstronin` → `State: ACTIVE`, лог без исключений.
Сценарии: Start → label считает секунды вниз; Pause → label замирает, рядом иконка паузы; Start снова → отсчёт продолжается с того же остатка; Skip → label исчезает, иконка остаётся, идёт перерыв (если `auto-start-breaks` включён); Reset → Idle, остаток равен полной длительности Pomodoro.
Перезагрузка расширения: `gnome-extensions disable gnomato@fstronin && gnome-extensions enable gnomato@fstronin` — идущий помодоро остаётся RUNNING с остатком, посчитанным от дедлайна.
Хоткей: `gsettings set org.gnome.shell.extensions.gnomato toggle-keybinding "['<Control><Alt>p']"` → нажатие переключает Start/Pause.

- [ ] **Step 4: Commit**

```bash
git add ui/indicator.js extension.js && git commit -m "feat: panel countdown, menu actions and state restore"
```

---

### Task 9: Уведомления, звук и сводка после отсутствия

**Files:**
- Modify: `extension.js`

**Interfaces:**
- Consumes: событие `tick()`/`skip()`/`reset()` и флаг `restored` (Task 4), `isBreak` (Task 3).

- [ ] **Step 1: Реализовать уведомления и звук**

При завершении Interval: `Main.notify(title, body)`, где для завершённого Pomodoro — `_('Pomodoro finished')` / `_('Time for a break.')`, для завершённого перерыва — `_('Break over')` / `_('Back to work.')`. Если `event.restored`, текст помечает отсутствие: `_('Pomodoro finished while you were away')` / `_('The journal has been updated.')` и для перерыва `_('Break ended while you were away')` / `_('Ready for the next pomodoro.')`.
Звук: играть, только если `this._settings.get_boolean('sound-enabled')` и `this._soundSettings.get_boolean('event-sounds')`; вызов `global.display.get_sound_player().play_from_theme('complete', 'gnomato', null)` внутри `try/catch`, ошибку логировать. Звук не играется при `skip` и `reset`.

- [ ] **Step 2: Проверить руками**

`gsettings set org.gnome.shell.extensions.gnomato pomodoro-seconds 60` и `short-break-seconds 60`, запустить Pomodoro → на 00:00 виден баннер «Pomodoro finished» и слышен звук.
`gsettings set org.gnome.desktop.sound event-sounds false` → баннер есть, звука нет. Вернуть `true`.
`gsettings set org.gnome.desktop.notifications show-banners false` → баннера нет, отсчёт и переход к перерыву происходят. Вернуть `true`.
Восстановление: запустить Pomodoro на 60 с, `gnome-extensions disable gnomato@fstronin`, подождать 70 с, `enable` → при включении появляется баннер «…while you were away», Timer в Idle, отсчёт не продолжается.

- [ ] **Step 3: Commit**

```bash
git add extension.js && git commit -m "feat: interval notifications and theme sound"
```

---

### Task 10: Окно настроек

**Files:**
- Create: `prefs.js`

**Interfaces:**
- Consumes: схему из Task 1.
- Produces: `export default class GnomatoPreferences extends ExtensionPreferences` с `fillPreferencesWindow(window)`.

- [ ] **Step 1: Написать `prefs.js`**

`Adw.PreferencesPage` и пять групп: «Durations» (`Adw.SpinRow` ×3, `Gtk.Adjustment(lower: 1, upper: 180, step_increment: 1)`, значение из секунд делённых на 60, запись на `notify::value` как `Math.round(value) * 60`), «Set» (`Adw.SpinRow`, 1–12, привязан к `set-size`), «Behaviour» (`Adw.SwitchRow` ×3, привязаны через `settings.bind` к `auto-start-breaks`, `auto-start-work`, `sound-enabled`), «Keys» (`Adw.EntryRow` ×2 с валидацией через `Gtk.accelerator_parse` и записью в `toggle-keybinding`/`skip-keybinding` как массив из одной строки; пустое значение пишет пустой массив), «Data» (`Adw.ActionRow` с `subtitle` = путь из `journalPath()`).

- [ ] **Step 2: Проверить руками**

Run: `gnome-extensions prefs gnomato@fstronin`
Expected: открывается окно Adw; Pomodoro показывает 25, Set — 4, переключатели в положении «перерывы авто, работа вручную, звук вкл»; путь к Journal показан.
Правка «на ходу»: запустить Pomodoro, поменять длительность на 50 минут → идущий отсчёт не меняется; после завершения и сброса в Idle остаток равен 50 минутам.
Клавиши: ввести `<Control><Alt>p` в поле Toggle → `gsettings get org.gnome.shell.extensions.gnomato toggle-keybinding` возвращает `['<Control><Alt>p']`; нажатие переключает таймер. Очистить поле → массив пустой, хоткей не работает.
Проверка, что prefs не тянет shell-модули: `gjs -m prefs.js` не должен падать с ошибкой импорта (модуль расширения не запускается, но импорты резолвятся).

- [ ] **Step 3: Commit**

```bash
git add prefs.js && git commit -m "feat: preferences window for durations, behaviour, keys and journal path"
```

---

### Task 11: Journal в работе и счётчик «Сегодня»

**Files:**
- Modify: `extension.js`

**Interfaces:**
- Consumes: `journalPath`, `appendRecords`, `readRecords` (Task 6), `makeRecords`, `todayCount`, `dayKey` (Task 5).

- [ ] **Step 1: Подключить записи и счётчик**

`_writeRecords(closed)` вызывает `makeRecords(closed)` и `appendRecords(journalPath(), records)`, результат логирует при `false`. Вызывается из всех трёх мест закрытия Interval: `tick()` (completed), меню Skip, меню Reset (когда `reset()` вернул не null). `_refreshTodayCount()` читает `readRecords(journalPath()).records`, считает `todayCount(records, dayKey(now))` и отдаёт в `indicator.setTodayCount(n)`; вызывается в `enable()` и после каждой записи.

- [ ] **Step 2: Проверить руками**

`gsettings set org.gnome.shell.extensions.gnomato pomodoro-seconds 60`, `short-break-seconds 60`, `set-size 2`, перезайти, затем: довести Pomodoro до конца → `cat ~/.local/state/gnomato/journal.jsonl` содержит строку со `"outcome":"completed"`, `"day"` текущего дня, `"planned_s":60`, `"actual_s":60`, и меню показывает «Сегодня: 1».
Reset через 10 секунд после старта → появляется строка с `"outcome":"aborted"` и `"actual_s":10`, а «Сегодня» не увеличивается.
Skip → строка со `"outcome":"skipped"`, «Сегодня» не увеличивается, `kind` следующего Interval соответствует размеру Set.
Файл только дописывается: после трёх операций в файле три строки в порядке событий.
Отсутствие каталога: `rm -rf ~/.local/state/gnomato`, довести Pomodoro → каталог создаётся заново, строка на месте, отсчёт при этом не прерывался.

- [ ] **Step 3: Commit**

```bash
git add extension.js && git commit -m "feat: persist interval records and today counter"
```

---

### Task 12: deb-пакет и README

**Files:**
- Create: `debian/control`, `debian/changelog`, `debian/copyright`, `debian/rules`, `build-deb.sh`, `README.md`

**Interfaces:**
- Consumes: собранное дерево расширения (Tasks 1–11).

- [ ] **Step 1: Написать упаковку**

`debian/control`: `Package: gnomato`, `Architecture: all`, `Depends: gnome-shell (>= 50)`, `Description` на английском. `debian/changelog`: одна запись `gnomato (0.1.0) unstable; urgency=medium` — единственный источник версии. `debian/copyright`: GPL-2.0. `debian/rules`: без debhelper, цель `install` копирует `metadata.json`, `extension.js`, `prefs.js`, `LICENSE`, каталоги `lib/`, `ui/`, `schemas/` в `$(DESTDIR)/usr/share/gnome-shell/extensions/gnomato@fstronin/`, компилирует схему в `schemas/gschemas.compiled` и в `postinst` вызывает `glib-compile-schemas /usr/share/gnome-shell/extensions/gnomato@fstronin/schemas`. `build-deb.sh`: версия берётся из `debian/changelog`, сборка через `dpkg-buildpackage -b -uc -us` в чистой временной копии дерева, артефакт кладётся в `dist/`.

- [ ] **Step 2: Написать `README.md`**

Разделы: что делает, зависимости, установка из deb (`sudo dpkg -i …`, `gnome-extensions enable gnomato@fstronin`, повторный вход в сессию на Wayland), dev-процедура (симлинк корня репы в `~/.local/share/gnome-shell/extensions/gnomato@fstronin`, `glib-compile-schemas schemas/`, `gnome-extensions disable/enable`, повторный вход после правки `extension.js`, `gjs -m tests/run-tests.js`), где лежит Journal, что один uuid не может стоять одновременно в `~/.local` и `/usr/share`.

- [ ] **Step 3: Собрать пакет**

Run: `./build-deb.sh`
Expected: `dist/gnomato_0.1.0_all.deb`; `dpkg-deb -c dist/gnomato_0.1.0_all.deb` показывает `/usr/share/gnome-shell/extensions/gnomato@fstronin/{metadata.json,extension.js,prefs.js,LICENSE,lib/…,ui/…,schemas/org.gnome.shell.extensions.gnomato.gschema.xml,schemas/gschemas.compiled}`.

- [ ] **Step 4: Поставить пакетом и проверить**

```bash
rm ~/.local/share/gnome-shell/extensions/gnomato@fstronin
sudo dpkg -i dist/gnomato_0.1.0_all.deb
```

Перезайти в сессию, затем `gnome-extensions enable gnomato@fstronin`, `gnome-extensions info gnomato@fstronin` → `State: ACTIVE`, отсчёт работает, `gnome-extensions prefs gnomato@fstronin` открывается, лог без исключений.

- [ ] **Step 5: Commit**

```bash
git add README.md debian build-deb.sh && git commit -m "build: deb packaging and install documentation"
```

---

## Review Focus

1. **Обратный скачок настенных часов (NTP после пробуждения) во время RUNNING** — отсчёт не должен «отмотать» время назад или завершиться раньше срока. Тест «a backward wall-clock jump is compensated…» в Task 4.
2. **Interval, истёкший, пока Timer не работал** (перезапуск шелла, экран блокировки, сон) — ровно одна запись `completed` с `restored: true`, без двойного счёта и без молчаливой потери. Тесты «a completed interval with a missed deadline is marked restored» (Task 4) и «a restored completion still counts once» (Task 5).
3. **Interval, пересекающий локальную полночь** — Pomodoro считается один раз в дне старта, секунды распределены по обоим дням, сумма точна. Тесты «an interval crossing local midnight splits into two parts» и «a midnight-spanning pomodoro counts once» в Task 5.
4. **Пауза дольше самого Interval, затем продолжение** — мгновенного завершения быть не должно, остаток сохраняется точно. Тест «a long pause does not complete the interval on resume» в Task 4.
5. **Journal недоступен для записи или последняя строка обрезана** — Timer продолжает идти, ошибка только логируется, чтение пропускает битую строку и сохраняет предыдущие записи. Тесты «a corrupt or truncated line is skipped…» и «an unwritable path reports failure instead of throwing» в Task 6 плюс сценарий с `rm -rf ~/.local/state/gnomato` в Task 11.
