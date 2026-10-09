#!/bin/bash
# Regenerates the README screenshots (docs/images/*.png) out of a real, running
# extension: a headless gnome-shell whose only output is a virtual monitor runs
# the real code, tools/screenshots/probe poses it, and the crops come from the
# compositor itself.
#
#   ./run.sh                 the set the README uses; about ten minutes, because
#                            the headline shot waits for a real interval to be
#                            part way through
#   MODE=quick ./run.sh      the same poses without that wait, for checking the
#                            rig after an unrelated change
#
# Environment:
#   ROOT   private state for the throwaway shell (default $TMPDIR/gnomato-screenshots)
#   SHOTS  where the PNGs go                     (default <repo>/docs/images)
#   MODE   full | quick                          (default full)
#   BKG    flat | default  flat is a generated gradient; default is GNOME's own
#                          wallpaper                        (default flat)
#   VM     virtual monitor mode                  (default 1280x800)
#   WALL_TOP, WALL_BOTTOM  the gradient's ends   (default #3c3a45 / #1a181f)
#   TIMEOUT  seconds the throwaway shell may live (default 1500)
#
# Anything the headless shell leaves behind stays in ROOT; the real session is
# never touched (private XDG_RUNTIME_DIR, private settings backend, no D-Bus
# activation of the user's services). Needs rsync and python3.
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=${REPO:-$(cd "$HERE/../.." && pwd)}
ROOT=${ROOT:-${TMPDIR:-/tmp}/gnomato-screenshots}
SHOTS=${SHOTS:-$REPO/docs/images}
MODE=${MODE:-full}
BKG=${BKG:-flat}
VM=${VM:-1280x800}
WALL_TOP=${WALL_TOP:-#3c3a45}
WALL_BOTTOM=${WALL_BOTTOM:-#1a181f}
TIMEOUT=${TIMEOUT:-1500}

rm -rf "$ROOT/data" "$ROOT/home" "$ROOT/config" "$ROOT/state" "$ROOT/cache" "$ROOT/run" \
       "$ROOT/report.json" "$ROOT/shell.log"
mkdir -p "$ROOT/data" "$ROOT/home" "$ROOT/config" "$ROOT/state" "$ROOT/cache" "$ROOT/run" "$SHOTS"
chmod 700 "$ROOT/run"
printf '{"mode":"%s","background":"%s","shotsDir":"%s"}' "$MODE" "$BKG" "$SHOTS" > "$ROOT/config.json"

# Only the extension itself goes into the throwaway shell's extension dir.
DEST="$ROOT/data/gnome-shell/extensions/gnomato@fstronin"
mkdir -p "$DEST" "$ROOT/data/gnome-shell/extensions/gnomato-shot@test"
rsync -a \
  --exclude .git --exclude .gitignore --exclude .superpowers --exclude .scratch \
  --exclude docs --exclude tests --exclude tools --exclude debian --exclude dist --exclude '*.deb' \
  --exclude README.md --exclude build-deb.sh --exclude AGENTS.md --exclude CONTEXT.md \
  "$REPO"/ "$DEST"/
cp "$HERE"/probe/gnomato-shot@test/extension.js "$HERE"/probe/gnomato-shot@test/metadata.json \
   "$ROOT/data/gnome-shell/extensions/gnomato-shot@test/"

gset() { GSETTINGS_BACKEND=keyfile XDG_CONFIG_HOME="$ROOT/config" gsettings set "$@"; }
gset org.gnome.shell enabled-extensions "['gnomato-shot@test']"
gset org.gnome.desktop.interface color-scheme 'prefer-dark'
if [ "$BKG" = flat ]; then
  # An empty picture-uri is not a flat colour: the shell falls back to $HOME and
  # complains. A generated gradient is honest about being staged and keeps the
  # panel and the popup readable.
  WALL_TOP="$WALL_TOP" WALL_BOTTOM="$WALL_BOTTOM" python3 - "$ROOT/wall.png" <<'PY'
import os, struct, sys, zlib

def hexrgb(value):
    v = value.lstrip('#')
    return tuple(int(v[i:i + 2], 16) for i in (0, 2, 4))

top, bottom = hexrgb(os.environ['WALL_TOP']), hexrgb(os.environ['WALL_BOTTOM'])
h = 256
rows = b''
for y in range(h):
    t = y / (h - 1)
    rows += b'\x00' + bytes(round(top[c] + (bottom[c] - top[c]) * t) for c in range(3)) * 8

def chunk(tag, data):
    body = tag + data
    return struct.pack('>I', len(data)) + body + struct.pack('>I', zlib.crc32(body) & 0xffffffff)

png = (b'\x89PNG\r\n\x1a\n'
       + chunk(b'IHDR', struct.pack('>IIBBBBB', 8, h, 8, 2, 0, 0, 0))
       + chunk(b'IDAT', zlib.compress(rows, 9))
       + chunk(b'IEND', b''))
open(sys.argv[1], 'wb').write(png)
PY
  gset org.gnome.desktop.background picture-options 'stretched'
  gset org.gnome.desktop.background primary-color "$WALL_TOP"
  gset org.gnome.desktop.background picture-uri "file://$ROOT/wall.png"
  gset org.gnome.desktop.background picture-uri-dark "file://$ROOT/wall.png"
fi

# The environment has to be set *before* dbus-run-session: dbus-daemon hands
# its own environment to everything it activates, and the preferences window is
# a D-Bus activated gjs service of its own. With these inside the inner script
# the prefs window read the real dconf and the real HOME -- the screenshot then
# showed the developer's settings, not the ones this harness set up.
export HOME="$ROOT/home" XDG_DATA_HOME="$ROOT/data" XDG_CONFIG_HOME="$ROOT/config"
export XDG_STATE_HOME="$ROOT/state" XDG_CACHE_HOME="$ROOT/cache"
export GSETTINGS_BACKEND=keyfile
export LIBGL_ALWAYS_SOFTWARE=1
export GN_SHOT_ROOT="$ROOT"
# A private runtime dir keeps this shell, and anything D-Bus activated for it,
# off the real session's sockets.
export XDG_RUNTIME_DIR="$ROOT/run"
export WAYLAND_DISPLAY=wayland-0
export GDK_BACKEND=wayland

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

for i in \$(seq 1 $TIMEOUT); do
  kill -0 \$SHELL_PID 2>/dev/null || { echo "SHELL DIED after \${i}s"; break; }
  grep -q '"step": "done"' $ROOT/report.json 2>/dev/null && { echo "done after \${i}s"; break; }
  grep -q 'harnessError' $ROOT/report.json 2>/dev/null && { echo "harness error after \${i}s"; break; }
  sleep 1
done
sleep 1
kill \$SHELL_PID 2>/dev/null
wait \$SHELL_PID 2>/dev/null
INNER

echo "=== report ==="
GN_SHOT_ROOT="$ROOT" python3 - <<'PY'
import json, os
p = os.path.join(os.environ['GN_SHOT_ROOT'], 'report.json')
try:
    r = json.load(open(p))
except Exception as e:
    print('NO REPORT:', e); raise SystemExit
print('step:', r.get('step'))
print('primaryMonitor:', json.dumps(r.get('primaryMonitor')), 'stageScale:', r.get('stageScale'))
print('shots:')
for s in r.get('shots', []):
    print('  %-18s x=%-5s y=%-4s w=%-5s h=%-4s png=%s' %
          (s.get('name'), s.get('x'), s.get('y'), s.get('w'), s.get('h'), s.get('png')))
for k in ('error', 'prefsError'):
    if k in r:
        print(k + ':', r[k])
for k in ('windows', 'prefsApi', 'prefsWindows', 'steps', 'idle', 'afterCompletion', 'break',
          'longBreak', 'menu', 'freshSet', 'running', 'paused'):
    if k in r:
        print(k + ':', json.dumps(r[k]))
PY
echo "=== shell log: interesting lines ==="
grep -iE 'gnomato|error|critical|segmentation|stylesheet' "$ROOT/shell.log" \
  | grep -viE 'dbus-daemon|libinput|portal|ibus|evolution|goa|keyring|GITypeInfo|experimental|xdg-desktop|Gvc' | head -20
echo "=== shots ==="
ls -l "$SHOTS"
