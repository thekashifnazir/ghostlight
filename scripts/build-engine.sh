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
#   scripts/build-engine.sh --reconfigure   # force a fresh ./configure
#   scripts/build-engine.sh --jobs N        # parallel make jobs (default: ncpu)
#
# Configure is run only when needed (pristine tree, changed engine sources, or
# --reconfigure/--clean). On a tree already configured for the current sources
# the script reuses config.mk and goes straight to make. This both speeds up
# incremental builds and sidesteps a macOS flake where configure's unsigned
# compiler-probe binaries are SIGKILLed under parallel load (see run_configure).
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

# Stamp recording the engine sources configure last ran against. Lets us skip a
# redundant (and intermittently flaky, see run_configure) re-configure when the
# tree is already configured for exactly these sources. See step 4.
CONFIG_STAMP="$SCUMMVM_DIR/.ghostlight-config-stamp"
# Copy of the hooks.patch last applied to the tree, so a changed patch can be
# unapplied before the new one goes on (see step 3).
APPLIED_PATCH="$SCUMMVM_DIR/.ghostlight-hooks-applied.patch"

# --- options -----------------------------------------------------------------

WEB=0
CLEAN=0
JOBS=""
RECONFIGURE=0

while [ $# -gt 0 ]; do
  case "$1" in
    --web)   WEB=1 ;;
    --clean) CLEAN=1 ;;
    --reconfigure) RECONFIGURE=1 ;;
    --jobs)  shift; JOBS="${1:?--jobs needs a number}" ;;
    --jobs=*) JOBS="${1#--jobs=}" ;;
    -h|--help)
      sed -n '2,48p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
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

# A fingerprint of the engine sources configure depends on. If this matches the
# recorded stamp and config.mk is present, the tree is already configured for
# exactly these sources and we can skip the configure step (see run_configure).
engine_fingerprint() {
  # Hash our sources + the engine selection, so any change to the a11y code, the
  # hooks, the generated module.mk, or the configure front-end re-triggers a
  # full configure. Portable: shasum on macOS, sha256sum elsewhere.
  local hasher
  if command -v shasum >/dev/null 2>&1; then hasher="shasum -a 256"
  else hasher="sha256sum"; fi
  cat "$ENGINE_SRC/a11y.cpp" "$ENGINE_SRC/a11y.h" "$HOOKS_PATCH" \
      "$DRASCULA_DIR/module.mk" 2>/dev/null \
    | $hasher | awk '{print $1}'
}

# run_configure <web|native> -- run ./configure with two kinds of resilience.
#
# WHY: on macOS, ./configure writes tiny unsigned probe executables to a temp
# dir and runs them to detect compiler/library features. Under load — e.g. two
# parallel build chats, each spawning make -jN — the OS has been observed to
# SIGKILL these freshly-written unsigned binaries before they can run (Gatekeeper
# / code-signing enforcement racing the write), so configure fails with a probe
# that died on signal 9. The build itself is fine; the probe was collateral. A
# prior session was unblocked by simply not re-running configure (reusing the
# already-good config.mk) and, when a fresh configure was needed, retrying it.
#
# This helper does BOTH, without masking real failures:
#   * It retries configure ONLY when the failure looks like a killed probe
#     (exit 137, or a config.log signature of a signal-9 probe). A genuine
#     configure error (missing library, bad flag) does not match and fails fast.
#   * Callers decide when configure can be skipped entirely (stamp match); this
#     function always does a real configure when invoked.
run_configure() {
  local mode="$1" ; shift
  local attempt=1 max=4 rc
  local cfg=( ./configure "${CONFIGURE_ARGS[@]}" )
  [ "$mode" = "web" ] && cfg=( emconfigure "${cfg[@]}" )

  while :; do
    rc=0
    "${cfg[@]}" || rc=$?
    [ "$rc" -eq 0 ] && return 0

    # Did a compiler probe get killed by a signal (SIGKILL=9 -> exit 137), rather
    # than configure finding a real problem? Check both the exit code and the
    # config.log probe trail. Anything else is a real error: fail immediately.
    local killed=0
    [ "$rc" -ge 128 ] && killed=1
    if [ -f config.log ] && grep -Eq 'Killed: 9|signal 9|received signal|: Killed' config.log; then
      killed=1
    fi

    if [ "$killed" -ne 1 ]; then
      die "configure failed (exit $rc) for a reason that is not a killed probe; not retrying. See $SCUMMVM_DIR/config.log"
    fi
    if [ "$attempt" -ge "$max" ]; then
      die "configure's compiler probe was killed $attempt times in a row (the macOS unsigned-probe-under-load SIGKILL). Try again with less parallel load, or run scripts/build-engine.sh on its own."
    fi
    log "configure probe was killed (exit $rc); likely the macOS unsigned-probe-under-load SIGKILL. Retry $attempt/$((max-1)) after short backoff..."
    sleep $(( attempt * 2 ))
    attempt=$(( attempt + 1 ))
  done
}

# require_vorbis -- stop unless the configured tree has Vorbis (USE_VORBIS).
#
# WHY: the game ships its music as an Ogg pack. If ScummVM is built without
# Vorbis, configure still succeeds, the engine finds the Ogg pack at run time,
# cannot play it, and opens a modal "CD audio tracks" warning
# (warnMissingExtractedCDAudio) that blocks the a11y layer. So Vorbis is
# required, not optional. configure writes USE_VORBIS into config.h when found.
# Runs after every configure AND when configure is skipped on a stamp match, so a
# tree configured without Vorbis can never pass silently.
require_vorbis() {
  if grep -q '^#define USE_VORBIS' "$SCUMMVM_DIR/config.h" 2>/dev/null; then
    log "Vorbis support found (USE_VORBIS set in config.h)"
    return 0
  fi
  die "ScummVM was configured WITHOUT Vorbis (USE_VORBIS is not set in $SCUMMVM_DIR/config.h).
  Without it the game cannot play its Ogg audio pack and hangs on a modal \"CD audio tracks\" dialog.
  Install the development packages, then re-run with --reconfigure:
    Debian/Ubuntu:  sudo apt install libvorbis-dev libogg-dev
    macOS:          brew install libvorbis
  Then: scripts/build-engine.sh --reconfigure"
}

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
  rm -f "$CONFIG_STAMP" "$APPLIED_PATCH"
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
  # If hooks.patch changed since it was last applied, the tree still carries the
  # OLD version, which would make neither forward nor reverse apply of the new
  # one succeed. Reverse the copy we kept of what we applied, first.
  if [ -f "$APPLIED_PATCH" ] && ! cmp -s "$APPLIED_PATCH" "$HOOKS_PATCH"; then
    if git -C "$SCUMMVM_DIR" apply --reverse --check "$APPLIED_PATCH" 2>/dev/null; then
      log "hooks.patch changed; unapplying the previously applied version"
      git -C "$SCUMMVM_DIR" apply --reverse "$APPLIED_PATCH"
    else
      log "previously applied hooks.patch does not reverse cleanly; trying the new one as is"
    fi
    rm -f "$APPLIED_PATCH"
  fi
  log "applying engine/hooks.patch"
  if git -C "$SCUMMVM_DIR" apply --check "$HOOKS_PATCH" 2>/dev/null; then
    git -C "$SCUMMVM_DIR" apply "$HOOKS_PATCH"
    cp "$HOOKS_PATCH" "$APPLIED_PATCH"
  elif git -C "$SCUMMVM_DIR" apply --reverse --check "$HOOKS_PATCH" 2>/dev/null; then
    log "hooks.patch already applied; skipping"
    [ -f "$APPLIED_PATCH" ] || cp "$HOOKS_PATCH" "$APPLIED_PATCH"
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
#
# Configure is the expensive and (on macOS, under parallel load) occasionally
# flaky step: it writes and runs unsigned compiler-probe binaries that the OS
# can SIGKILL out from under it (see run_configure). We therefore run configure
# only when it is actually needed:
#   * the tree has never been configured (no config.mk), OR
#   * the engine sources changed since the last configure (stamp mismatch), OR
#   * the caller forced it (--reconfigure / --clean wiped the tree).
# Otherwise we reuse the existing, known-good config.mk and go straight to make
# — which is exactly what unblocked the prior session. A full configure still
# happens on a pristine tree, so a fresh vendor/ + this script reproduces fully.

cd "$SCUMMVM_DIR"

CONFIGURE_ARGS=(--disable-all-engines --enable-engine=drascula)
# Native: do NOT pass --enable-vorbis. In this ScummVM, =yes skips the library
# probe, so configure would not fail early on a missing libvorbis; it would set
# USE_VORBIS anyway and only fail at link time, and it would defeat
# require_vorbis. Leaving it on autodetect makes USE_VORBIS an honest probe result.
# Web: ScummVM's emscripten branch forces Vorbis/Ogg OFF unless explicitly
# enabled (they come from emscripten ports), so they must be passed, as
# scripts/build-web.sh already does.
[ "$WEB" -eq 1 ] && CONFIGURE_ARGS+=(--enable-ogg --enable-vorbis)

# A --clean wipes the config, so a reconfigure is mandatory after it.
[ "$CLEAN" -eq 1 ] && RECONFIGURE=1

want_configure=1
if [ "$RECONFIGURE" -eq 0 ] && [ -f "$SCUMMVM_DIR/config.mk" ] \
   && [ -f "$CONFIG_STAMP" ] && [ "$(cat "$CONFIG_STAMP")" = "$(engine_fingerprint)" ]; then
  want_configure=0
fi

if [ "$WEB" -eq 1 ]; then
  if [ "$want_configure" -eq 1 ]; then
    log "configuring Emscripten build (Drascula only)"
    run_configure web
    require_vorbis
    engine_fingerprint > "$CONFIG_STAMP"
  else
    log "tree already configured for these engine sources; skipping configure (reuse config.mk)"
    require_vorbis
  fi
  log "building with emmake make -j$JOBS"
  emmake make -j"$JOBS"
  log "web build done. wasm + data are in $SCUMMVM_DIR (see the web player spec for packaging)."
else
  if [ "$want_configure" -eq 1 ]; then
    log "configuring native build (Drascula only)"
    run_configure native
    require_vorbis
    engine_fingerprint > "$CONFIG_STAMP"
  else
    log "tree already configured for these engine sources; skipping configure (reuse config.mk)"
    require_vorbis
  fi
  log "building with make -j$JOBS"
  make -j"$JOBS"
  log "native build done: $SCUMMVM_DIR/scummvm"
  log "run it (real window) with:"
  log "  $SCUMMVM_DIR/scummvm --path=$VENDOR/game/drascula --extrapath=$SCUMMVM_DIR/dists/engine-data --savepath=/tmp/ghostlight --subtitles drascula"
fi
