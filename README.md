# Gnomato

A Pomodoro timer for the GNOME Shell panel: one interval at a time — a pomodoro,
a short break or a long break — with the countdown visible at a glance and a
journal of what actually happened.

| | |
|---|---|
| Panel | Countdown while an interval runs, a pause mark while it is paused, the icon alone when idle |
| Menu | Start/Pause/Resume, Skip, Reset, today's finished pomodoros, Preferences |
| Intervals | Configurable pomodoro and break lengths, a set of N pomodoros ending in a long break |
| Behaviour | Breaks start themselves, pomodoros do not; a sound and a banner when an interval ends |
| Journal | Append-only JSONL of finished, skipped and interrupted intervals |
| Keys | Optional global shortcuts, unassigned by default |

An interval is a commitment on the wall clock: it ends at `start + length`
regardless of suspend, screen lock or whether you were at the keyboard. If the
deadline passes while the timer is not running, the interval is closed and
marked `restored` in the journal. See `docs/adr/0001-wall-clock-interval-semantics.md`.

## Requirements

- GNOME Shell 50 (developed and tested on 50.1)
- `gnome-shell >= 50` for the package

## Install

```sh
./build-deb.sh
sudo dpkg -i dist/gnomato_0.1.0_all.deb
gnome-extensions enable gnomato@fstronin
```

On Wayland a new extension is only picked up by a freshly started shell, so log
out and back in after installing. Check the result with:

```sh
gnome-extensions info gnomato@fstronin   # State: ACTIVE
```

Preferences (durations, set size, behaviour, shortcuts, journal path):

```sh
gnome-extensions prefs gnomato@fstronin
```

The package installs to
`/usr/share/gnome-shell/extensions/gnomato@fstronin/`, compiles the GSettings
schema into that directory at build time and needs no post-install step.

## Journal

Finished intervals are appended to `~/.local/state/gnomato/journal.jsonl`
(one JSON object per line; an interval crossing local midnight is written
twice, and only its first part counts as a pomodoro for that day). Nothing
rotates the file: it grows by roughly a hundred bytes per interval, and
deleting it only loses history. Point `XDG_STATE_HOME` elsewhere if you want it
somewhere else.

## Development

The extension directory *is* the repository root: `metadata.json`,
`extension.js`, `prefs.js`, `lib/`, `ui/`, `schemas/`.

```sh
glib-compile-schemas schemas/            # after editing the schema
gjs -m tests/run-tests.js                # unit tests for lib/, no shell needed
```

Install the working tree for the current user — only the extension itself
belongs in the shell's extension directory. `--delete-excluded` is what
actually removes anything already sitting there that is not part of the
extension: a plain `--delete` protects excluded paths from deletion.

```sh
rsync -a --delete --delete-excluded \
      --exclude .git --exclude .gitignore --exclude .superpowers \
      --exclude docs --exclude tests --exclude CONTEXT.md \
      --exclude debian --exclude dist --exclude '*.deb' \
      --exclude README.md --exclude build-deb.sh \
      ./ ~/.local/share/gnome-shell/extensions/gnomato@fstronin/
gnome-extensions enable gnomato@fstronin
```

What lands there is the extension payload and `LICENSE`: `metadata.json`,
`extension.js`, `prefs.js`, `lib/`, `ui/`, `schemas/`, `LICENSE`.

Then, in order of how much they change:

- `gnome-extensions disable gnomato@fstronin && gnome-extensions enable gnomato@fstronin`
  re-runs `enable()`/`disable()`, which is enough for anything except edits to
  the modules themselves.
- Editing `extension.js`, `lib/` or `ui/` needs a new shell process: on Wayland
  that means logging out and back in. The ESM module cache cannot be flushed and
  `gnome-extensions` has no reload command.

Two things to know about this machine specifically:

- `gnome-extensions pack` crashes with SIGSEGV here (even on a trivial
  extension), so the working tree is copied into place instead of packed.
- A uuid cannot live in both `~/.local/share/gnome-shell/extensions/` and
  `/usr/share/gnome-shell/extensions/`: remove the development copy before
  installing the package, or the shell reports a version mismatch.

## Design

- `CONTEXT.md` — the vocabulary (Pomodoro, Break, Interval, Set, Timer, Journal)
- `docs/spec.md` — the settled design, environment facts and what is out of scope
- `docs/adr/` — decisions that are expensive to reverse, with the reasoning
- `docs/superpowers/plans/` — the implementation plan this code was built from

## License

GPL-2.0 (see `LICENSE`).
