# Gnomato — дизайн

Расширение GNOME Shell: ведёт один Interval за раз по технике Помодоро (работа/перерыв), показывает отсчёт в панели и записывает, сколько времени фокусировки и отдыха набрано.

Термины — в `CONTEXT.md` (Pomodoro, Break, Interval, Set, Timer, Pause, Skip, Journal, Today, Completed/Skipped/Aborted/Restored). Архитектурные решения — в `docs/adr/`.

## Проверенная среда

| Факт | Значение |
|---|---|
| Shell | GNOME Shell 50.1 (`gnome-shell`/`gnome-shell-common` 50.1-0ubuntu1.3), gjs 1.88.0, libmutter-18-0 50.1 |
| ОС/сессия | Ubuntu 26.04.1 LTS, Wayland, тема иконок `Yaru-dark` |
| Расширения | только ESM; `extension.js` обязан экспортировать default-класс, имя каталога обязано совпадать с `uuid`, каждый каталог расширения изолирован (`session-modes` по умолчанию `["user"]`) |
| Модули shell | `resource:///org/gnome/shell/ui/main.js`, `ui/panelMenu.js` (`Button`), `ui/popupMenu.js` (`PopupMenu`, `PopupMenuItem`, `PopupSeparatorMenuItem`), `ui/messageTray.js`, `ui/quickSettings.js`, `extensions/extension.js` (`Extension`, `gettext`) |
| `St` CSS | `inset box-shadow` рисуется только у узла, у которого есть рамка или фон с ненулевой альфой (`st_theme_node_paint`, условие `has_inset_box_shadow && (has_border \|\| background_color.alpha > 0)`), поэтому контур пустого слота — рамка, а не тень; `min-width`/`min-height` из CSS задают размер и обычному `St.Widget` |
| Иконки | `alarm-symbolic` и `media-playback-pause-symbolic` есть и в Adwaita, и в Yaru |
| Звук | `global.display.get_sound_player()` — это `Meta.SoundPlayer` из mutter, обёртка над libcanberra, и у него только `play_from_theme`/`play_from_file`; вызов fire-and-forget: значения не возвращает и ошибок не бросает, поэтому ловить в `try/catch` нечего, а промах по имени события играет молча ничего. `theme-name` и `event-sounds` mutter применяет сам (`CA_PROP_CANBERRA_ENABLE`/`XDG_THEME_NAME`). `GSound-1.0.typelib` отсутствует и не нужен; `Gst-1.0`/`GstPlay-1.0` тоже не нужны. Yaru не объявляет `Inherits`, до `freedesktop` libcanberra добирается сам: `alarm-clock-elapsed` (6.1 с) есть только в freedesktop, `complete` (0.9 с) — и там, и в Yaru |
| Настройки | `org.gnome.desktop.sound` (`event-sounds`, `theme-name`); `org.gnome.desktop.notifications` (`show-banners`, `show-in-lock-screen`) |
| Предпочтения | `gnome-extensions prefs <uuid>` работает через D-Bus-сервис `org.gnome.Shell.Extensions` (отдельный процесс gjs) даже без `gnome-extensions-app`; доступны `Adw-1`, `Gtk-4.0` |
| Схема расширения | компилируется `glib-compile-schemas` в `<extdir>/<uuid>/schemas/gschemas.compiled`, `this.getSettings()` берёт id из `settings-schema` |
| Dev-loop | подкоманды `reload` нет; модуль ESM кэшируется, поэтому правка `extension.js` требует повторного входа в сессию; `enable`/`disable` перезапускают только `enable()`/`disable()` и перечитывают `stylesheet.css`, поэтому правки вида не требуют новой сессии |
| Тестовый харнесс | `gjs -m file.js` работает: относительные ESM-импорты и `gi://GLib`/`gi://Gio` доступны вне shell; `import system from 'system'` даёт `system.exit(code)` |
| Пути состояния | `GLib.get_user_state_dir()` → `/home/fstronin/.local/state` |
| Отсутствует | `msgfmt`, `gnome-extensions-app`, `flatpak`-приложения |

## Решения

| Область | Решение |
|---|---|
| Форма продукта | Только расширение shell, без демона и без отдельного приложения. Состояние живёт вне процесса (GSettings + файл Journal), поэтому `restart` шелла и `reload` расширения его не теряют |
| Имя | `uuid` = `gnomato@fstronin.github.io`, `name` = `Gnomato`, `settings-schema` = `org.gnome.shell.extensions.gnomato`, `shell-version` = `["50"]` |
| Автомат | `state` ∈ IDLE/RUNNING/PAUSED × `kind` ∈ POMODORO/SHORT_BREAK/LONG_BREAK + позиция в Set; команды `start`, `toggle pause`, `skip`, `reset` |
| Семантика времени | Interval — обязательство по настенным часам: конец = старт + длительность, независимо от сна, блокировки экрана и отсутствия пользователя. Авто-пауз нет. Хранится метка конца, а не накопленные тики; обратный скачок часов компенсируется сдвигом метки |
| Завершение | Дескриптор проверяется на каждом тике и при восстановлении. Дедлайн в прошлом → Completed; если Timer в этот момент не работал (restart шелла, экран блокировки, сон) — запись помечается `restored: true`. Правило одно для всех разрывов, порога нет |
| Восстановление | Если дедлайн в будущем — состояние восстанавливается как было (RUNNING остаётся RUNNING, PAUSED — PAUSED с сохранённым остатком) |
| Set | Размер по умолчанию 4. Skip расходует слот Set (Set не растягивается), но в счёт завершённых Pomodoro не идёт. Размер Set фиксируется, когда открывается его первый Interval: правка `set-size` посреди Set — в том числе пока идёт первый Pomodoro — не меняет ни ряд томатов, ни конец этого Set, новое значение берёт следующий Set. Пока Set не начат (слот не израсходован и Interval не открыт), значение применяется сразу; перезапуск расширения эту память теряет, как и память о длинах идущего Interval. Авто-старт перерывов включён, авто-старт работы выключен |
| Journal | `~/.local/state/gnomato/journal.jsonl`, append-only, без ротации. Запись содержит `v, interval_id, day, part, started_ms, ended_ms, kind, planned_s, actual_s, outcome, restored, set_index, set_size`. Reset пишет `outcome: aborted` с фактически набранным временем; Reset из IDLE не пишет ничего. Сброс счёта пишет вторую форму строки — `{"v":1,"mark":"count-reset","at_ms":…}` (ADR-0005). Ошибка записи только логируется — Timer продолжает идти |
| Полночь | Interval, пересекающий локальную полночь, разбивается на две записи (`part: 1` и `part: 2`) с пропорционально распределёнными `actual_s`; `planned_s` пишется только в `part: 1`; в счёт «сегодня» идёт только `part: 1` |
| «Сегодня: N» | Количество Completed Pomodoro текущих локальных суток, закончившихся позже последней метки сброса счёта (ADR-0005); Interval, пересекающий полночь, идёт в день старта. Пересчитывается в `enable()`, после каждой записи в журнал и при открытии меню правого клика — ярлык не переживает полночь устаревшим |
| Персист | Живое состояние Timer — в ключах GSettings (`timer-*`), Journal — файл. В dconf пишем только на переходах, не на каждом тике |
| Панель | `PanelMenu.Button` с иконкой `alarm-symbolic`; пока Timer в RUNNING — label `MM:SS`, при PAUSED — label и иконка `media-playback-pause-symbolic`, в IDLE — только иконка. Секундный источник создаётся только в RUNNING; значение каждый раз вычисляется от метки конца |
| Попап | Левый клик открывает попап — подкласс `PopupMenu.PopupMenu`, поставленный индикатору через `setMenu()`. Внутри: кольцо обратного отсчёта (`St.DrawingArea` + Cairo, расходуется вместе с остатком), `MM:SS` в центре, слово Interval, ряд томатов Set (по одному на слот идущего Set: залитые израсходованные, подсвеченный текущий Pomodoro) или число `consumed/size` вместо ряда, если ряд не влезает в ширину попапа — ширину без ряда, за вычетом padding и border (ADR-0006), и три круглые кнопки — Start/Pause/Resume, Skip, Reset; Skip и Reset неактивны в IDLE, главная кнопка активна всегда. Цвета: Pomodoro — системный акцент, Break — нейтральный приглушённый, IDLE — акцент в приглушении; вид задан `stylesheet.css`, который лежит в каталоге расширения и применяется `disable`+`enable`. Клавиатурной навигации по контролам нет — клавиатурный путь остаётся хоткеями (ADR-0003) |
| Меню | Правый клик: «Сегодня: N» (некликабельная строка), «Сбросить счёт» (всегда активен, без подтверждения — пишет метку в журнал) и Preferences. Контролов Interval здесь нет, они в попапе (ADR-0003) |
| Хоткеи | Ключи `as` в схеме с пустыми дефолтами: по умолчанию глобальных акселераторов нет, пользователь назначает сам в prefs |
| Prefs | `Adw.PreferencesWindow`: Длительности (целые минуты 1–180, в схеме секунды), Set (1–12), Поведение (авто-старт перерывов, авто-старт работы, звук), Клавиши (два акселератора), Данные (путь к Journal). Длительности применяются со следующего Interval, размер Set — со следующего Set |
| Уведомления | Баннер на каждое завершение Interval — и на конец Pomodoro, и на конец Break. Системный DND уважается, ничего не форсируем |
| Звук | Cue — это звук того Interval, который начинается: POMODORO → `alarm-clock-elapsed`, перерыв → `complete`. Звук из темы, своих ассетов нет. Cue играет только завершение Interval: оно объявляет cue того, к чему перешло, сразу — даже если авто-старт выключен, — поэтому один и тот же звук значит «начинается работа» или «начинается перерыв». Старт, который пользователь делает сам (кнопка Start в попапе, хоткей `toggle-keybinding`), молчит всегда, как и Pause→Resume, Skip и Reset: пометки «уже объявлен» нет. Один переключатель `sound-enabled`, своих проверок системного `event-sounds` нет — его применяет mutter |
| Экран блокировки | `session-modes` не объявляем: на экране блокировки расширения нет, отсчёта там нет. При возврате `enable()` пересчитывает состояние и показывает сводный баннер, если Interval завершился в отсутствие Timer |
| i18n | Строки английские, через `gettext`; `gettext-domain` = `gnomato@fstronin.github.io`; каталог `po/` не заводим, пока нет перевода (`msgfmt` в системе нет, и `gnome-extensions pack` с `po/` упадёт) |
| Репозиторий | Файлы расширения в корне, GPL-2.0 + SPDX-заголовки, один `extension.js` для жизненного цикла и отдельные модули для логики и UI, сборки нет |
| Поставка | Dev-loop в `~/.local/share/gnome-shell/extensions/gnomato@fstronin.github.io`; релиз — deb-пакет в `/usr/share/gnome-shell/extensions/gnomato@fstronin.github.io` по образцу `hwlogo`. Оба каталога могут существовать одновременно: шелл пишет в лог «already installed in user dir … will not be loaded» и грузит user-копию, то есть dev-копия затеняет пакет |
| Публикация | extensions.gnome.org: zip из `gnome-extensions pack` с `--extra-source=lib --extra-source=ui`; в `metadata.json` нет `version` (его ставит сайт), номер версии виден через `version-name`. Id схемы не привязан к uuid, поэтому переименование uuid не теряет ни настройки, ни Journal. Процедура — `docs/PUBLISHING.md` |
| Проверка | Логика (автомат, Set, остаток от дедлайна, разбиение по полуночи, формирование записи, маппинг в GSettings, доля кольца, состояние слотов Set и влезает ли ряд томатов в ширину попапа) — скрипты-ассерты под `gjs` вне shell; UI, попап, жесты, уведомления, prefs — руками в живой сессии. Cue: какие id доходят до плеера и что ручной старт молчит, проверяет `tools/cue-probe/run.sh` в headless-шелле (слушать там нечего — сервера звука нет), различимость — слухом в живой сессии |

## Вне области

Авто-пауза по бездействию и блокировке экрана; метки задач, списки задач; статистика, графики, серии, экспорт; блокировка сайтов и приложений; переключение системного DND/Focus Mode; отсчёт на экране блокировки; каталоги переводов; ротация Journal.

## Уточнения, найденные при написании плана

1. **Разбиение по полуночи и счётчик.** Две записи на один Pomodoro не должны давать два Pomodoro в статистике, поэтому в счёт «сегодня» идёт только `part: 1`. Альтернатива (одна запись + разбиение при чтении) отвергнута: локальная полночь производна от часового пояса на момент чтения, а не на момент события.
2. **Reset из IDLE.** Ничего не пишется: прерывать нечего. `aborted` появляется только при Reset во время RUNNING/PAUSED.
3. **Хоткеи по умолчанию пустые.** `addKeybinding` с пустым массивом акселераторов валиден — клавиши просто не назначены, назначение живёт в prefs.
