#!/usr/bin/env bash
# Build a HEADLESS LibreOffice on macOS (svp VCL plugin, no Aqua) and validate
# it against lokprobe. This is the prerequisite for Phase 3a native editing:
# the stock TDF mac build has no headless plugin, so LOKit crashes off the main
# thread. A --disable-gui build ships the svp plugin and is expected to pass.
#
# Heavy: clones ~2GB, builds for 1-4h, needs ~30GB+ free disk. Intended to run
# on a roomy host or CI runner — see .github/workflows/lok-headless-macos.yml.
#
# Env:
#   LOK_REF   git branch/tag of LibreOffice/core (default: master)
#   JOBS      parallel make jobs (default: number of CPUs)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REF="${LOK_REF:-master}"
JOBS="${JOBS:-$(sysctl -n hw.ncpu)}"
# The build tree is huge (~30-40GB). CORE_DIR lets it live on a roomy volume
# (e.g. an APFS disk image on an external SSD) instead of the internal drive.
CORE="${CORE_DIR:-$HERE/core}"

echo "==> build deps (brew). gperf>=3.1 and GNU make>=4.2 are required; mac ships older."
brew install autoconf automake nasm ant ccache gperf make gnu-tar || true
GMAKE="$(brew --prefix)/bin/gmake"

echo "==> fetch LOKit headers (ref=$REF)"
LOK_HEADER_REF="$REF" "$HERE/fetch-headers.sh"

if [ ! -d "$CORE/.git" ]; then
  echo "==> clone LibreOffice/core ($REF)"
  git clone --depth 1 --branch "$REF" https://github.com/LibreOffice/core "$CORE"
fi
cd "$CORE"

echo "==> apply the headless-macOS port patch (6 files, ~9 lines)"
# Idempotent: skip if already applied.
git apply --check "$HERE/headless-macos.patch" 2>/dev/null && git apply "$HERE/headless-macos.patch" || echo "   (patch already applied or N/A)"

echo "==> apply the csv filter-options headless patch (1 file — kills the CSV-load deadlock)"
git apply --check "$HERE/csv-filteroptions-headless.patch" 2>/dev/null && git apply "$HERE/csv-filteroptions-headless.patch" || echo "   (patch already applied or N/A)"

echo "==> autogen (headless, lean). --enable-bogus-pkg-config tolerates brew pkgconf."
cat > autogen.input <<'EOF'
--enable-release-build
--disable-gui
--enable-headless
--enable-bogus-pkg-config
--without-java
--disable-odk
--without-help
--without-myspell-dicts
--disable-online-update
--disable-firebird-sdbc
--disable-symbols
--enable-python=internal
EOF
GNUMAKE="$GMAKE" ./autogen.sh

echo "==> make -j$JOBS (this is the long part)"
GNUMAKE="$GMAKE" "$GMAKE" -j"$JOBS"

echo "==> locate built engine (no mergelibs → hook is in libsofficeapp.dylib)"
HOOKLIB="$(find "$CORE/instdir" -name libsofficeapp.dylib -o -name libmergedlo.dylib | head -1)"
FUND="$(find "$CORE/instdir" -name fundamentalrc | head -1)"
echo "    hook lib: $HOOKLIB"
echo "    fundamentalrc: $FUND"
[ -n "$HOOKLIB" ] || { echo "ERROR: no LOKit hook lib built — headless build failed"; exit 1; }

INSTALL_DIR="$(dirname "$HOOKLIB")/"

echo "==> compile + run lokprobe against the headless build"
clang++ -std=c++17 -I"$HERE" -DLOK_USE_UNSTABLE_API "$HERE/lokprobe.cpp" -o "$HERE/lokprobe"
# A doc to render: prefer the repo test fixture, else any docx in core.
DOC="${PROBE_DOC:-/tmp/wos-test/test-document.docx}"
[ -f "$DOC" ] || DOC="$(find "$CORE" -name '*.docx' | head -1)"
SAL_USE_VCLPLUGIN=svp "$HERE/lokprobe" "$INSTALL_DIR" "$DOC" "$HERE/headless-out.ppm" "$FUND"
echo "==> lokprobe exit: $? (0 = GO: headless LOKit renders on macOS)"
