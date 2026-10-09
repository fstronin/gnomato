#!/bin/bash
# Checks the cue the extension plays at each interval boundary: a headless
# gnome-shell runs the real code, tools/cue-probe/probe patches the sound player
# and drives the extension through a pomodoro, a break, a manual start, a pause,
# a resume and a skip, recording every event id that reaches the player.
#
#   ./run.sh                          the working tree
#   SRC=/path/to/copy ./run.sh        an installed copy — the unpacked upload,
#                                     for instance (see docs/PUBLISHING.md)
#
# Environment:
#   SRC      tree under test                (default the repository root)
#   ROOT     private state                  (default $TMPDIR/gnomato-cue-probe)
#   VM       virtual monitor mode            (default 1280x800)
#   TIMEOUT  seconds the throwaway shell may live (default 300)
#
# There is no audio server in the throwaway session, so this proves which ids are
# requested and never how they sound — the difference between the two sounds is
# for a human ear in a real session. The real session is never touched (private
# XDG_RUNTIME_DIR, private settings backend); everything the shell leaves behind
# stays in ROOT. Needs rsync and python3.
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=${REPO:-$(cd "$HERE/../.." && pwd)}
SRC=${SRC:-$REPO}
ROOT=${ROOT:-${TMPDIR:-/tmp}/gnomato-cue-probe}
VM=${VM:-1280x800}
TIMEOUT=${TIMEOUT:-300}

UUID=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["uuid"])' "$SRC/metadata.json")
REPORT="$ROOT/report.json"

rm -rf "$ROOT/data" "$ROOT/home" "$ROOT/config" "$ROOT/state" "$ROOT/cache" "$ROOT/run" \
       "$REPORT" "$ROOT/shell.log"
mkdir -p "$ROOT/home" "$ROOT/config" "$ROOT/state" "$ROOT/cache" "$ROOT/run"
chmod 700 "$ROOT/run"

# Only the extension itself goes into the throwaway shell's extension dir, next
# to the probe.
DEST="$ROOT/data/gnome-shell/extensions/$UUID"
PROBE="$ROOT/data/gnome-shell/extensions/cue-probe@test"
mkdir -p "$DEST" "$PROBE"
rsync -a \
  --exclude .git --exclude .gitignore --exclude .superpowers --exclude .scratch \
  --exclude docs --exclude tests --exclude tools --exclude debian --exclude dist --exclude '*.deb' \
  --exclude README.md --exclude build-deb.sh --exclude AGENTS.md --exclude CONTEXT.md \
  "$SRC"/ "$DEST"/
cp "$HERE"/probe/cue-probe@test/extension.js "$HERE"/probe/cue-probe@test/metadata.json "$PROBE"/

gset() { GSETTINGS_BACKEND=keyfile XDG_CONFIG_HOME="$ROOT/config" gsettings set "$@"; }
gset org.gnome.shell enabled-extensions "['cue-probe@test', '$UUID']"
gset org.gnome.desktop.sound event-sounds true

# The environment has to be set before dbus-run-session: dbus-daemon hands its
# own environment to everything it activates.
export HOME="$ROOT/home" XDG_DATA_HOME="$ROOT/data" XDG_CONFIG_HOME="$ROOT/config"
export XDG_STATE_HOME="$ROOT/state" XDG_CACHE_HOME="$ROOT/cache"
export GSETTINGS_BACKEND=keyfile
export LIBGL_ALWAYS_SOFTWARE=1
export GN_CUE_ROOT="$ROOT" GN_CUE_UUID="$UUID"
# A private runtime dir keeps this shell, and anything D-Bus activated for it,
# off the real session's sockets.
export XDG_RUNTIME_DIR="$ROOT/run"
export WAYLAND_DISPLAY=wayland-0

timeout "$TIMEOUT" dbus-run-session -- bash -s <<INNER
set -u

gnome-shell --wayland --headless --virtual-monitor $VM > $ROOT/shell.log 2>&1 &
SHELL_PID=\$!
up=no
for i in \$(seq 1 45); do
  if gdbus call --session --dest org.freedesktop.DBus --object-path /org/freedesktop/DBus \
      --method org.freedesktop.DBus.NameHasOwner org.gnome.Shell 2>/dev/null | grep -q true; then
    up=yes; echo "shell bus up after \${i}s"; break
  fi
  sleep 1
done
[ "\$up" = yes ] || { echo "SHELL NEVER CAME UP"; tail -30 $ROOT/shell.log; exit 1; }

for i in \$(seq 1 60); do
  kill -0 \$SHELL_PID 2>/dev/null || { echo "SHELL DIED after \${i}s"; break; }
  [ -f $REPORT ] && { echo "report after \${i}s"; break; }
  sleep 1
done
sleep 1
kill \$SHELL_PID 2>/dev/null
wait \$SHELL_PID 2>/dev/null
INNER

echo "=== report ==="
GN_CUE_ROOT="$ROOT" python3 - <<'PY'
import json, os, sys

path = os.path.join(os.environ['GN_CUE_ROOT'], 'report.json')
try:
    report = json.load(open(path))
except OSError as e:
    print('no report:', e)
    sys.exit(1)
print(report['error'] or report['verdict'])
for check in report['checks']:
    print('ok  ' if check['pass'] else 'FAIL', check['name'], check['detail'] or '')
print('cues:', [(c['step'], c.get('eventId') or c.get('file')) for c in report['cues']])
sys.exit(1 if report['error'] or any(not c['pass'] for c in report['checks']) else 0)
PY
status=$?

echo "=== shell log: interesting lines ==="
grep -iE 'gnomato|cue-probe|error|critical|segmentation' "$ROOT/shell.log" \
  | grep -viE 'dbus-daemon|libinput|portal|ibus|evolution|goa|keyring|GITypeInfo|experimental|xdg-desktop|Gvc' | head -20
exit $status
