#!/usr/bin/env bash
#
# build-web.sh — build the patched Drascula engine to WebAssembly with
# ScummVM's own Emscripten port, reproducibly, on macOS.
#
# This is the web counterpart of scripts/build-engine.sh. It reuses the exact
# same engine/ -> ScummVM source flow (copy a11y.cpp/a11y.h, register a11y.o,
# apply hooks.patch) so the wasm is built from engine/ alone — never by hand
# editing ScummVM. It works around the two Linux assumptions in ScummVM's stock
# dists/emscripten/build.sh that bite on macOS (proved by spike 03):
#
#   * build.sh fetches emsdk with `wget`; macOS ships no wget, so we fetch the
#     pinned emsdk tarball with `curl` into the location build.sh expects, then
#     build.sh finds it already unpacked and never calls wget.
#   * build.sh's `make` task sizes jobs with `nproc`; macOS ships no nproc and
#     it would silently fall back to -j1, so we run `emmake make -jN` ourselves
#     with N from `sysctl -n hw.ncpu`, and never invoke build.sh's make task.
#
# A SEPARATE TREE. The native build lives in vendor/scummvm (owned by the engine
# chat). An Emscripten `configure` writes a different config over that tree and
# would overwrite the native build. So all configure/build work happens in a
# second tree, vendor/scummvm-web, made from the same pinned commit — exactly as
# the spike did (`git -C scummvm archive HEAD | tar -x -C scummvm-web`). This
# script NEVER configures or builds in vendor/scummvm.
#
# GAME DATA IS NEVER COMMITTED. The Emscripten /data tree is populated by
# reference from the gitignored vendor/game/drascula that scripts/fetch.sh
# produced. Nothing this script writes is tracked (everything lands under
# vendor/, which is gitignored).
#
# Usage:
#   scripts/fetch.sh            # once, to produce vendor/scummvm + vendor/game
#   scripts/build-web.sh        # build the wasm into vendor/scummvm-web
#   scripts/build-web.sh --jobs N   # parallel make jobs (default: hw.ncpu)
#   scripts/build-web.sh --clean    # reset engine source changes in the web tree first
#
# Output lands in vendor/scummvm-web/build-emscripten/:
#   scummvm.wasm, scummvm.js, translations.dat, themes, and a data/ tree with
#   Packet.001, drascula.dat, the Ogg tracks and per-folder index.json files.
# `make dist-emscripten` copies drascula.dat into /data, so no --extrapath is
# needed at launch. See .kiro/specs/web-build/design.md.
#
set -euo pipefail

# --- paths -------------------------------------------------------------------

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENGINE_SRC="$ROOT/engine"
VENDOR="$ROOT/vendor"
SCUMMVM_DIR="$VENDOR/scummvm"           # native tree (source only; never built here)
WEB_DIR="$VENDOR/scummvm-web"           # the Emscripten tree; all build work here
GAME_SRC="$VENDOR/game/drascula"        # game data fetched by fetch.sh (gitignored)
HOOKS_PATCH="$ENGINE_SRC/hooks.patch"

EMSDK_VERSION="4.0.10"
EMSDK_DIR="$WEB_DIR/dists/emscripten/emsdk-$EMSDK_VERSION"
EMSDK_TARBALL="emsdk-$EMSDK_VERSION.tar.gz"
EMSDK_URL="https://github.com/emscripten-core/emsdk/archive/refs/tags/$EMSDK_VERSION.tar.gz"

# --- options -----------------------------------------------------------------

CLEAN=0
JOBS=""

while [ $# -gt 0 ]; do
  case "$1" in
    --clean)  CLEAN=1 ;;
    --jobs)   shift; JOBS="${1:?--jobs needs a number}" ;;
    --jobs=*) JOBS="${1#--jobs=}" ;;
    -h|--help)
      sed -n '2,46p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) echo "[build-web] ERROR: unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

# Size the make job count on macOS with sysctl (nproc is Linux-only and would
# make build.sh's make task fall back to -j1), with a safe fallback.
if [ -z "$JOBS" ]; then
  if command -v sysctl >/dev/null 2>&1; then
    JOBS="$(sysctl -n hw.ncpu 2>/dev/null || echo 4)"
  elif command -v nproc >/dev/null 2>&1; then
    JOBS="$(nproc 2>/dev/null || echo 4)"
  else
    JOBS=4
  fi
fi

# --- helpers -----------------------------------------------------------------

log() { printf '[build-web] %s\n' "$*"; }
die() { printf '[build-web] ERROR: %s\n' "$*" >&2; exit 1; }

# --- preflight ---------------------------------------------------------------
#
# Fail loud, with the missing tool named, rather than deep in a make error.

[ -d "$SCUMMVM_DIR" ] || die "vendor/scummvm missing. Run scripts/fetch.sh first (it is the source for the web tree)."
git -C "$SCUMMVM_DIR" rev-parse --verify -q HEAD >/dev/null 2>&1 \
  || die "vendor/scummvm is not a git checkout. Re-run scripts/fetch.sh."
[ -f "$ENGINE_SRC/a11y.cpp" ] || die "engine/a11y.cpp missing."
[ -f "$ENGINE_SRC/a11y.h" ]   || die "engine/a11y.h missing."
command -v curl    >/dev/null 2>&1 || die "curl not found. It is needed to fetch the Emscripten SDK."
command -v python3 >/dev/null 2>&1 || die "python3 not found. It is needed to generate the /data HTTP index (build-make_http_index.py)."
command -v git     >/dev/null 2>&1 || die "git not found. It is needed to materialize vendor/scummvm-web."

# --- 0. materialize vendor/scummvm-web from the same pinned commit -----------
#
# Snapshot the native tree's HEAD into a fresh working tree, as the spike did.
# This leaves vendor/scummvm untouched; only this tree is ever configured for
# Emscripten. `git init` gives the tree a repo context so hooks.patch can be
# applied/checked with `git apply` (which patches the working tree and needs no
# commit — so we do NOT stage or commit the ~40k-file snapshot, which is slow
# and pointless here).

if [ ! -d "$WEB_DIR" ]; then
  log "materializing $WEB_DIR from vendor/scummvm HEAD ($(git -C "$SCUMMVM_DIR" rev-parse --short HEAD))"
  mkdir -p "$WEB_DIR"
  git -C "$SCUMMVM_DIR" archive HEAD | tar -x -C "$WEB_DIR"
  git -C "$WEB_DIR" init -q
else
  log "reusing existing $WEB_DIR"
fi

DRASCULA_DIR="$WEB_DIR/engines/drascula"
[ -d "$DRASCULA_DIR" ] || die "Drascula engine missing in $WEB_DIR. Delete vendor/scummvm-web and re-run."

# --- optional clean ----------------------------------------------------------
#
# Reset only the engine source changes we introduce, so a fresh apply is
# deterministic. Scoped to the web tree; never touches vendor/scummvm.

if [ "$CLEAN" -eq 1 ]; then
  log "cleaning previous engine source changes in $WEB_DIR"
  rm -f "$DRASCULA_DIR/a11y.cpp" "$DRASCULA_DIR/a11y.h"
  git -C "$WEB_DIR" checkout -q -- engines/drascula/module.mk engines/drascula 2>/dev/null || true
  ( cd "$WEB_DIR" && make distclean >/dev/null 2>&1 || true )
fi

# --- 1. engine source flow (identical to build-engine.sh) --------------------

log "copying a11y.cpp / a11y.h into engines/drascula"
cp "$ENGINE_SRC/a11y.cpp" "$DRASCULA_DIR/a11y.cpp"
cp "$ENGINE_SRC/a11y.h"   "$DRASCULA_DIR/a11y.h"

MODULE_MK="$DRASCULA_DIR/module.mk"
if grep -q '[[:space:]]a11y\.o' "$MODULE_MK"; then
  log "module.mk already lists a11y.o"
else
  log "adding a11y.o to module.mk"
  awk '
    { print }
    /^MODULE_OBJS := \\$/ && !done { print "\ta11y.o \\"; done=1 }
  ' "$MODULE_MK" > "$MODULE_MK.tmp"
  grep -q '[[:space:]]a11y\.o' "$MODULE_MK.tmp" || die "failed to inject a11y.o into module.mk"
  mv "$MODULE_MK.tmp" "$MODULE_MK"
fi

if [ -f "$HOOKS_PATCH" ] && grep -Eq '^(diff |--- |\+\+\+ |@@ )' "$HOOKS_PATCH"; then
  log "applying engine/hooks.patch"
  if git -C "$WEB_DIR" apply --check "$HOOKS_PATCH" 2>/dev/null; then
    git -C "$WEB_DIR" apply "$HOOKS_PATCH"
  elif git -C "$WEB_DIR" apply --reverse --check "$HOOKS_PATCH" 2>/dev/null; then
    log "hooks.patch already applied; skipping"
  else
    die "hooks.patch does not apply cleanly to the web tree"
  fi
else
  log "hooks.patch has no diff hunks yet; nothing to apply (placeholder)"
fi

# --- 2. emsdk 4.0.10, fetched with curl (build.sh would use wget) ------------
#
# Place the pinned emsdk exactly where dists/emscripten/build.sh looks for it
# ($DIST_FOLDER/emsdk-$EMSDK_VERSION). With it already unpacked there, build.sh
# skips its wget download block entirely and just activates it. Then install and
# activate the toolchain so emconfigure/emmake are on PATH for configure+make.

if [ ! -d "$EMSDK_DIR" ]; then
  log "fetching emsdk $EMSDK_VERSION with curl (macOS has no wget)"
  ( cd "$WEB_DIR/dists/emscripten" \
      && curl -sSL -o "$EMSDK_TARBALL" "$EMSDK_URL" \
      && tar -xf "$EMSDK_TARBALL" ) \
    || die "failed to fetch/unpack emsdk $EMSDK_VERSION from $EMSDK_URL"
else
  log "emsdk $EMSDK_VERSION already present"
fi
[ -x "$EMSDK_DIR/emsdk" ] || die "emsdk not found after install at $EMSDK_DIR/emsdk. Delete it and re-run."

log "installing + activating emsdk $EMSDK_VERSION"
( cd "$EMSDK_DIR" && ./emsdk install "$EMSDK_VERSION" && ./emsdk activate "$EMSDK_VERSION" ) \
  || die "emsdk install/activate failed"

# Put emconfigure/emmake/emcc on PATH for this script.
# shellcheck disable=SC1091
source "$EMSDK_DIR/emsdk_env.sh" >/dev/null 2>&1 || die "could not source emsdk_env.sh"

command -v emconfigure >/dev/null 2>&1 || die "emconfigure not found after activating emsdk. Check $EMSDK_DIR."
command -v emmake      >/dev/null 2>&1 || die "emmake not found after activating emsdk. Check $EMSDK_DIR."

# --- 3. configure (Drascula only, Ogg/Vorbis mandatory) ----------------------
#
# Run build.sh's `configure` task: it activates the emsdk itself and runs
# emconfigure ./configure with our args. --enable-ogg --enable-vorbis are
# mandatory; without them configure finds neither codec and the music pack is
# silent (spike 03). This writes config only into vendor/scummvm-web.

log "configuring Emscripten build in $WEB_DIR (Drascula only, Ogg/Vorbis on)"
( cd "$WEB_DIR" && ./dists/emscripten/build.sh configure \
    --disable-all-engines --enable-engine=drascula --disable-debug \
    --enable-ogg --enable-vorbis --enable-zlib ) \
  || die "configure failed"

# --- 4. build + dist, sized with sysctl (build.sh's make would use nproc) ----

log "building: emmake make -j$JOBS"
( cd "$WEB_DIR" && emmake make -j"$JOBS" ) || die "emmake make failed"

log "bundling: emmake make dist-emscripten"
( cd "$WEB_DIR" && emmake make dist-emscripten ) || die "emmake make dist-emscripten failed"

BUILD_OUT="$WEB_DIR/build-emscripten"
[ -f "$BUILD_OUT/scummvm.wasm" ] || die "scummvm.wasm not produced in $BUILD_OUT. The build did not complete."

# --- 5. game data into /data, by reference only ------------------------------
#
# Copy the game FROM the gitignored vendor/game/drascula INTO the gitignored
# build-emscripten/data tree, then re-run the HTTP index generator so each
# folder has its index.json listing. Nothing here is tracked: both source and
# destination live under vendor/, which is gitignored. We never copy game data
# into a tracked path, and never `git add` it.

[ -d "$GAME_SRC" ] || die "game data missing at $GAME_SRC. Run scripts/fetch.sh first."
DATA_GAME="$BUILD_OUT/data/games/drascula"
log "populating /data with game data (by reference from $GAME_SRC; never committed)"
mkdir -p "$DATA_GAME"
cp -R "$GAME_SRC"/* "$DATA_GAME"/

log "re-running the HTTP index generator (build-make_http_index.py)"
python3 "$WEB_DIR/dists/emscripten/build-make_http_index.py" "$BUILD_OUT/data" \
  || die "build-make_http_index.py failed (python3 present but the generator errored)"

# --- done --------------------------------------------------------------------

log "web build done."
log "  tree:   $WEB_DIR (vendor/scummvm left untouched)"
log "  output: $BUILD_OUT"
log "  files:  scummvm.wasm, scummvm.js, translations.dat, themes, data/ (Packet.001, drascula.dat, Ogg, index.json)"
log "  launch: #--savepath=/tmp --subtitles -p /data/games/drascula drascula  (no --extrapath; drascula.dat is in /data)"
log "  NOTE:   game data is under vendor/ (gitignored); it is never staged or committed."
