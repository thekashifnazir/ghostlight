# engine-lib.sh: shared setup for the native-engine save and guard scripts
# (make-ch2-save.sh, make-gated-door-save.sh, over-skip-crossing.sh,
# ch2-exit-street.sh). Source it after setting TAG (the log prefix) and SAVEPATH.
#
# It gives each script the vendor paths, log/die/fail_guard, the binary and data
# checks, an engine launcher that tracks its own PID, the cleanup trap, app()
# to append a command and waitfor() to wait on a log marker.
#
# ScummVM ignores SIGTERM (gotcha 12), so cleanup kill -9s the tracked PID. We
# never pgrep for the engine, so a wait loop cannot match its own command line
# (reference/spikes/04-items-doors.md gotcha).
# shellcheck shell=bash

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENDOR="$ROOT/vendor"
SCUMMVM="$VENDOR/scummvm/scummvm"
GAME_DIR="$VENDOR/game/drascula"
ENGINE_DATA="$VENDOR/scummvm/dists/engine-data"

log() { printf '[%s] %s\n' "$TAG" "$*" >&2; }
die() { printf '[%s] ERROR: %s\n' "$TAG" "$*" >&2; exit 1; }
fail_guard() { printf '[%s] GUARD FAILED: %s\n' "$TAG" "$*" >&2; exit 2; }

# need_engine [die|skip]: stop when the native binary or game data is missing.
# A script that defines skip() can pass it to skip instead of failing.
need_engine() {
  local miss="${1:-die}"
  [ -x "$SCUMMVM" ] || "$miss" "native binary missing: $SCUMMVM (run scripts/build-engine.sh)"
  [ -f "$GAME_DIR/Packet.001" ] || "$miss" "game data missing in $GAME_DIR (run scripts/fetch.sh)"
  [ -f "$ENGINE_DATA/drascula.dat" ] || "$miss" "drascula.dat missing in $ENGINE_DATA"
}

# need_number NAME VALUE: die unless VALUE is a whole number.
need_number() {
  case "$2" in ''|*[!0-9]*) die "$1 must be a whole number, got: $2" ;; esac
}

ENGINE_PID=""
cleanup() {
  [ -n "$ENGINE_PID" ] || return 0
  kill -0 "$ENGINE_PID" 2>/dev/null || return 0
  kill -9 "$ENGINE_PID" 2>/dev/null || true
  wait "$ENGINE_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# start_engine [extra scummvm args...]: launch Drascula into $SAVEPATH with its
# output in $LOG, and set the overall deadline from $CAP seconds.
start_engine() {
  DEADLINE=$(( $(date +%s) + CAP ))
  "$SCUMMVM" --path="$GAME_DIR" --extrapath="$ENGINE_DATA" --savepath="$SAVEPATH" \
    --subtitles "$@" drascula >"$LOG" 2>&1 &
  ENGINE_PID=$!
}

# stop_engine: kill the engine now (the trap would do it at exit anyway).
stop_engine() {
  cleanup
  ENGINE_PID=""
}

app() { printf '%s\n' "$1" >> "$CMD"; }

# waitfor MARKER: wait for MARKER in the log, bounded by the deadline. Returns 1
# if the engine died or the deadline passed first.
POLL="${POLL:-0.3}"
waitfor() {
  local marker="$1"
  while :; do
    grep -qF "$marker" "$LOG" 2>/dev/null && return 0
    kill -0 "$ENGINE_PID" 2>/dev/null || return 1
    [ "$(date +%s)" -ge "$DEADLINE" ] && return 1
    sleep "$POLL"
  done
}

# talk52_paced: in the tavern, talk 52 (sets flag 0, unlocks door 105), pacing
# skips into the live command file during the speech so each ends one line,
# until the talk-52 diff lands.
talk52_paced() {
  log "driving talk 52 (sets flag 0)"
  app 'talk 52'
  waitfor 'A11Y_CMD talk 52' || die "talk 52 was never echoed"
  while :; do
    grep -qF 'A11Y_DIFF {"cmd":"talk 52"' "$LOG" 2>/dev/null && return 0
    kill -0 "$ENGINE_PID" 2>/dev/null || die "engine died during talk 52"
    [ "$(date +%s)" -ge "$DEADLINE" ] && die "talk 52 never settled within the cap"
    app skip
    sleep 1.2
  done
}
