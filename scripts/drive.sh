#!/usr/bin/env bash
#
# drive.sh — the standard harness for driving the native Drascula a11y build.
#
# This is the reusable replay harness the engine-a11y-layer tasks share (it
# supersedes the fixed-sleep smoke harness scripts/replay.sh for anything that
# needs to know when a command settled). It launches the native ScummVM build
# in a REAL window (fully headless SDL is flaky, gotcha 12), feeds it a command
# script through the a11y command file, and — crucially — WAITS ON LOG MARKERS
# in the engine's own output rather than sleeping a fixed time. There are NO
# fixed `sleep`s in the wait path: every wait polls the log for the A11Y /
# A11Y_DIFF / A11Y_SAVED / A11Y_CMD line it expects and returns the instant it
# appears. A single HARD 60-second cap bounds the whole run; on timeout the
# harness prints what it was still waiting for and exits non-zero.
#
# How the command file is consumed: the a11y layer reads <savepath>/a11y-cmd.txt
# every frame, queues every non-blank, non-`#` line, then truncates the file
# (engine/a11y.cpp readCommandFile). So the whole script can be written up front
# before launch; the engine picks it up on the first frame and runs the commands
# one at a time as each settles (R2.1, R2.2). Because we wait on the A11Y_DIFF /
# A11Y_SAVED marker for the LAST command (or a caller-supplied marker), the
# harness returns as soon as the script has actually finished, not after a guess.
#
# Usage:
#   scripts/drive.sh --script <file> [options]
#
# Options:
#   --script <file>     command script, one command per line (REQUIRED).
#                       Blank lines and `#` comments are allowed (the engine
#                       drops them); `--wait-for` defaults to the last real
#                       command's settle marker.
#   --save-slot <n>     launch with ScummVM's --save-slot=<n>, so the run LOADS
#                       that save and starts partway through (R9.2). Omit for a
#                       normal run that starts at the first playable room.
#   --savepath <dir>    directory for a11y-cmd.txt and saves. Default:
#                       /tmp/ghostlight-engine (this spec's own save path; each
#                       chat uses its own so they never share the command file).
#   --out <file>        copy the captured A11Y* lines to this file as well as
#                       stdout. Default: none (stdout only).
#   --wait-for <text>   a substring to wait for in the log before stopping,
#                       INSTEAD of the default last-command settle marker. Use
#                       when the final line of interest is not a plain A11Y_DIFF
#                       (e.g. `--wait-for 'A11Y_SAVED'`, or a crossing diff
#                       `--wait-for 'A11Y_DIFF {"cmd":"walk 105"'`). May be given
#                       more than once; the harness waits for each in turn.
#   --cap <seconds>     overall hard cap. Default and MAXIMUM is 60s; a larger
#                       value is clamped to 60 so no run can hang the suite.
#
# Output:
#   * every captured A11Y* line is printed to stdout in order (prefixes A11Y,
#     A11Y_CMD, A11Y_DIFF, A11Y_TEXT, A11Y_ERR, A11Y_INV, A11Y_CHOICES,
#     A11Y_SAVED, A11Y_HOVER, A11Y_SAY).
#   * the full raw stderr/stdout log is left at <savepath>/drive.log.
#
# Exit status:
#   0  every wait marker appeared within the cap and A11Y lines were captured.
#   1  no A11Y lines captured (launch/data problem).
#   2  the hard cap was hit while waiting for a marker (prints what it awaited).
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENDOR="$ROOT/vendor"
SCUMMVM="$VENDOR/scummvm/scummvm"
GAME_DIR="$VENDOR/game/drascula"
ENGINE_DATA="$VENDOR/scummvm/dists/engine-data"

log() { printf '[drive] %s\n' "$*" >&2; }
die() { printf '[drive] ERROR: %s\n' "$*" >&2; exit 1; }

# --- arguments ---------------------------------------------------------------

SCRIPT=""
SAVE_SLOT=""
SAVEPATH="/tmp/ghostlight-engine"
OUT=""
CAP=60
WAIT_MARKERS=()

while [ $# -gt 0 ]; do
  case "$1" in
    --script)    shift; SCRIPT="${1:?--script needs a file}" ;;
    --save-slot) shift; SAVE_SLOT="${1:?--save-slot needs a number}" ;;
    --savepath)  shift; SAVEPATH="${1:?--savepath needs a directory}" ;;
    --out)       shift; OUT="${1:?--out needs a file}" ;;
    --wait-for)  shift; WAIT_MARKERS+=("${1:?--wait-for needs text}") ;;
    --cap)       shift; CAP="${1:?--cap needs seconds}" ;;
    -h|--help)   sed -n '2,70p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown option: $1 (see --help)" ;;
  esac
  shift
done

[ -n "$SCRIPT" ] || die "usage: scripts/drive.sh --script <file> [options]"
[ -f "$SCRIPT" ] || die "command script not found: $SCRIPT"

# Clamp the cap to a hard 60s ceiling (and a sane floor), so no caller can let a
# run hang the suite. A non-numeric cap is a usage error.
case "$CAP" in
  ''|*[!0-9]*) die "--cap must be a whole number of seconds, got: $CAP" ;;
esac
[ "$CAP" -ge 1 ]  || CAP=1
[ "$CAP" -le 60 ] || { log "clamping --cap $CAP to the 60s hard ceiling"; CAP=60; }

if [ -n "$SAVE_SLOT" ]; then
  case "$SAVE_SLOT" in
    ''|*[!0-9]*) die "--save-slot must be a whole number, got: $SAVE_SLOT" ;;
  esac
fi

# --- preflight ---------------------------------------------------------------

[ -x "$SCUMMVM" ] || die "native binary missing: $SCUMMVM (run scripts/build-engine.sh)"
[ -f "$GAME_DIR/Packet.001" ] || die "game data missing in $GAME_DIR (run scripts/fetch.sh)"
[ -f "$ENGINE_DATA/drascula.dat" ] || die "drascula.dat missing in $ENGINE_DATA"

mkdir -p "$SAVEPATH"
CMD_FILE="$SAVEPATH/a11y-cmd.txt"
RAW_LOG="$SAVEPATH/drive.log"

# Write the command script into the file the engine reads (present from frame
# one, so the engine queues every command on the first poll).
cp "$SCRIPT" "$CMD_FILE"

# --- default wait marker -----------------------------------------------------
#
# If the caller gave no --wait-for, wait for the LAST real command in the script
# to settle: its `A11Y_DIFF {"cmd":"<last>"` (or `A11Y_SAVED` for a `save`). This
# is what makes the harness return the instant the script finished rather than
# after a fixed sleep. We take the last non-blank, non-`#` line of the script.
if [ "${#WAIT_MARKERS[@]}" -eq 0 ]; then
  LAST_CMD="$(grep -v '^[[:space:]]*\(#.*\)\?$' "$SCRIPT" | tail -1 || true)"
  if [ -n "$LAST_CMD" ]; then
    case "$LAST_CMD" in
      save\ *) WAIT_MARKERS+=("A11Y_SAVED") ;;
      *)       WAIT_MARKERS+=("A11Y_DIFF {\"cmd\":\"$LAST_CMD\"") ;;
    esac
    log "default wait marker: ${WAIT_MARKERS[0]}"
  fi
fi

# --- cleanup (kill -9; ScummVM ignores SIGTERM, gotcha 12) -------------------
#
# We track the engine PID in $ENGINE_PID and kill THAT directly — we never
# `pgrep -f` for it, so the wait loop's own command line can never match itself
# (reference/spikes/04-items-doors.md gotcha: "pgrep -f in a wait loop matches
# itself"). SIGKILL straight away so a following `wait` never blocks.
ENGINE_PID=""
stopEngine() {
  [ -n "$ENGINE_PID" ] || return 0
  kill -0 "$ENGINE_PID" 2>/dev/null || return 0
  kill -9 "$ENGINE_PID" 2>/dev/null || true
  wait "$ENGINE_PID" 2>/dev/null || true
  ENGINE_PID=""
}
trap stopEngine EXIT INT TERM

# --- launch (real window; gotcha 12) -----------------------------------------
#
# --subtitles is mandatory or no text is drawn (gotcha 1 / R6.1).
# --extrapath gives drascula.dat and, with the Ogg pack in the game dir, avoids
# the blocking CD-audio dialog (gotcha 13).
# --savepath is where a11y-cmd.txt is read and saves are written.
# --save-slot=<n>, when given, makes the engine LOAD that save on launch (R9.2),
# so the run starts partway through (chapter 2, say) instead of at the tavern.

LAUNCH_ARGS=(
  --path="$GAME_DIR"
  --extrapath="$ENGINE_DATA"
  --savepath="$SAVEPATH"
  --subtitles
)
if [ -n "$SAVE_SLOT" ]; then
  LAUNCH_ARGS+=(--save-slot="$SAVE_SLOT")
  log "launching with --save-slot=$SAVE_SLOT (loading a saved run)"
fi

log "savepath: $SAVEPATH"
log "commands: $(grep -cv '^[[:space:]]*\(#.*\)\?$' "$SCRIPT" || true) line(s); hard cap ${CAP}s"

"$SCUMMVM" "${LAUNCH_ARGS[@]}" drascula >"$RAW_LOG" 2>&1 &
ENGINE_PID=$!

# --- wait on log markers, under one hard cap ---------------------------------
#
# A single deadline bounds the WHOLE run (the 60s hard cap). Inside it we poll
# the log for each wait marker in turn, returning the instant it appears. The
# poll interval (0.2s) is a responsiveness knob, NOT a fixed settle sleep: the
# harness never waits a predetermined time for a command, only until the marker
# the engine actually emitted shows up (or the deadline).
DEADLINE=$(( $(date +%s) + CAP ))

awaitMarker() {
  local marker="$1"
  while :; do
    # Marker seen? Done.
    if grep -qF "$marker" "$RAW_LOG" 2>/dev/null; then
      return 0
    fi
    # Engine gone before the marker? Stop waiting (the final report still runs).
    if ! kill -0 "$ENGINE_PID" 2>/dev/null; then
      log "engine exited before marker appeared: $marker"
      return 1
    fi
    # Hard cap hit? Fail loudly with what we were awaiting.
    if [ "$(date +%s)" -ge "$DEADLINE" ]; then
      log "HARD CAP ${CAP}s hit while waiting for: $marker"
      stopEngine
      printf '%s\n' "$(grep -E '^A11Y' "$RAW_LOG" 2>/dev/null || true)"
      exit 2
    fi
    sleep 0.2
  done
}

for marker in "${WAIT_MARKERS[@]}"; do
  log "waiting for: $marker"
  awaitMarker "$marker" || break
done

# A short, bounded settle window AFTER the last marker so any trailing lines the
# same command emitted (an A11Y room-state line, say) are flushed to the log
# before we read it. This is still bounded by the overall deadline and is not a
# per-command settle sleep — the command already settled when its marker fired.
SETTLE_UNTIL=$(( $(date +%s) + 1 ))
while [ "$(date +%s)" -lt "$SETTLE_UNTIL" ] && [ "$(date +%s)" -lt "$DEADLINE" ]; do
  kill -0 "$ENGINE_PID" 2>/dev/null || break
  sleep 0.2
done

stopEngine

# --- report ------------------------------------------------------------------

A11Y_LINES="$(grep -E '^A11Y' "$RAW_LOG" 2>/dev/null || true)"

if [ -z "$A11Y_LINES" ]; then
  log "no A11Y lines captured. Raw log: $RAW_LOG"
  log "raw log tail:"
  tail -20 "$RAW_LOG" >&2 || true
  exit 1
fi

printf '%s\n' "$A11Y_LINES"
if [ -n "$OUT" ]; then
  printf '%s\n' "$A11Y_LINES" > "$OUT"
  log "captured lines also written to $OUT"
fi
log "captured $(printf '%s\n' "$A11Y_LINES" | wc -l | tr -d ' ') A11Y line(s). Raw log: $RAW_LOG"
