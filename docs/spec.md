# Gnomato — дизайн

Расширение GNOME Shell: ведёт один Interval за раз по технике Помодоро (работа/перерыв), показывает отсчёт в панели и записывает, сколько времени фокусировки и отдыха набрано.

Термины — в `CONTEXT.md` (Pomodoro, Break, Interval, Set, Timer, Pause, Skip, Journal, Today, Completed/Skipped/Aborted/Restored). Архитектурные решения — в `docs/adr/`.

## Проверенная среда

| Факт | Значение |
|---|---|
| Shell | GNOME Shell 50.1 (`gnome-shell`/`gnome-shell-common` 50.1-0ubuntu1.3), gjs 1.88.0, libmutter-18-0 50.1 |
| ОС/сессия | Ubuntu 26.04.1 LTS, Wayland, тема иконок `Yaru-dark` |
| Расширения | только ESM; `extension.js` обязан экспортировать default-класс, имя каталога обязано совпадать с `uuid`, каждый каталог расширения изолирован (`session-modes` по умолчанию `["user"]`) |
| Модули shell | `resource:///org/gnome/shell/ui/main.js`, `ui/panelMenu.js` (`Button`), `ui/popupMenu.js` (`PopupMenuItem`, `PopupSeparatorMenuItem`), `ui/messageTray.js`, `ui/quickSettings.js`, `extensions/extension.js` (`Extension`, `gettext`) |
| Иконки | `alarm-symbolic` и `media-playback-pause-symbolic` есть и в Adwaita, и в Yaru |
| Звук | `global.display.get_sound_player()` с `play_from_theme` — тот же путь, что использует сам shell; `GSound-1.0.typelib` **отсутствует**; `Gst-1.0`/`GstPlay-1.0` есть, но не нужны; `/usr/share/sounds/freedesktop/stereo/complete.oga` существует |
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
| Имя | `uuid` = `gnomato@fstronin`, `name` = `Gnomato`, `settings-schema` = `org.gnome.shell.extensions.gnomato`, `shell-version` = `["50"]` |
| Автомат | `state` ∈ IDLE/RUNNING/PAUSED × `kind` ∈ POMODORO/SHORT_BREAK/LONG_BREAK + позиция в Set; команды `start`, `toggle pause`, `skip`, `reset` |
| Семантика времени | Interval — обязательство по настенным часам: конец = старт + длительность, независимо от сна, блокировки экрана и отсутствия пользователя. Авто-пауз нет. Хранится метка конца, а не накопленные тики; обратный скачок часов компенсируется сдвигом метки |
| Завершение | Дескриптор проверяется на каждом тике и при восстановлении. Дедлайн в прошлом → Completed; если Timer в этот момент не работал (restart шелла, экран блокировки, сон) — запись помечается `restored: true`. Правило одно для всех разрывов, порога нет |
| Восстановление | Если дедлайн в будущем — состояние восстанавливается как было (RUNNING остаётся RUNNING, PAUSED — PAUSED с сохранённым остатком) |
| Set | Размер по умолчанию 4. Skip расходует слот Set (Set не растягивается), но в счёт завершённых Pomodoro не идёт. Размер Set фиксируется, когда Set начинает расходовать слоты: правка `set-size` посреди Set не меняет ни ряд томатов, ни конец этого Set — новое значение берёт следующий Set; перезапуск расширения эту память теряет, как и память о длинах идущего Interval. Авто-старт перерывов включён, авто-старт работы выключен |
| Journal | `~/.local/state/gnomato/journal.jsonl`, append-only, без ротации. Запись содержит `v, interval_id, day, part, started_ms, ended_ms, kind, planned_s, actual_s, outcome, restored, set_index, set_size`. Reset пишет `outcome: aborted` с фактически набранным временем; Reset из IDLE не пишет ничего. Ошибка записи только логируется — Timer продолжает идти |
| Полночь | Interval, пересекающий локальную полночь, разбивается на две записи (`part: 1` и `part: 2`) с пропорционально распределёнными `actual_s`; `planned_s` пишется только в `part: 1`; в счёт «сегодня» идёт только `part: 1` |
| «Сегодня: N» | Количество Completed Pomodoro за текущие локальные сутки |
| Персист | Живое состояние Timer — в ключах GSettings (`timer-*`), Journal — файл. В dconf пишем только на переходах, не на каждом тике |
| Панель | `PanelMenu.Button` с иконкой `alarm-symbolic`; пока Timer в RUNNING — label `MM:SS`, при PAUSED — label и иконка `media-playback-pause-symbolic`, в IDLE — только иконка. Секундный источник создаётся только в RUNNING; значение каждый раз вычисляется от метки конца |
| Попап | Левый клик открывает попап — подкласс `PopupMenu.PopupMenu`, поставленный индикатору через `setMenu()`. Внутри: кольцо обратного отсчёта (`St.DrawingArea` + Cairo, расходуется вместе с остатком), `MM:SS` в центре, слово Interval, ряд томатов Set (по одному на слот идущего Set: залитые израсходованные, подсвеченный текущий Pomodoro; при размере больше шести — `N/M`) и три круглые кнопки — Start/Pause/Resume, Skip, Reset; Skip и Reset неактивны в IDLE, главная кнопка активна всегда. Цвета: Pomodoro — системный акцент, Break — нейтральный приглушённый, IDLE — акцент в приглушении; вид задан `stylesheet.css`, который лежит в каталоге расширения и применяется `disable`+`enable`. Клавиатурной навигации по контролам нет — клавиатурный путь остаётся хоткеями (ADR-0003) |
| Меню | Правый клик: «Сегодня: N» (некликабельная строка) и Preferences — без контролов |
| Хоткеи | Ключи `as` в схеме с пустыми дефолтами: по умолчанию глобальных акселераторов нет, пользователь назначает сам в prefs |
| Prefs | `Adw.PreferencesWindow`: Длительности (целые минуты 1–180, в схеме секунды), Set (1–12), Поведение (авто-старт перерывов, авто-старт работы, звук), Клавиши (два акселератора), Данные (путь к Journal). Длительности применяются со следующего Interval, размер Set — со следующего Set |
| Уведомления | Баннер на каждое завершение Interval — и на конец Pomodoro, и на конец Break. Системный DND уважается, ничего не форсируем |
| Звук | `global.display.get_sound_player().play_from_theme('complete', …)`, звук из темы, своих ассетов нет. Один переключатель `sound-enabled`; играем, только если включены и он, и системный `event-sounds` |
| Экран блокировки | `session-modes` не объявляем: на экране блокировки расширения нет, отсчёта там нет. При возврате `enable()` пересчитывает состояние и показывает сводный баннер, если Interval завершился в отсутствие Timer |
| i18n | Строки английские, через `gettext`; `gettext-domain` = `gnomato@fstronin`; каталог `po/` не заводим, пока нет перевода (`msgfmt` в системе нет, и `gnome-extensions pack` с `po/` упадёт) |
| Репозиторий | Файлы расширения в корне, GPL-2.0 + SPDX-заголовки, один `extension.js` для жизненного цикла и отдельные модули для логики и UI, сборки нет |
| Поставка | Dev-loop в `~/.local/share/gnome-shell/extensions/gnomato@fstronin`; релиз — deb-пакет в `/usr/share/gnome-shell/extensions/gnomato@fstronin` по образцу `hwlogo`. Один uuid не может стоять одновременно в обоих местах |
| Проверка | Логика (автомат, Set, остаток от дедлайна, разбиение по полуночи, формирование записи, маппинг в GSettings, доля кольца и состояние слотов Set) — скрипты-ассерты под `gjs` вне shell; UI, попап, жесты, уведомления, звук, prefs — руками в живой сессии |

## Вне области

Авто-пауза по бездействию и блокировке экрана; метки задач, списки задач; статистика, графики, серии, экспорт; блокировка сайтов и приложений; переключение системного DND/Focus Mode; отсчёт на экране блокировки; публикация на extensions.gnome.org; каталоги переводов; ротация Journal.

## Уточнения, найденные при написании плана

1. **Разбиение по полуночи и счётчик.** Две записи на один Pomodoro не должны давать два Pomodoro в статистике, поэтому в счёт «сегодня» идёт только `part: 1`. Альтернатива (одна запись + разбиение при чтении) отвергнута: локальная полночь производна от часового пояса на момент чтения, а не на момент события.
2. **Reset из IDLE.** Ничего не пишется: прерывать нечего. `aborted` появляется только при Reset во время RUNNING/PAUSED.
3. **Хоткеи по умолчанию пустые.** `addKeybinding` с пустым массивом акселераторов валиден — клавиши просто не назначены, назначение живёт в prefs.
