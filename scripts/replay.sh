#!/usr/bin/env bash
#
# replay.sh — feed a command script to the native Drascula a11y build and
# capture the A11Y* log lines it emits.
#
# This is the minimal replay harness used by the engine-a11y-layer checkpoints
# (tasks 6, 12, 18). It is deliberately small and reusable; task 21 formalises
# the four spike scripts into regression fixtures and asserts full A11Y_DIFF
# sequences. Here the harness only has to: write the command file, launch the
# native binary in a real window (fully headless SDL is flaky, gotcha 12),
# capture stderr, and stop after a timeout.
#
# How the command file is consumed: the a11y layer reads <savepath>/a11y-cmd.txt
# every frame, queues every non-blank, non-`#` line, then truncates the file
# (engine/a11y.cpp readCommandFile). So the whole script can be written up front
# before launch; the engine picks it all up on the first frame the file exists
# and runs the commands one at a time as each settles (R2.1, R2.2).
#
# Usage:
#   scripts/replay.sh <command-script> [seconds] [savepath]
#
#   <command-script>  a text file of commands, one per line (see tests/engine/fixtures)
#   seconds           how long to let the engine run before stopping (default 45)
#   savepath          where a11y-cmd.txt lives and saves are written
#                     (default: a fresh temp dir, removed on exit)
#
# Output:
#   * every captured A11Y* line is printed to stdout (prefixes A11Y, A11Y_CMD,
#     A11Y_DIFF, A11Y_TEXT, A11Y_ERR, A11Y_INV, A11Y_CHOICES, A11Y_SAVED,
#     A11Y_HOVER, A11Y_SAY)
#   * the full raw stderr log is left at <savepath>/replay.log
#
# Exit status: 0 if at least one A11Y line was captured, 1 otherwise.
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENDOR="$ROOT/vendor"
SCUMMVM="$VENDOR/scummvm/scummvm"
GAME_DIR="$VENDOR/game/drascula"
ENGINE_DATA="$VENDOR/scummvm/dists/engine-data"

log() { printf '[replay] %s\n' "$*" >&2; }
die() { printf '[replay] ERROR: %s\n' "$*" >&2; exit 1; }

# --- arguments ---------------------------------------------------------------

SCRIPT="${1:-}"
SECONDS_TO_RUN="${2:-45}"
SAVEPATH="${3:-}"

[ -n "$SCRIPT" ] || die "usage: scripts/replay.sh <command-script> [seconds] [savepath]"
[ -f "$SCRIPT" ] || die "command script not found: $SCRIPT"

# --- preflight ---------------------------------------------------------------

[ -x "$SCUMMVM" ] || die "native binary missing: $SCUMMVM (run scripts/build-engine.sh)"
[ -f "$GAME_DIR/Packet.001" ] || die "game data missing in $GAME_DIR (run scripts/fetch.sh)"
[ -f "$ENGINE_DATA/drascula.dat" ] || die "drascula.dat missing in $ENGINE_DATA"

# --- savepath (the command file lives here) ----------------------------------

CLEANUP_SAVEPATH=0
if [ -z "$SAVEPATH" ]; then
  SAVEPATH="$(mktemp -d "${TMPDIR:-/tmp}/ghostlight-replay.XXXXXX")"
  CLEANUP_SAVEPATH=1
fi
mkdir -p "$SAVEPATH"

CMD_FILE="$SAVEPATH/a11y-cmd.txt"
RAW_LOG="$SAVEPATH/replay.log"

# Write the command script into the file the engine reads. It is present from
# frame one, so the engine queues every command on the first poll.
cp "$SCRIPT" "$CMD_FILE"

cleanup() {
  # Stop the engine if it is still up.
  if [ -n "${ENGINE_PID:-}" ] && kill -0 "$ENGINE_PID" 2>/dev/null; then
    kill "$ENGINE_PID" 2>/dev/null || true
    wait "$ENGINE_PID" 2>/dev/null || true
  fi
  if [ "$CLEANUP_SAVEPATH" -eq 1 ]; then
    rm -rf "$SAVEPATH" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

# --- launch (real window; gotcha 12) -----------------------------------------
#
# --subtitles is mandatory or no text is drawn (gotcha 1 / R6.1).
# --extrapath gives the engine drascula.dat and, with the Ogg pack in the game
# dir, avoids the blocking CD-audio dialog (gotcha 13).
# --savepath is where a11y-cmd.txt is read and saves are written.
# -g null keeps the graphics backend light while still opening a real window.

log "launching native build; running for ${SECONDS_TO_RUN}s"
log "  savepath: $SAVEPATH"
log "  commands: $(grep -cv '^[[:space:]]*\(#.*\)\?$' "$SCRIPT" || true) line(s)"

"$SCUMMVM" \
  --path="$GAME_DIR" \
  --extrapath="$ENGINE_DATA" \
  --savepath="$SAVEPATH" \
  --subtitles \
  drascula >"$RAW_LOG" 2>&1 &
ENGINE_PID=$!

# Let it run, then stop it. We do not try to detect "script finished" here; the
# fixed window is enough for a smoke checkpoint, and task 21 adds precise
# sequence assertions.
SLEPT=0
while [ "$SLEPT" -lt "$SECONDS_TO_RUN" ]; do
  if ! kill -0 "$ENGINE_PID" 2>/dev/null; then
    log "engine exited early after ${SLEPT}s"
    break
  fi
  sleep 1
  SLEPT=$((SLEPT + 1))
done

if kill -0 "$ENGINE_PID" 2>/dev/null; then
  kill "$ENGINE_PID" 2>/dev/null || true
  wait "$ENGINE_PID" 2>/dev/null || true
fi
ENGINE_PID=""

# --- report ------------------------------------------------------------------

# Pull just the a11y lines out of the raw log, in order.
A11Y_LINES="$(grep -E '^A11Y' "$RAW_LOG" || true)"

if [ -z "$A11Y_LINES" ]; then
  log "no A11Y lines captured. Raw log: $RAW_LOG"
  # Keep a non-temp savepath's log around; a temp one is about to be removed, so
  # surface the tail to help debugging before cleanup wipes it.
  if [ "$CLEANUP_SAVEPATH" -eq 1 ]; then
    log "raw log tail:"
    tail -20 "$RAW_LOG" >&2 || true
  fi
  exit 1
fi

printf '%s\n' "$A11Y_LINES"
log "captured $(printf '%s\n' "$A11Y_LINES" | wc -l | tr -d ' ') A11Y line(s). Raw log: $RAW_LOG"
