#!/usr/bin/env bash
#
# fetch.sh — fetch a pinned ScummVM checkout and the Drascula freeware data
# into vendor/. vendor/ is gitignored; game data is never committed.
#
# Everything our build needs that is NOT our code lives under vendor/ and is
# reproduced by this script. Our engine code lives in engine/ and is applied by
# scripts/build-engine.sh — never edit vendor/ by hand.
#
# Usage:
#   scripts/fetch.sh            # fetch what is missing, verify checksums
#   scripts/fetch.sh --force    # re-fetch even if present
#
set -euo pipefail

# --- configuration ----------------------------------------------------------

# Pinned ScummVM commit. Same commit the prep spikes built against.
SCUMMVM_REPO="https://github.com/scummvm/scummvm.git"
SCUMMVM_COMMIT="ad351d1e"

# Drascula freeware data from ScummVM's official downloads.
# The game (drascula-1.0.zip) and the Ogg audio pack (drascula-audio-2.0.zip).
# The MP3 pack is NOT used: without libmad it triggers a blocking CD-audio dialog.
DRASCULA_BASE="https://downloads.scummvm.org/frs/extras/Drascula_%20The%20Vampire%20Strikes%20Back"
GAME_ZIP="drascula-1.0.zip"
AUDIO_ZIP="drascula-audio-2.0.zip"

# Recorded sha256 checksums. Filled in on the first successful fetch (the script
# prints the computed value and writes it here). A later run then verifies
# against these and aborts on any mismatch. Leave empty to (re)record.
GAME_SHA256="b731f6cb5a22ba8b4c3b3362f570b9a10a67b6cb0b395394b19a94b36e4e42de"
AUDIO_SHA256="7e6afba36eed13dd02e0360119e9a6a8d0e7b334ddc11d7c46ab7faceb8fe401"

# --- paths -------------------------------------------------------------------

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENDOR="$ROOT/vendor"
SCUMMVM_DIR="$VENDOR/scummvm"
GAME_DIR="$VENDOR/game/drascula"
DL_DIR="$VENDOR/downloads"

FORCE=0
[ "${1:-}" = "--force" ] && FORCE=1

mkdir -p "$VENDOR" "$DL_DIR" "$GAME_DIR"

# --- helpers -----------------------------------------------------------------

log() { printf '[fetch] %s\n' "$*"; }
die() { printf '[fetch] ERROR: %s\n' "$*" >&2; exit 1; }

sha256_of() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    sha256sum "$1" | awk '{print $1}'
  fi
}

# verify <file> <expected-sha256> <label>
# If expected is empty, record mode: print the computed sum and keep going.
verify() {
  local file="$1" expected="$2" label="$3" actual
  [ -f "$file" ] || die "$label missing after download: $file"
  actual="$(sha256_of "$file")"
  if [ -z "$expected" ]; then
    log "RECORD $label sha256: $actual"
    log "  -> paste this into ${label}_SHA256 in scripts/fetch.sh to lock it"
  elif [ "$actual" != "$expected" ]; then
    die "$label checksum mismatch
  expected $expected
  actual   $actual
  Refusing to use this file. Delete $file and re-fetch, or update the recorded sum if the upstream file legitimately changed."
  else
    log "OK $label checksum verified"
  fi
}

download() {
  local url="$1" out="$2"
  if [ -f "$out" ] && [ "$FORCE" -eq 0 ]; then
    log "cached $(basename "$out")"
    return
  fi
  log "downloading $(basename "$out")"
  curl -fSL --retry 3 -o "$out" "$url" || die "download failed: $url"
}

# --- 1. ScummVM at the pinned commit ----------------------------------------
#
# Blobless partial clone. GitHub refuses a depth-1 fetch of an arbitrary old
# commit by SHA (uploadpack.allowReachableSHA1InWant is off), so we cannot
# shallow-fetch the pinned commit directly. A full clone pulls ~1.8 GB of
# history we do not need. The middle path is a treeless/blobless clone
# (--filter=blob:none): it fetches all commits and trees but downloads file
# blobs lazily, so checking out one pinned commit pulls only that commit's
# blobs. Much smaller and faster than a full clone, and any commit is reachable.

if git -C "$SCUMMVM_DIR" rev-parse --verify -q "$SCUMMVM_COMMIT^{commit}" >/dev/null 2>&1 \
   && [ "$FORCE" -eq 0 ]; then
  git -C "$SCUMMVM_DIR" checkout -q "$SCUMMVM_COMMIT"
  log "scummvm present at $(git -C "$SCUMMVM_DIR" rev-parse --short HEAD)"
else
  if [ -d "$SCUMMVM_DIR" ]; then
    chmod -R u+w "$SCUMMVM_DIR" 2>/dev/null || true
    rm -r "$SCUMMVM_DIR" 2>/dev/null || true
  fi
  log "cloning scummvm (blobless partial clone; blobs fetched on checkout)"
  git clone -q --filter=blob:none --no-checkout "$SCUMMVM_REPO" "$SCUMMVM_DIR" \
    || die "clone failed"
  git -C "$SCUMMVM_DIR" checkout -q "$SCUMMVM_COMMIT" \
    || die "could not check out pinned commit $SCUMMVM_COMMIT"
fi
log "scummvm at $(git -C "$SCUMMVM_DIR" rev-parse --short HEAD) (pinned $SCUMMVM_COMMIT)"

# --- 2. Drascula freeware data ----------------------------------------------

GAME_OUT="$DL_DIR/$GAME_ZIP"
AUDIO_OUT="$DL_DIR/$AUDIO_ZIP"

download "$DRASCULA_BASE/$GAME_ZIP"  "$GAME_OUT"
download "$DRASCULA_BASE/$AUDIO_ZIP" "$AUDIO_OUT"

verify "$GAME_OUT"  "$GAME_SHA256"  "GAME"
verify "$AUDIO_OUT" "$AUDIO_SHA256" "AUDIO"

# --- 3. unpack into vendor/game/drascula ------------------------------------

log "unpacking game data into $GAME_DIR"
( cd "$GAME_DIR" && unzip -oq "$GAME_OUT" && unzip -oq "$AUDIO_OUT" )

log "done. scummvm: $SCUMMVM_DIR   game data: $GAME_DIR"
log "next: scripts/build-engine.sh"
