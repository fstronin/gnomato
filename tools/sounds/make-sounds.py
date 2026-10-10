#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-2.0
"""Write Gnomato's two cue sounds into sounds/.

The cues are the extension's own files rather than sound-theme events: the same
sound then means the same thing on every machine, and the arrival of a
notification can never be mistaken for the beginning of an interval. The pair is
mirrored — the pomodoro rises, the break falls — so the two are told apart
without words.

    tools/sounds/make-sounds.py            rewrite sounds/*.wav
    tools/sounds/make-sounds.py --check    fail when the committed files differ

16-bit mono WAV at 44.1 kHz: libcanberra plays that as it is, so nothing has to
be encoded with a tool this machine does not have.
"""

import io
import math
import os
import struct
import sys
import wave

RATE = 44100
# Of full scale: loud enough to notice over music, not a jump scare.
PEAK = 0.85
ATTACK = 0.004

# A struck bar rather than a held note: the fundamental with two quiet odds,
# every note fading away instead of stopping.
MARIMBA = ((1, 1.0), (3, 0.22), (5, 0.07))

E5 = 659.25
B5 = 987.77
GAP = 0.26


def note(freq, seconds, gain, decay):
    """One struck note of `seconds`, decaying with `decay` rather than cut."""
    return [
        sum(amp * math.sin(2 * math.pi * freq * mult * i / RATE) for mult, amp in MARIMBA)
        * gain * min(1.0, (i / RATE) / ATTACK) * math.exp(-(i / RATE) / decay)
        for i in range(int(seconds * RATE))
    ]


def delayed(track, seconds):
    return [0.0] * int(seconds * RATE) + track


def mix(*tracks):
    return [
        sum(track[i] for track in tracks if i < len(track))
        for i in range(max(len(track) for track in tracks))
    ]


def pomodoro():
    """Two rising notes: the work interval begins."""
    return mix(note(E5, 0.42, 0.60, 0.16), delayed(note(B5, 0.75, 0.65, 0.24), GAP))


def break_cue():
    """Two falling notes: the break begins."""
    return mix(note(B5, 0.42, 0.60, 0.16), delayed(note(E5, 0.85, 0.65, 0.26), GAP))


def wav_bytes(samples):
    """The samples as a 16-bit mono WAV, normalised to `PEAK`."""
    loudest = max(abs(value) for value in samples)
    frames = b''.join(
        struct.pack('<h', max(-32768, min(32767, round(value * PEAK / loudest * 32767))))
        for value in samples)

    buffer = io.BytesIO()
    with wave.open(buffer, 'wb') as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(RATE)
        out.writeframes(frames)
    return buffer.getvalue()


CUES = {'pomodoro.wav': pomodoro, 'break.wav': break_cue}


def main(argv):
    check = '--check' in argv[1:]
    root = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                         os.pardir, os.pardir))
    directory = os.path.join(root, 'sounds')
    os.makedirs(directory, exist_ok=True)

    failed = False
    for name, motif in CUES.items():
        path = os.path.join(directory, name)
        rendered = wav_bytes(motif())

        if not check:
            with open(path, 'wb') as f:
                f.write(rendered)
            print(f'wrote {path} ({len(rendered)} bytes, '
                  f'{len(rendered) / (RATE * 2):.2f} s)')
            continue

        try:
            with open(path, 'rb') as f:
                committed = f.read()
        except OSError as e:
            print(f'FAIL {name}: {e}')
            failed = True
            continue

        if committed == rendered:
            print(f'ok   {name} ({len(rendered)} bytes)')
        else:
            print(f'FAIL {name}: not what the motif renders '
                  f'({len(committed)} bytes committed, {len(rendered)} rendered)')
            failed = True

    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
