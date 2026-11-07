#!/usr/bin/env bash
#
# over-skip-crossing.sh — drive the chapter 1->2 crossing with MORE `skip`s than
# the cutscene needs, to prove the over-skip guard (engine-a11y-layer task 23,
# R7.3/R7.4, gotcha 5).
#
# Why this exists, and why it is not drive.sh:
#   * drive.sh is the deterministic harness with NO fixed sleeps — it only waits
#     on log markers. The chapter 1->2 crossing is a long cutscene (animation_2_1)
#     advanced one line at a time by repeated `skip`s written WHILE the cutscene's
#     updateEvents() loop runs; only a live, timed skip feeder can produce it (a
#     skip sitting in the file before the cutscene is a harmless no-op). That
#     timed feeder is the same shape as scripts/make-ch2-save.sh — kept out of
#     drive.sh on purpose.
#   * Unlike make-ch2-save.sh, this script deliberately OVER-skips: once it has
#     driven talk 52 and walk 105, it keeps pacing skips well past the point the
#     crossing completes (a burst far larger than the cutscene has lines/steps).
#     If the over-skip guard works, the surplus skips are dropped at the chapter
#     boundary: the walk-105 diff is still ONE coherent crossing diff (chapter
#     [1,2], room [62,14]), and a follow-up `dump` + `look 102` in chapter 2 show
#     room 14 with the hero in-bounds and NO stray skipped line — i.e. the look
#     still speaks its line rather than being eaten by a leftover skip.
#
# Usage:
#   scripts/over-skip-crossing.sh [savepath] [--out <file>]
#
#   savepath     directory for a11y-cmd.txt and the run log (default
#                /tmp/ghostlight-engine)
#   --out <file> also copy the captured A11Y* lines to this file (for the test
#                to read). Default: none (stdout only).
#
# Exit status:
#   0  the crossing produced exactly one coherent crossing diff and chapter 2
#      room 14 is live afterwards with a spoken look line (guard held).
#   1  launch/data problem, or the crossing never completed.
#   2  the over-skip guard FAILED: more than one crossing diff, wrong room, or a
#      stray skip ate the follow-up look line.
#
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENDOR="$ROOT/vendor"
SCUMMVM="$VENDOR/scummvm/scummvm"
GAME_DIR="$VENDOR/game/drascula"
ENGINE_DATA="$VENDOR/scummvm/dists/engine-data"

SAVEPATH="/tmp/ghostlight-engine"
OUT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --out) shift; OUT="${1:?--out needs a file}" ;;
    *)     SAVEPATH="$1" ;;
  esac
  shift
done

log() { printf '[over-skip] %s\n' "$*" >&2; }
die() { printf '[over-skip] ERROR: %s\n' "$*" >&2; exit 1; }
fail_guard() { printf '[over-skip] GUARD FAILED: %s\n' "$*" >&2; exit 2; }

[ -x "$SCUMMVM" ] || die "native binary missing: $SCUMMVM (run scripts/build-engine.sh)"
[ -f "$GAME_DIR/Packet.001" ] || die "game data missing in $GAME_DIR (run scripts/fetch.sh)"
[ -f "$ENGINE_DATA/drascula.dat" ] || die "drascula.dat missing in $ENGINE_DATA"

mkdir -p "$SAVEPATH"
CMD="$SAVEPATH/a11y-cmd.txt"
LOG="$SAVEPATH/over-skip.log"
: > "$CMD"; rm -f "$LOG"

# Overall hard cap so a stuck crossing can never hang. The crossing legitimately
# takes a couple of minutes under paced skips; this bounds the whole run.
CAP=240
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

"$SCUMMVM" --path="$GAME_DIR" --extrapath="$ENGINE_DATA" --savepath="$SAVEPATH" \
  --subtitles drascula >"$LOG" 2>&1 &
ENGINE_PID=$!

app() { printf '%s\n' "$1" >> "$CMD"; }

waitfor() {
  local marker="$1"
  while :; do
    grep -qF "$marker" "$LOG" 2>/dev/null && return 0
    kill -0 "$ENGINE_PID" 2>/dev/null || return 1
    [ "$(date +%s)" -ge "$DEADLINE" ] && return 1
    sleep 0.3
  done
}

# 1) Engine up at the tavern (chapter 1, room 62).
waitfor 'A11Y {"chapter":1,"room":62' || die "engine never reached the tavern"

# 2) talk 52 sets flag 0 (unlocks door 105). Pace skips during the speech until
#    the talk-52 diff lands.
log "driving talk 52 (sets flag 0)"
app 'talk 52'
waitfor 'A11Y_CMD talk 52' || die "talk 52 was never echoed"
while :; do
  grep -qF 'A11Y_DIFF {"cmd":"talk 52"' "$LOG" 2>/dev/null && break
  kill -0 "$ENGINE_PID" 2>/dev/null || die "engine died during talk 52"
  [ "$(date +%s)" -ge "$DEADLINE" ] && die "talk 52 never settled within the cap"
  app skip
  sleep 1.2
done

# 3) THE OVER-SKIP CROSSING. walk 105, then pace skips through animation_2_1 —
#    but keep going for a fixed OVERSHOOT burst after the crossing diff appears,
#    deliberately queueing far more skips than the cutscene could consume. If the
#    guard works, the surplus is dropped at the boundary and does not bleed into
#    chapter 2.
log "driving the chapter 1->2 crossing with OVER-skipping (walk 105 + surplus skips)"
app 'walk 105'
waitfor 'A11Y_CMD walk 105' || die "walk 105 was never echoed"

CROSSED=0
OVERSHOOT=0
while :; do
  if grep -qF '"chapter":[1,2]' "$LOG" 2>/dev/null; then
    if [ "$CROSSED" -eq 0 ]; then
      log "crossed to chapter 2; continuing to OVER-skip"
      CROSSED=1
    fi
    # Keep flooding skips for a generous overshoot window AFTER the crossing
    # already completed, to stress any leftover-skip bleed.
    OVERSHOOT=$(( OVERSHOOT + 1 ))
    [ "$OVERSHOOT" -ge 12 ] && break
  fi
  kill -0 "$ENGINE_PID" 2>/dev/null || die "engine died during the crossing"
  [ "$(date +%s)" -ge "$DEADLINE" ] && die "the crossing never completed within the cap"
  # Flood: write several skips each tick so we overshoot hard, not a gentle pace.
  app skip; app skip; app skip
  sleep 0.8
done

# 4) Prove chapter 2 room 14 is live and COHERENT after the over-skip.
#    A follow-up `dump` must report chapter 2 room 14. Then `look 202` (the
#    POSTER in room 14, per the leave-tavern golden transcript) must still
#    SPEAK a line — if a stray leftover skip had bled through, it would have
#    eaten this look's speech, leaving its diff with no `said`.
sleep 2
app dump
waitfor 'A11Y_DIFF {"cmd":"dump"' || die "dump after the crossing never settled"
app 'look 202'
waitfor 'A11Y_DIFF {"cmd":"look 202"' || die "look 202 after the crossing never settled"

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

# Guard 1: EXACTLY ONE crossing diff (chapter [1,2]) for walk 105. A surplus skip
# bleeding into chapter 2 could trigger a second room/chapter diff.
CROSS_DIFFS="$(printf '%s\n' "$A11Y_LINES" | grep -cF '"chapter":[1,2]' || true)"
[ "$CROSS_DIFFS" = "1" ] || fail_guard "expected exactly 1 crossing diff (chapter [1,2]), got $CROSS_DIFFS"

# Guard 2: the crossing diff is the walk-105 diff and carries room [62,14].
printf '%s\n' "$A11Y_LINES" | grep -F 'A11Y_DIFF {"cmd":"walk 105"' | grep -qF '"chapter":[1,2]' \
  || fail_guard "the chapter [1,2] crossing is not attributed to walk 105"
printf '%s\n' "$A11Y_LINES" | grep -F 'A11Y_DIFF {"cmd":"walk 105"' | grep -qF '"room":[62,14]' \
  || fail_guard "the walk-105 crossing diff does not carry room [62,14]"

# Guard 3: after the crossing, the engine is in a valid chapter 2 room 14 state.
#          The `dump` re-emits the full A11Y room state; it must say chapter 2
#          room 14. (A dump's own diff is changed:false; the room-state line is
#          the real evidence the engine settled in the right place.)
printf '%s\n' "$A11Y_LINES" | grep -qE 'A11Y \{"chapter":2,"room":14' \
  || fail_guard "not in chapter 2 room 14 after the over-skip crossing"

# Guard 4: no stray skip ate the follow-up look. look 202 in room 14 must settle
#          as its OWN diff, and it must carry a spoken `said` line — a leftover
#          skip bleeding into the new room would have eaten the look's speech.
LOOK_DIFF="$(printf '%s\n' "$A11Y_LINES" | grep -F 'A11Y_DIFF {"cmd":"look 202"' | tail -1)"
[ -n "$LOOK_DIFF" ] || fail_guard "look 202 produced no diff after the crossing"
printf '%s\n' "$LOOK_DIFF" | grep -qF '"said":[' \
  || fail_guard "look 202 spoke nothing — a stray skip bled into chapter 2 and ate the look line"

log "guard held: one coherent crossing diff, chapter 2 room 14 live, follow-up look still speaks"
exit 0
