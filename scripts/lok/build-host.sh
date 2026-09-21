#!/usr/bin/env bash
# Builds wos-lok-host — pure LibreOfficeKit C API (no UNO linkage). Model-level
# formatting (cell borders, …) is done via LOK's runMacro running a Basic macro
# seeded into the engine profile (see lokHost.ts), which executes in the engine's
# own context where ThisComponent is the loaded document — so it works against
# the bundled engine too.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
clang++ -std=c++17 -O2 -I "$HERE" "$HERE/wos-lok-host.cpp" -o "$HERE/wos-lok-host"
echo "built $HERE/wos-lok-host (uno deps: $(otool -L "$HERE/wos-lok-host" | grep -ic uno_cppu))"
