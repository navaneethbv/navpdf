#!/bin/sh
set -eu

if [ "${NAVPDF_ACCESSIBILITY_GRANTED:-}" != "1" ]; then
  echo "Accessibility permission is required for the native memory drive." >&2
  echo "Grant it to the terminal in System Settings, then rerun with NAVPDF_ACCESSIBILITY_GRANTED=1." >&2
  exit 2
fi

echo "Native memory drive requires an interactive macOS session." >&2
echo "Open the release app, load the requested fixture, page through it, search, and record Activity Monitor footprints." >&2
exit 3
