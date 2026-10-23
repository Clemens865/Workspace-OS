#!/usr/bin/env bash
# Builds wos-lok-host — pure LibreOfficeKit C API (no UNO linkage). Model-level
# formatting (cell borders, …) is done via LOK's runMacro running a Basic macro
# seeded into the engine profile (see lokHost.ts), which executes in the engine's
# own context where ThisComponent is the loaded document — so it works against
# the bundled engine too.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
if [ "$(uname -s)" = Linux ]; then
  # Headers must match the engine's LOK ABI: fetch with the installed version, e.g.
  # LOK_HEADER_REF=libreoffice-24.2.7.2 bash fetch-headers.sh
  [ -f "$HERE/LibreOfficeKit/LibreOfficeKit.h" ] || { echo "run fetch-headers.sh first" >&2; exit 1; }
  g++ -std=c++17 -O2 -I "$HERE" "$HERE/wos-lok-host.cpp" -o "$HERE/wos-lok-host" -ldl -lpthread
  echo "built $HERE/wos-lok-host (uno deps: $(ldd "$HERE/wos-lok-host" | grep -ic uno_cppu || true))"
  exit 0
fi
clang++ -std=c++17 -O2 -I "$HERE" "$HERE/wos-lok-host.cpp" -o "$HERE/wos-lok-host"
echo "built $HERE/wos-lok-host (uno deps: $(otool -L "$HERE/wos-lok-host" | grep -ic uno_cppu))"
