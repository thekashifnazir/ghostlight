#!/usr/bin/env bash
#
# ch2-exit-street.sh — prove the chapter-2 inn-bar -> street exit SETTLES.
#
# Regression for the chapter-2 blocker (engine a11y layer): using the inn-bar
# exit "stairs down to the street" (room 14, hotspot/object 159 -> room 12) via
# `walk 159` used to leave the web player wedged on `busy`. The engine DID change
# to room 12, but poll() stamped its liveness clock at the TOP of the frame,
# BEFORE runCommand() ran the whole walk+transition (hundreds of ms) inside that
# one frame; by the tail the stamp was stale, so the control probe read `busy`
# and NO `A11Y_PHASE control` was emitted, the room-state line was suppressed,
# and the exit said nothing. The fix: on a command-driven room change poll()
# re-emits the new room's A11Y state line (hotspot list + room name) and
# re-stamps liveness so `A11Y_PHASE control` is emitted on the settling frame.
#
# Why this is its OWN script and not a plain drive.sh run: the assertions below
# are specific to the bug (a `control` phase AND a re-emitted room-12 state line
# after the walk), so this wraps drive.sh's launch/wait pattern with dedicated
# guard checks, in the same spirit as scripts/over-skip-crossing.sh.
#
# It starts from a chapter-2 save (slot 9, made by scripts/make-ch2-save.sh),
# so it reaches room 14 in ~2s instead of replaying all of chapter 1. The save
# is NOT committed (a Drascula save embeds a copyrighted thumbnail); regenerate
# it with scripts/make-ch2-save.sh if missing.
#
# Usage:
#   scripts/ch2-exit-street.sh [savepath] [slot] [--out <file>]
#
#   savepath     directory for a11y-cmd.txt and the run log (default
#                /tmp/ghostlight-engine)
#   slot         chapter-2 save slot to LOAD (default 9)
#   --out <file> also copy the captured A11Y* lines to this file. Default: none.
#
# Exit status:
#   0  the exit settled: room changed 14 -> 12, `A11Y_PHASE control` followed,
#      the room-12 A11Y state line was re-emitted (hotspot list + room name).
#   1  launch/data/save problem, or the engine never reached room 14.
#   2  the fix regressed: no `control` after the room change, or no room-12
#      state line (the wedge is back).
#
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENDOR="$ROOT/vendor"
SCUMMVM="$VENDOR/scummvm/scummvm"
GAME_DIR="$VENDOR/game/drascula"
ENGINE_DATA="$VENDOR/scummvm/dists/engine-data"

SAVEPATH="/tmp/ghostlight-engine"
SLOT="9"
OUT=""
POSITIONAL=0
while [ $# -gt 0 ]; do
  case "$1" in
    --out) shift; OUT="${1:?--out needs a file}" ;;
    *)
      if [ "$POSITIONAL" -eq 0 ]; then SAVEPATH="$1"; POSITIONAL=1
      else SLOT="$1"; fi
      ;;
  esac
  shift
done

log() { printf '[ch2-exit] %s\n' "$*" >&2; }
die() { printf '[ch2-exit] ERROR: %s\n' "$*" >&2; exit 1; }
fail_guard() { printf '[ch2-exit] GUARD FAILED: %s\n' "$*" >&2; exit 2; }

# A clean SKIP (not a failure) when the build or data is absent, matching how the
# live Playwright spec skips when the wasm build is missing. The vitest wrapper
# turns exit 3 into a skipped test.
skip() { printf '[ch2-exit] SKIP: %s\n' "$*" >&2; exit 3; }

[ -x "$SCUMMVM" ] || skip "native binary missing: $SCUMMVM (run scripts/build-engine.sh)"
[ -f "$GAME_DIR/Packet.001" ] || skip "game data missing in $GAME_DIR (run scripts/fetch.sh)"
[ -f "$ENGINE_DATA/drascula.dat" ] || skip "drascula.dat missing in $ENGINE_DATA"
case "$SLOT" in ''|*[!0-9]*) die "slot must be a whole number, got: $SLOT" ;; esac

mkdir -p "$SAVEPATH"

# Ensure the chapter-2 save exists; regenerate it if missing (saves are not
# committed). If it still cannot be produced, SKIP cleanly rather than hang.
SAVE_FILE="$SAVEPATH/drascula.$(printf '%03d' "$SLOT")"
if [ ! -f "$SAVE_FILE" ]; then
  log "chapter-2 save $SAVE_FILE missing; regenerating with make-ch2-save.sh"
  if ! bash "$ROOT/scripts/make-ch2-save.sh" "$SAVEPATH" "$SLOT" >/dev/null 2>&1; then
    skip "could not produce a chapter-2 save (crossing feeder failed unattended); see make-ch2.log"
  fi
  [ -f "$SAVE_FILE" ] || skip "chapter-2 save still missing after make-ch2-save.sh"
fi

CMD="$SAVEPATH/a11y-cmd.txt"
LOG="$SAVEPATH/ch2-exit.log"
: > "$CMD"; rm -f "$LOG"

# Overall hard cap. The run is a save load (~2s) plus one walk, so a 60s cap is
# generous; it bounds a wedge so the test fails loudly instead of hanging.
CAP=60
DEADLINE=$(( $(date +%s) + CAP ))

# Track the engine PID directly and kill -9 it (ScummVM ignores SIGTERM, gotcha
# 12). We never pgrep for it, so a wait loop cannot match its own command line.
ENGINE_PID=""
cleanup() {
  [ -n "$ENGINE_PID" ] || return 0
  kill -0 "$ENGINE_PID" 2>/dev/null || return 0
  kill -9 "$ENGINE_PID" 2>/dev/null || true
  wait "$ENGINE_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# Launch LOADING the chapter-2 save (--save-slot), so the run starts in room 14.
"$SCUMMVM" --path="$GAME_DIR" --extrapath="$ENGINE_DATA" --savepath="$SAVEPATH" \
  --save-slot="$SLOT" --subtitles drascula >"$LOG" 2>&1 &
ENGINE_PID=$!

app() { printf '%s\n' "$1" >> "$CMD"; }

waitfor() {
  local marker="$1"
  while :; do
    grep -qF "$marker" "$LOG" 2>/dev/null && return 0
    kill -0 "$ENGINE_PID" 2>/dev/null || return 1
    [ "$(date +%s)" -ge "$DEADLINE" ] && return 1
    sleep 0.2
  done
}

# 1) Engine up in chapter 2, room 14 (the inn bar), from the loaded save.
waitfor 'A11Y {"chapter":2,"room":14' \
  || die "engine never reached chapter 2 room 14 from save slot $SLOT"
log "in chapter 2 room 14 (inn bar)"

# 2) Use the street exit. `walk 159` (stairs down to the street) is a within-
#    chapter door 159 -> room 12. Wait for its settle marker, exactly as drive.sh
#    does for the last command.
log "driving walk 159 (stairs down to the street -> room 12)"
app 'walk 159'
waitfor 'A11Y_CMD walk 159' || die "walk 159 was never echoed"
waitfor 'A11Y_DIFF {"cmd":"walk 159"' \
  || fail_guard "walk 159 never produced a diff (the engine wedged on the exit)"

# A short bounded settle window so the trailing room-state line and the
# `A11Y_PHASE control` the SAME frame emits are flushed to the log before we
# read it (bounded by the overall deadline; the command already settled above).
SETTLE_UNTIL=$(( $(date +%s) + 2 ))
while [ "$(date +%s)" -lt "$SETTLE_UNTIL" ] && [ "$(date +%s)" -lt "$DEADLINE" ]; do
  kill -0 "$ENGINE_PID" 2>/dev/null || break
  sleep 0.2
done

cleanup
ENGINE_PID=""

# --- report + guard assertions ----------------------------------------------

A11Y_LINES="$(grep -E '^A11Y' "$LOG" 2>/dev/null || true)"
[ -n "$A11Y_LINES" ] || { tail -20 "$LOG" >&2 || true; die "no A11Y lines captured"; }

printf '%s\n' "$A11Y_LINES"
if [ -n "$OUT" ]; then
  printf '%s\n' "$A11Y_LINES" > "$OUT"
  log "captured lines also written to $OUT"
fi

# Guard 1: the exit changed room 14 -> 12 (the engine room change works; the
# bug was never in the engine's room change, only in the a11y completion).
printf '%s\n' "$A11Y_LINES" | grep -F 'A11Y_DIFF {"cmd":"walk 159"' | grep -qF '"room":[14,12]' \
  || fail_guard "the walk-159 diff does not carry room [14,12]"

# Guard 2 (THE FIX, part 1): after the room-changing walk, the layer emits
# `A11Y_PHASE control` — the command settled and the web player returns to
# `ready`. Without the fix the last phase stays `busy` (the wedge). We check the
# LAST phase line is `control`.
LAST_PHASE="$(printf '%s\n' "$A11Y_LINES" | grep -E '^A11Y_PHASE ' | tail -1)"
[ -n "$LAST_PHASE" ] || fail_guard "no A11Y_PHASE line at all"
printf '%s\n' "$LAST_PHASE" | grep -qF 'A11Y_PHASE control' \
  || fail_guard "last phase after the exit is not control (got: $LAST_PHASE) — the exit wedged on busy"

# Guard 3 (THE FIX, part 2): the new room's A11Y state line is re-emitted after
# the exit, so the player's hotspot list refreshes to room 12 and the room name
# is spoken on arrival. A room-12 state line with the street's own hotspots must
# appear AFTER the walk-159 diff.
AFTER_WALK="$(printf '%s\n' "$A11Y_LINES" | awk '/A11Y_DIFF \{"cmd":"walk 159"/{seen=1} seen')"
printf '%s\n' "$AFTER_WALK" | grep -qE 'A11Y \{"chapter":2,"room":12' \
  || fail_guard "no room-12 A11Y state line re-emitted after the exit (hotspot list would stay on the inn bar)"

# Guard 4: the re-emitted room-12 state line carries the street's own hotspots
# (e.g. the inn door 156 and the street-to-square exit 151), not the inn bar's —
# so the player's hotspot list genuinely shows room 12.
ROOM12_LINE="$(printf '%s\n' "$AFTER_WALK" | grep -E 'A11Y \{"chapter":2,"room":12' | tail -1)"
printf '%s\n' "$ROOM12_LINE" | grep -qF '"num":156' \
  || fail_guard "the re-emitted room-12 state line is missing the inn door (156); hotspot list did not refresh"

log "guard held: exit settled, room 14 -> 12, A11Y_PHASE control emitted, room-12 state re-emitted"
exit 0
