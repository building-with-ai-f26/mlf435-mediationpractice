#!/usr/bin/env bash
# Rebuild docs/demo/ from public/ so GitHub Pages serves the current app.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
rm -rf "$root/docs/demo"
mkdir -p "$root/docs/demo"
cp -R "$root/public/." "$root/docs/demo/"
echo "Synced public/ to docs/demo/"
