#!/usr/bin/env bash
#
# make-gated-door-save.sh — produce a chapter-2 save that stands the hero in
# room 5 (behind the church fence) holding the spike, with the window door 136
# still locked (flag 8 = 0). A regression test LOADS it, uses the spike to open
# the window (which sets flag 8 WHILE already in the room), then walks door 136
# into room 6.
#
# Why this exists (the gated-doors bug), and why the save is taken BEFORE the
# spike is used:
#   Door 136 in chapter-2 room 5 is flag-gated: it is a passage only once
#   flag 8 is set (rooms.cpp doors[] table, { 2, 136, 8 }). The engine keeps
#   isDoor[slot] current for such a door only inside exitRoom(), via updateDoor()
#   — and ALSO at room entry (enterRoom runs the room's updater). So a save taken
#   AFTER flag 8 is set would load with isDoor[136] already 1, and even the buggy
#   build could then walk it: the bug would not reproduce. The surveyor's real
#   scenario is different: they were ALREADY in room 5 when they set flag 8 (used
#   the spike on the window), and nothing refreshed isDoor[136] afterwards. The
#   a11y layer's walkObject() decided the door path from the stale isDoor==0, so
#   `walk 136` never opened the door. To reproduce exactly that, the save pins
#   the hero in room 5 with the spike and flag 8 STILL 0; the test then sets the
#   flag in-room via `use 10 136` and walks.
#
# How the state is reached (all through the engine's own actions — no binary
# save surgery, which is impossible anyway: ScummVM save files are compressed):
#   1. LOAD the chapter-2 start save (make-ch2-save.sh, slot 9): chapter 2,
#      room 14. This avoids replaying chapter 1 (R9.2, --save-slot).
#   2. Walk the ungated door chain 14 -> 12 -> 10 -> 4 -> 2 -> 3 to the cemetery
#      (room 3). None of these doors is flag-gated, so navigation does not itself
#      depend on the fix; each step settles on its A11Y_DIFF room change.
#   3. In room 3, `take 165` picks up the spike (item 10) — room_3() in rooms.cpp
#      runs pickObject(10) for `kVerbPick && fl == 165`, with no prerequisites.
#   4. Walk door 134 into room 5 (behind the church fence).
#   5. Save in room 5 to the target slot, with flag 8 still 0 and the spike held.
#
# The produced save is NOT committed: a Drascula save embeds a graphics
# thumbnail (copyrighted game data), so it is regenerated here on demand.
#
# Usage:
#   scripts/make-gated-door-save.sh [savepath] [slot] [ch2slot]
#
#   savepath   directory for a11y-cmd.txt and saves (default /tmp/ghostlight-engine)
#   slot       save slot to write the room-5/flag-8 state to (default 8)
#   ch2slot    the chapter-2-start slot to load first (default 9)
#
# Exit status: 0 on success (prints the saved slot's file path); non-zero else.
#
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENDOR="$ROOT/vendor"
SCUMMVM="$VENDOR/scummvm/scummvm"
GAME_DIR="$VENDOR/game/drascula"
ENGINE_DATA="$VENDOR/scummvm/dists/engine-data"

SAVEPATH="${1:-/tmp/ghostlight-engine}"
SLOT="${2:-8}"
CH2SLOT="${3:-9}"

log() { printf '[make-gated-door-save] %s\n' "$*" >&2; }
die() { printf '[make-gated-door-save] ERROR: %s\n' "$*" >&2; exit 1; }

[ -x "$SCUMMVM" ] || die "native binary missing: $SCUMMVM (run scripts/build-engine.sh)"
[ -f "$GAME_DIR/Packet.001" ] || die "game data missing in $GAME_DIR (run scripts/fetch.sh)"
[ -f "$ENGINE_DATA/drascula.dat" ] || die "drascula.dat missing in $ENGINE_DATA"
case "$SLOT" in ''|*[!0-9]*) die "slot must be a whole number, got: $SLOT" ;; esac
case "$CH2SLOT" in ''|*[!0-9]*) die "ch2slot must be a whole number, got: $CH2SLOT" ;; esac

mkdir -p "$SAVEPATH"

# The chapter-2-start save we load first. Produce it on demand if absent.
CH2_FILE="$SAVEPATH/$(printf 'drascula.%03d' "$CH2SLOT")"
if [ ! -f "$CH2_FILE" ]; then
  log "chapter-2 start save (slot $CH2SLOT) missing; producing it with make-ch2-save.sh"
  "$ROOT/scripts/make-ch2-save.sh" "$SAVEPATH" "$CH2SLOT" >/dev/null \
    || die "make-ch2-save.sh failed to produce the chapter-2 start save"
  [ -f "$CH2_FILE" ] || die "chapter-2 start save still missing at $CH2_FILE"
fi

CMD="$SAVEPATH/a11y-cmd.txt"
LOG="$SAVEPATH/make-gated-door.log"
: > "$CMD"; rm -f "$LOG"

# Hard cap so a stuck run can never hang a setup step.
CAP=180
DEADLINE=$(( $(date +%s) + CAP ))

ENGINE_PID=""
cleanup() {
  [ -n "$ENGINE_PID" ] || return 0
  kill -0 "$ENGINE_PID" 2>/dev/null || return 0
  kill -9 "$ENGINE_PID" 2>/dev/null || true   # ScummVM ignores SIGTERM (gotcha 12)
  wait "$ENGINE_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# Launch loading the chapter-2 start slot (R9.2).
"$SCUMMVM" --path="$GAME_DIR" --extrapath="$ENGINE_DATA" --savepath="$SAVEPATH" \
  --subtitles --save-slot="$CH2SLOT" drascula >"$LOG" 2>&1 &
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

# Drive a door walk and wait until its diff shows the expected room change. The
# doors on this route are ungated, so each settles on its own A11Y_DIFF with a
# "room":[from,to] move; no fixed sleep is needed.
walk_to_room() {
  local door="$1" fromRoom="$2" toRoom="$3"
  log "walk $door -> room $toRoom"
  app "walk $door"
  waitfor "A11Y_CMD walk $door" || die "walk $door was never echoed"
  # A door walk settles with its own A11Y_DIFF carrying "room":[from,to]. Match
  # exactly that diff for this door so we never mistake an earlier line for the
  # move. Skips are paced only in case a transition cutscene blocks the loop.
  local marker="A11Y_DIFF {\"cmd\":\"walk $door\",\"room\":[$fromRoom,$toRoom]"
  while :; do
    grep -qF "$marker" "$LOG" 2>/dev/null && { log "reached room $toRoom"; return 0; }
    kill -0 "$ENGINE_PID" 2>/dev/null || die "engine died walking door $door"
    [ "$(date +%s)" -ge "$DEADLINE" ] && die "walk $door never reached room $toRoom within the cap"
    app skip
    sleep 0.8
  done
}

# 1) Loaded into chapter 2 room 14.
waitfor 'A11Y {"chapter":2,"room":14' || die "engine never reached chapter 2 room 14 (load slot $CH2SLOT)"
log "loaded chapter 2 room 14"

# 2) Ungated door chain 14 -> 12 -> 10 -> 4 -> 2 -> 3 -> 5.
walk_to_room 159 14 12
walk_to_room 151 12 10
walk_to_room 146 10 4
walk_to_room 126 4 2
walk_to_room 127 2 3

# 3) In the cemetery (room 3), pick up the spike (item 10). room_3() runs
#    pickObject(10) for `take 165` with no prerequisites.
log "take 165 (spike) in room 3"
app 'take 165'
waitfor 'A11Y_CMD take 165' || die "take 165 was never echoed"
while :; do
  grep -qF 'A11Y_DIFF {"cmd":"take 165"' "$LOG" 2>/dev/null && break
  kill -0 "$ENGINE_PID" 2>/dev/null || die "engine died during take 165"
  [ "$(date +%s)" -ge "$DEADLINE" ] && die "take 165 never settled within the cap"
  app skip; sleep 0.8
done
grep -qE '"invAdded":\[\{"id":10,' "$LOG" || die "spike (item 10) was not added to inventory by take 165"
log "spike picked up"

# 4) Walk door 134 into room 5.
walk_to_room 134 3 5

# 5) Confirm we are in room 5 holding the spike with flag 8 STILL 0, then save.
app dump
waitfor 'A11Y_DIFF {"cmd":"dump"' || die "dump in room 5 never settled"
DUMP_LINE="$(grep -E '^A11Y \{"chapter":2,"room":5' "$LOG" | tail -1)"
[ -n "$DUMP_LINE" ] || die "not in room 5 after walking door 134"
# The spike (item 10) must be held and flag 8 must still be 0 — the regression
# precondition. Pull both out of the room-state JSON.
PRE="$(printf '%s\n' "$DUMP_LINE" | python3 -c 'import sys,json; d=json.loads(sys.stdin.read().split(" ",1)[1]); print(d["flags"][8], 10 in d["inventory"])' 2>/dev/null)"
[ "$PRE" = "0 True" ] || die "room-5 precondition wrong (flag8/hasSpike): got '${PRE}', want '0 True'"
log "room 5 reached with spike held and flag 8 = 0"

log "saving room-5 (spike held, flag 8 = 0) state to slot $SLOT"
app "save $SLOT"
waitfor 'A11Y_SAVED' || die "save $SLOT never produced A11Y_SAVED"
sleep 1
cleanup
ENGINE_PID=""

SAVE_FILE="$SAVEPATH/$(printf 'drascula.%03d' "$SLOT")"
[ -f "$SAVE_FILE" ] || die "save file not found at $SAVE_FILE after A11Y_SAVED"

log "done: room-5 (spike held, flag 8 = 0) save written to slot $SLOT ($SAVE_FILE)"
printf '%s\n' "$SAVE_FILE"
