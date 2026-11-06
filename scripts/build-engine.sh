#!/usr/bin/env bash
#
# build-engine.sh — build the patched ScummVM Drascula engine from engine/.
#
# Our engine code lives in engine/ (a11y.cpp, a11y.h, hooks.patch). vendor/ is a
# pinned ScummVM checkout fetched by scripts/fetch.sh and is NEVER edited by
# hand. This script is the only thing that touches vendor/scummvm sources:
#
#   1. copy engine/a11y.cpp and engine/a11y.h into the Drascula engine
#   2. register a11y.o in the engine's module.mk (idempotent)
#   3. apply engine/hooks.patch (the small hooks in existing files), if it has
#      any diff hunks
#   4. configure (Drascula engine only) and build
#
# A fresh vendor/ (scripts/fetch.sh) plus this script reproduces the build from
# engine/ alone. Because every change flows through engine/, re-running against
# a clean vendor/ always gives the same result, and the patch stays a readable,
# reviewable artifact.
#
# Usage:
#   scripts/build-engine.sh                 # native build (dev + survey)
#   scripts/build-engine.sh --web           # Emscripten build (web player)
#   scripts/build-engine.sh --clean         # wipe engine source changes first
#   scripts/build-engine.sh --jobs N        # parallel make jobs (default: ncpu)
#
# After a native build, the binary is vendor/scummvm/scummvm. Run it in a real
# window (fully headless SDL is flaky, gotcha 12) with:
#
#   vendor/scummvm/scummvm \
#     --path=vendor/game/drascula \
#     --extrapath=vendor/scummvm/dists/engine-data \
#     --savepath=/tmp/ghostlight \
#     --subtitles \
#     drascula
#
#   * --path       the Drascula game data unpacked by fetch.sh (Packet.001 + Ogg)
#   * --extrapath  where drascula.dat lives; required so the engine finds its
#                  data file and, with the Ogg audio pack, avoids the blocking
#                  "missing CD audio" dialog (gotcha 13)
#   * --savepath   where the a11y command file (a11y-cmd.txt) is read/written
#   * --subtitles  mandatory; without it the game draws no text (gotcha 1)
#
set -euo pipefail

# --- paths -------------------------------------------------------------------

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENGINE_SRC="$ROOT/engine"
VENDOR="$ROOT/vendor"
SCUMMVM_DIR="$VENDOR/scummvm"
DRASCULA_DIR="$SCUMMVM_DIR/engines/drascula"
HOOKS_PATCH="$ENGINE_SRC/hooks.patch"

# --- options -----------------------------------------------------------------

WEB=0
CLEAN=0
JOBS=""

while [ $# -gt 0 ]; do
  case "$1" in
    --web)   WEB=1 ;;
    --clean) CLEAN=1 ;;
    --jobs)  shift; JOBS="${1:?--jobs needs a number}" ;;
    --jobs=*) JOBS="${1#--jobs=}" ;;
    -h|--help)
      sed -n '2,40p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) echo "[build] ERROR: unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

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

log() { printf '[build] %s\n' "$*"; }
die() { printf '[build] ERROR: %s\n' "$*" >&2; exit 1; }

# --- preflight ---------------------------------------------------------------

[ -d "$SCUMMVM_DIR" ]  || die "vendor/scummvm missing. Run scripts/fetch.sh first."
[ -d "$DRASCULA_DIR" ] || die "Drascula engine missing in vendor/scummvm. Re-run scripts/fetch.sh."
[ -f "$ENGINE_SRC/a11y.cpp" ] || die "engine/a11y.cpp missing."
[ -f "$ENGINE_SRC/a11y.h" ]   || die "engine/a11y.h missing."

if [ "$WEB" -eq 1 ]; then
  command -v emconfigure >/dev/null 2>&1 || die "emconfigure not found. Install and activate the Emscripten SDK for a --web build."
fi

# --- 0. optional clean -------------------------------------------------------
#
# Reset any source changes we made so a fresh apply is deterministic. We only
# touch files we introduce/modify; vendor/ as a whole is restored by fetch.sh.

if [ "$CLEAN" -eq 1 ]; then
  log "cleaning previous engine source changes"
  rm -f "$DRASCULA_DIR/a11y.cpp" "$DRASCULA_DIR/a11y.h"
  git -C "$SCUMMVM_DIR" checkout -q -- engines/drascula/module.mk engines/drascula 2>/dev/null || true
  ( cd "$SCUMMVM_DIR" && make distclean >/dev/null 2>&1 || true )
fi

# --- 1. copy our engine sources into the pinned checkout ---------------------

log "copying a11y.cpp / a11y.h into engines/drascula"
cp "$ENGINE_SRC/a11y.cpp" "$DRASCULA_DIR/a11y.cpp"
cp "$ENGINE_SRC/a11y.h"   "$DRASCULA_DIR/a11y.h"

# --- 2. register a11y.o in module.mk (idempotent) ----------------------------
#
# The engine's object list drives the build. a11y.o is our new source, so it
# must appear in MODULE_OBJS. We add it mechanically rather than by patch so the
# hooks.patch stays about the *code* hooks; re-running is a no-op if present.

MODULE_MK="$DRASCULA_DIR/module.mk"
if grep -q '[[:space:]]a11y\.o' "$MODULE_MK"; then
  log "module.mk already lists a11y.o"
else
  log "adding a11y.o to module.mk"
  # Insert "\n\ta11y.o \\" right after the "MODULE_OBJS := \" line.
  awk '
    { print }
    /^MODULE_OBJS := \\$/ && !done { print "\ta11y.o \\"; done=1 }
  ' "$MODULE_MK" > "$MODULE_MK.tmp"
  grep -q '[[:space:]]a11y\.o' "$MODULE_MK.tmp" || die "failed to inject a11y.o into module.mk"
  mv "$MODULE_MK.tmp" "$MODULE_MK"
fi

# --- 3. apply hooks.patch (only if it carries diff hunks) --------------------
#
# The placeholder patch holds only comments (no `@@` hunks or `diff`/`---`/`+++`
# headers), so there is nothing to apply yet. Once it holds real hooks, apply it
# with git apply. --check first so a bad patch fails loudly, not half-applied.

if [ -f "$HOOKS_PATCH" ] && grep -Eq '^(diff |--- |\+\+\+ |@@ )' "$HOOKS_PATCH"; then
  log "applying engine/hooks.patch"
  if git -C "$SCUMMVM_DIR" apply --check "$HOOKS_PATCH" 2>/dev/null; then
    git -C "$SCUMMVM_DIR" apply "$HOOKS_PATCH"
  elif git -C "$SCUMMVM_DIR" apply --reverse --check "$HOOKS_PATCH" 2>/dev/null; then
    log "hooks.patch already applied; skipping"
  else
    die "hooks.patch does not apply cleanly to the pinned checkout"
  fi
else
  log "hooks.patch has no diff hunks yet; nothing to apply (placeholder)"
fi

# --- 4. configure + build ----------------------------------------------------
#
# Drascula engine only, to keep the build fast and the wasm small. The same
# source tree feeds both targets; only the configure front-end differs.

cd "$SCUMMVM_DIR"

CONFIGURE_ARGS=(--disable-all-engines --enable-engine=drascula)

if [ "$WEB" -eq 1 ]; then
  log "configuring Emscripten build (Drascula only)"
  emconfigure ./configure "${CONFIGURE_ARGS[@]}"
  log "building with emmake make -j$JOBS"
  emmake make -j"$JOBS"
  log "web build done. wasm + data are in $SCUMMVM_DIR (see the web player spec for packaging)."
else
  log "configuring native build (Drascula only)"
  ./configure "${CONFIGURE_ARGS[@]}"
  log "building with make -j$JOBS"
  make -j"$JOBS"
  log "native build done: $SCUMMVM_DIR/scummvm"
  log "run it (real window) with:"
  log "  $SCUMMVM_DIR/scummvm --path=$VENDOR/game/drascula --extrapath=$SCUMMVM_DIR/dists/engine-data --savepath=/tmp/ghostlight --subtitles drascula"
fi
