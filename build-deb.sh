#!/bin/sh
# Build the Debian package out of a clean copy of the tree: the repository also
# carries tests, docs and this script, none of which belong in the package.
# The package version comes from debian/changelog alone.
set -eu

here="$(cd "$(dirname "$0")" && pwd)"
cd "$here"

name="$(dpkg-parsechangelog --show-field Source)"
version="$(dpkg-parsechangelog --show-field Version)"
echo "building ${name} ${version}"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

rsync -a \
    --exclude .git \
    --exclude .superpowers \
    --exclude docs \
    --exclude tests \
    --exclude dist \
    --exclude '*.deb' \
    ./ "$work/${name}-${version}/"

cd "$work/${name}-${version}"
dpkg-buildpackage -b -uc -us --no-sign

cd "$here"
mkdir -p dist
cp "$work"/*.deb dist/
ls -l dist
