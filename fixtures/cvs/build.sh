#!/usr/bin/env bash
# Regenerates every sample CV PDF from its HTML source with headless Chrome.
# Works from any directory: paths are resolved relative to this script.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHROME="${CHROME:-$(command -v google-chrome || command -v google-chrome-stable || command -v chromium || true)}"

if [ -z "$CHROME" ]; then
  echo "build.sh: google-chrome not found (set CHROME=/path/to/chrome)" >&2
  exit 1
fi

# A throwaway profile keeps this independent of any Chrome window already open.
PROFILE="$(mktemp -d)"
LOG="$(mktemp)"
trap 'rm -rf "$PROFILE" "$LOG"' EXIT

shopt -s nullglob
for html in "$DIR"/*.html; do
  pdf="${html%.html}.pdf"
  if ! "$CHROME" --headless=new --disable-gpu --no-pdf-header-footer \
      --user-data-dir="$PROFILE" \
      --print-to-pdf="$pdf" "file://$html" >"$LOG" 2>&1; then
    cat "$LOG" >&2
    echo "build.sh: failed to build $(basename "$pdf")" >&2
    exit 1
  fi
  echo "built $(basename "$pdf")"
done
