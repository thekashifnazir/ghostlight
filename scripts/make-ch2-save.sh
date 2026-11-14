#!/usr/bin/env bash
#
# make-ch2-save.sh — produce a chapter-2-start save so tests can LOAD chapter 2
# instead of replaying all of chapter 1 first (engine-a11y-layer task 19, R9.2).
#
# Why this exists, and why it is NOT drive.sh:
#   * drive.sh is the deterministic test harness and has NO fixed sleeps — it
#     only ever waits on log markers. The chapter 1->2 CROSSING, by contrast,
#     is a long cutscene (animation_2_1) that is advanced one line at a time by
#     repeated `skip`s. A `skip` sitting in the command file BEFORE the cutscene
#     starts is consumed by poll() as a harmless no-op; only a `skip` written
#     WHILE the cutscene's updateEvents() loop runs ends a line. So producing
#     the crossing needs skips PACED into the live command file over time, which
#     is inherently timed. That timed feeder lives here, kept out of drive.sh.
#   * This runs ONCE (or at test setup) to generate the save. Tests then launch
#     with `--save-slot` and reach chapter 2 in ~2s, not the ~2-3 minutes the
#     crossing takes. The produced save is NOT committed: a Drascula save embeds
#     a graphics thumbnail (copyrighted game data), so it is regenerated here on
#     demand, never checked in.
#
# The crossing path mirrors the spike-04 transcript and the tavern fixture:
#   talk 52 (sets flag 0, unlocks door 105) -> walk 105 -> skip through the
#   cutscene -> arrive chapter 2 room 14 -> save <slot>. The final save is done
#   by writing a `save` into the command file and waiting for A11Y_SAVED, the
#   same marker drive.sh waits on.
#
# Usage:
#   scripts/make-ch2-save.sh [savepath] [slot]
#
#   savepath   directory for a11y-cmd.txt and saves (default /tmp/ghostlight-engine)
#   slot       save slot to write (default 9)
#
# Exit status: 0 and prints the A11Y_SAVED line on success; non-zero otherwise.
#
set -uo pipefail

SAVEPATH="${1:-/tmp/ghostlight-engine}"
SLOT="${2:-9}"

TAG=make-ch2-save
. "$(dirname "${BASH_SOURCE[0]}")/engine-lib.sh"

need_engine
need_number slot "$SLOT"

mkdir -p "$SAVEPATH"
CMD="$SAVEPATH/a11y-cmd.txt"
LOG="$SAVEPATH/make-ch2.log"
: > "$CMD"; rm -f "$LOG"

# Overall hard cap so a stuck crossing can never hang a setup step. Generous
# (the crossing legitimately takes a couple of minutes) but bounded.
CAP=240
start_engine

# 1) Engine up at the tavern (chapter 1, room 62).
waitfor 'A11Y {"chapter":1,"room":62' || die "engine never reached the tavern"

# 2) talk 52 sets flag 0 (unlocks door 105), with paced skips.
talk52_paced

# 3) The crossing: walk 105, then pace skips through animation_2_1 until the
#    walk-105 diff shows the chapter 1->2 room change.
log "driving the chapter 1->2 crossing (walk 105 + paced skips)"
app 'walk 105'
waitfor 'A11Y_CMD walk 105' || die "walk 105 was never echoed"
while :; do
  grep -qF '"chapter":[1,2]' "$LOG" 2>/dev/null && { log "crossed to chapter 2"; break; }
  kill -0 "$ENGINE_PID" 2>/dev/null || die "engine died during the crossing"
  [ "$(date +%s)" -ge "$DEADLINE" ] && die "the crossing never completed within the cap"
  app skip
  sleep 1.2
done

# 4) Confirm chapter 2 room 14 is live, then save to the slot.
app dump
waitfor 'A11Y_DIFF {"cmd":"dump"' || die "dump after crossing never settled"
grep -qE 'A11Y \{"chapter":2' "$LOG" || die "not in chapter 2 after the crossing"

log "saving chapter-2 start to slot $SLOT"
app "save $SLOT"
waitfor 'A11Y_SAVED' || die "save $SLOT never produced A11Y_SAVED"

# Give the save a moment to flush, then report the saved line and stop.
sleep 1
stop_engine

SAVED_LINE="$(grep -E '^A11Y_SAVED' "$LOG" | tail -1)"
log "done: $SAVED_LINE"
printf '%s\n' "$SAVED_LINE"
