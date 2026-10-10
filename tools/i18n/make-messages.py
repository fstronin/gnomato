#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-2.0
"""Build the extension's translations, or check that they are whole.

    tools/i18n/make-messages.py            compile po/*.po into locale/
    tools/i18n/make-messages.py --check    fail when the template or a po is stale
    tools/i18n/make-messages.py --update   refresh the template and merge it in

The extension binds its gettext domain — `metadata.json`'s `gettext-domain` — to
`locale/` inside its own directory, so the compiled catalogues have to land there
under the names glibc looks for: `locale/<language>/LC_MESSAGES/<domain>.mo`. The
language comes from the po file name, which is why the directory for Simplified
Chinese is `zh_CN`: `zh_Hans` would never be found by a `LANG=zh_CN.UTF-8`
session.

`--check` is the one to put in the release ritual: it catches the rot that
matters — a string that has appeared in the code and in nobody's translation, and
a translation whose string has been removed from the code.
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, os.pardir, os.pardir))
SOURCES = ['extension.js', 'prefs.js', 'ui/popup.js', 'ui/indicator.js']
POT = os.path.join(ROOT, 'po', 'gnomato.pot')
XGETTEXT_ARGS = ['--language=JavaScript', '--keyword=_', '--keyword=gettext',
                 '--from-code=UTF-8', '--add-location=file']


def domain():
    """The gettext domain the shell binds: the one metadata.json names."""
    with open(os.path.join(ROOT, 'metadata.json'), encoding='utf-8') as f:
        metadata = json.load(f)
    return metadata['gettext-domain']


def unquote(text):
    text = text.strip()
    if len(text) > 1 and text.startswith('"') and text.endswith('"'):
        text = text[1:-1]
    return (text.replace('\\n', '\n').replace('\\t', '\t')
            .replace('\\"', '"').replace('\\\\', '\\'))


def read_catalog(path):
    """@returns {msgid: {msgstr, flags}} for a po or pot file."""
    entries = {}
    msgid = msgstr = None
    flags = []
    lines = open(path, encoding='utf-8').read().split('\n')
    for line in lines + ['']:
        if line.startswith('#,'):
            flags = [flag.strip() for flag in line[2:].split(',')]
        elif line.startswith('#'):
            continue
        elif line.startswith('msgid '):
            msgid = unquote(line[len('msgid '):])
            msgstr = None
            flags = []
        elif line.startswith('msgstr '):
            msgstr = unquote(line[len('msgstr '):])
        elif line.startswith('"'):
            if msgstr is None:
                msgid += unquote(line)
            else:
                msgstr += unquote(line)
        elif line.strip() == '' and msgid is not None:
            entries[msgid] = {'msgstr': msgstr or '', 'flags': flags}
            msgid = msgstr = None
            flags = []
    return entries


def po_files():
    directory = os.path.join(ROOT, 'po')
    return sorted(os.path.join(directory, name) for name in os.listdir(directory)
                  if name.endswith('.po'))


def extract_pot(path):
    """Write the template of the strings the sources use now."""
    subprocess.run(['xgettext', *XGETTEXT_ARGS, '-o', path] +
                   [os.path.join(ROOT, source) for source in SOURCES], check=True)
    return read_catalog(path)


def without_header(entries):
    return {msgid: entry for msgid, entry in entries.items() if msgid != ''}


def build():
    for path in po_files():
        language = os.path.basename(path)[:-len('.po')]
        target = os.path.join(ROOT, 'locale', language, 'LC_MESSAGES', f'{domain()}.mo')
        os.makedirs(os.path.dirname(target), exist_ok=True)
        # -c checks the format strings too: a translation that drops a %d is not
        # a translation of that string.
        subprocess.run(['msgfmt', '-c', '-o', target, path], check=True)
        print(f'{"locale/" + language:<16} {os.path.getsize(target):>6} B  '
              f'({len(without_header(read_catalog(path)))} strings)')


def update():
    extract_pot(POT)
    print(f'rewrote {os.path.relpath(POT, ROOT)}')
    for path in po_files():
        subprocess.run(['msgmerge', '--update', '--no-fuzzy-matching',
                        '--quiet', path, POT], check=True)
        print(f'merged into {os.path.relpath(path, ROOT)}')


def check():
    problems = 0
    with tempfile.TemporaryDirectory() as tmp:
        fresh = without_header(extract_pot(os.path.join(tmp, 'gnomato.pot')))
        committed = without_header(read_catalog(POT))

        for msgid in sorted(set(fresh) - set(committed)):
            print(f'{os.path.relpath(POT, ROOT)}: missing a string the code uses: {msgid!r}')
            problems += 1
        for msgid in sorted(set(committed) - set(fresh)):
            print(f'{os.path.relpath(POT, ROOT)}: holds a string the code no longer uses: {msgid!r}')
            problems += 1

        for path in po_files():
            name = os.path.relpath(path, ROOT)
            entries = without_header(read_catalog(path))

            for msgid in sorted(set(fresh) - set(entries)):
                print(f'{name}: untranslated: {msgid!r}')
                problems += 1
            for msgid in sorted(set(entries) - set(fresh)):
                print(f'{name}: translates a string the code no longer uses: {msgid!r}')
                problems += 1
            for msgid, entry in sorted(entries.items()):
                if 'fuzzy' in entry['flags']:
                    print(f'{name}: fuzzy, so it is not used: {msgid!r}')
                    problems += 1
                elif entry['msgstr'] == '' and msgid in fresh:
                    print(f'{name}: empty translation: {msgid!r}')
                    problems += 1

    if problems:
        print(f'{problems} problem(s)')
        return 1

    print(f'{"po/gnomato.pot":<24} current')
    for path in po_files():
        print(f'{os.path.relpath(path, ROOT):<24} complete')
    return 0


def main(argv):
    flags = argv[1:]
    for tool in ('xgettext', 'msgfmt'):
        if not shutil.which(tool):
            print(f'{tool} is not installed: the messages need the gettext package')
            return 1

    if '--check' in flags:
        return check()
    if '--update' in flags:
        update()
        return 0
    build()
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
