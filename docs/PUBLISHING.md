# Publishing to extensions.gnome.org

[extensions.gnome.org](https://extensions.gnome.org) (EGO) is the channel this
extension ships through: the GNOME Shell extension site, with a human review
and automatic upgrades for users. GitHub Releases, the AUR and the Debian
archive were considered on 2026-10-09 and declined; the deb built by
`build-deb.sh` (see [docs/adr/0002](adr/0002-deb-package-distribution.md))
stays a local convenience for machines we control.

## Identity

- `uuid` is `gnomato@fstronin.github.io`. EGO requires the part after `@` to be
  a namespace the author controls; a bare account name may be questioned in
  review, `username.github.io` is the documented shape. Changing the uuid later
  means a new extension entry on the site, so treat it as fixed.
- The GSettings schema id is `org.gnome.shell.extensions.gnomato` and has
  nothing to do with the uuid: a rename does **not** lose settings or the
  journal, only the extension directory name and the `enabled-extensions` entry.
- `metadata.json` carries no `version` — that field belongs to the site, which
  assigns and overrides it. The version users see comes from `version-name`: a
  string of 1–16 characters, letters, digits, space and period only.
- `shell-version` lists stable releases only (`["50"]`). Add the next stable
  version once the extension has been run on it; never list a future one.

## Build the bundle

```sh
gnome-extensions pack --force --out-dir dist \
    --extra-source=lib --extra-source=ui --extra-source=sounds \
    --extra-source=LICENSE .
```

`gnome-extensions pack` picks up only `metadata.json`, `extension.js`,
`prefs.js`, `stylesheet.css`, `schemas/` and `locale/`. Everything the extension
imports or plays has to be named: without `--extra-source=lib --extra-source=ui`
the zip is missing both directories and the extension fails at import time, and
without `--extra-source=sounds` it ships silent cues. This is the one build step
that silently produces a broken upload.

The result is `dist/<uuid>.shell-extension.zip`. `dist/` and `*.zip` are
gitignored — the bundle is an artifact, not a source file.

What belongs inside:

- `schemas/<schema-id>.gschema.xml` — required by review, and
  `gnome-extensions install` compiles it into `gschemas.compiled` itself.
  Do not ship the compiled file.
- `sounds/*.wav` — the two cue sounds the extension plays; without them the
  cues are silent, and nothing reports it.
- `LICENSE`.

What stays out: `docs/images/` (the icon and screenshots are uploaded on the
site), tests, tools, `debian/`, and every file that is not needed to run the
extension — the guidelines reject bundles full of extras.

## Verify the bundle before uploading

Install the zip the way a user would, into a throwaway home, and load it in a
headless shell:

```sh
rm -rf /tmp/eg-check && mkdir -p /tmp/eg-check
env HOME=/tmp/eg-check XDG_DATA_HOME=/tmp/eg-check/.local/share \
    XDG_CONFIG_HOME=/tmp/eg-check/.config GSETTINGS_BACKEND=keyfile \
    gnome-extensions install --force dist/<uuid>.shell-extension.zip
# the working tree, then the same tree installed from the zip
gjs -m tests/run-tests.js
tools/cue-probe/run.sh
SRC=/tmp/eg-check/.local/share/gnome-shell/extensions/<uuid> tools/cue-probe/run.sh
```

`tools/cue-probe/run.sh` drives the extension through interval boundaries in a
headless shell and checks which cue ids reach the sound player; it exits
non-zero when a check fails. An installation that shows `State: ACTIVE` there
will be fine for the reviewer.

## Submit

1. Sign in at <https://extensions.gnome.org>, "Upload Extension", pick the zip.
   The same form is used for every later version: the site recognises the uuid
   and adds it as the next version.
2. Upload screenshots (from `docs/images/`) and an icon on the extension page.
   Nothing appears in the listing before the review is done.
3. The review checks for malicious code, not for bugs. Expect questions about
   `enable()`/`disable()` symmetry and about anything unusual; the queue is
   measured in days.

Before uploading, re-read
[the review guidelines](https://gjs.guide/extensions/review-guidelines/review-guidelines.html).
The rules this code already follows, so a change does not quietly break review:

- nothing is created at module scope except plain data (`CUE_FILES`,
  `INTERVAL_KEYS`, `Kind`), and everything created in `enable()` is destroyed in
  `disable()` — sources, signal handlers, keybindings, the indicator;
- `extension.js` imports no Gtk/Adw, `prefs.js` imports no Clutter/Meta/St/Shell;
- no deprecated `imports.*` modules, no telemetry, no excessive logging;
- `session-modes` is absent (the extension does not run on the lock screen);
- the schema id and path use the `org.gnome.shell.extensions` bases and the XML
  ships in the zip;
- GPL-2.0, which is compatible with the Shell's GPL-2.0-or-later.

## Release ritual

One commit per release, four files in step:

1. `debian/changelog` — new version entry (`dpkg-parsechangelog` is the single
   source of the package version).
2. `metadata.json` — `version-name` matches that version.
3. `docs/images/` — regenerate with `tools/screenshots/run.sh` if the UI changed.
4. `tools/cue-probe/run.sh`, `gjs -m tests/run-tests.js` and
   `python3 tools/sounds/make-sounds.py --check` green, then pack, verify the
   bundle, upload, tag.
