#!/usr/bin/env bash
# Fetch the official LibreOfficeKit headers (we don't vendor the SDK).
# Used by the local build script and CI to compile lokprobe.cpp.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
DST="$HERE/LibreOfficeKit"
REF="${LOK_HEADER_REF:-master}"
BASE="https://raw.githubusercontent.com/LibreOffice/core/${REF}/include/LibreOfficeKit"
mkdir -p "$DST"
for h in LibreOfficeKit.h LibreOfficeKitInit.h LibreOfficeKitEnums.h LibreOfficeKitTypes.h; do
  curl -fsSL "$BASE/$h" -o "$DST/$h"
  echo "fetched $h"
done
