#!/usr/bin/env bash
#
# sr-vm-lib.sh - shared VM primitives for the sr-harness, re-implemented for
# this spec from the Spike 10 techniques (vmps / push / peek / cdp). Not copied
# from reference/. Sourced by scripts/sr-check.sh; not run directly.
#
# Every primitive talks to the "Ghostlight Win11" Parallels VM through prlctl.
# Nothing here enables shared folders or changes any Windows security control:
# files reach the VM only by the chunked in-band copy over `prlctl exec`.
#
# Required environment (set by sr-check.sh):
#   SR_VM     the VM name or uuid ("Ghostlight Win11")
#   SR_GL     the staging dir inside the VM (default C:\gl)

: "${SR_VM:?sr-vm-lib: SR_VM must be set}"
: "${SR_GL:=C:\\gl}"

# sr_vmps 'powershell' - run a PowerShell snippet in the VM as the logged-in
# user: UTF-16LE + base64 encoded (so quoting survives), hidden window, CLIXML
# progress noise filtered out. Returns prlctl's exit code.
#
# Flaky transport (found 9 Nov): about 1 `prlctl exec` in 20 fails at the
# Parallels SDK level with exit 255 and "PrlJob_GetResult: Invalid argument"
# (or PrlJob_GetRetCode), and the PowerShell NEVER runs. The old wrapper piped
# straight into grep, so the failure was silent: a dropped push chunk or final
# decode left sr-keys.ps1 / sr-await.ps1 missing in the VM (every key step then
# "spoke nothing"), a dropped Chrome start left no tab, a dropped key press lost
# one step. So every call now carries a marker: the script's first statement
# creates %TEMP%\<tag>. On an SDK-level failure we look for the marker; absent
# means the script never started and it is safe to run it again, present means
# it ran and only the result was lost (never re-run: a key press must not be
# doubled). stdin is closed so prlctl can't swallow the caller's input.
#
# There is also a hard command-length limit: an EncodedCommand of ~3,900 chars
# or more fails every time (measured 9 Nov: 3,856 ran, 3,908 did not). That
# is refused up front with an error instead of being sent.
SR_EXEC_TRIES="${SR_EXEC_TRIES:-6}"
SR_EXEC_MAX_ENC=3700

_sr_encode() {
  printf '$ProgressPreference="SilentlyContinue"; %s' "$1" | iconv -t UTF-16LE | base64 | tr -d '\n'
}

_sr_exec_raw() {
  prlctl exec "$SR_VM" --current-user powershell -NoProfile -NonInteractive \
    -WindowStyle Hidden -EncodedCommand "$1" 2>&1 </dev/null
}

# _sr_sdk_failed <rc> <output> - true if prlctl failed before running anything.
_sr_sdk_failed() {
  [[ "$1" == 255 ]] && printf '%s' "$2" | grep -qE '^Prl[A-Za-z]+_[A-Za-z]+: '
}

# _sr_marker_state <tag> - prints "ran", "absent" or "unknown".
_sr_marker_state() {
  local tag="$1" enc out rc try
  enc=$(_sr_encode "Test-Path (Join-Path \$env:TEMP '$tag')")
  for ((try = 1; try <= SR_EXEC_TRIES; try++)); do
    out=$(_sr_exec_raw "$enc"); rc=$?
    if ! _sr_sdk_failed "$rc" "$out"; then
      case "$out" in *True*) echo ran ;; *False*) echo absent ;; *) echo unknown ;; esac
      return 0
    fi
    sleep 1
  done
  echo unknown
}

sr_vmps() {
  local script="$1" tag encoded out rc try state
  tag="sr-ran-$$-$RANDOM$RANDOM"
  encoded=$(_sr_encode "New-Item -ItemType File -Force -Path (Join-Path \$env:TEMP '$tag') | Out-Null; $script")
  if ((${#encoded} > SR_EXEC_MAX_ENC)); then
    echo "sr-vm-lib: command too long for prlctl exec (${#encoded} encoded chars, max $SR_EXEC_MAX_ENC); not sent" >&2
    return 2
  fi
  for ((try = 1; try <= SR_EXEC_TRIES; try++)); do
    out=$(_sr_exec_raw "$encoded"); rc=$?
    if ! _sr_sdk_failed "$rc" "$out"; then
      [[ -n "$out" ]] && printf '%s\n' "$out" | grep -v -e '^#< CLIXML' -e '^<Objs'
      return "$rc"
    fi
    state=$(_sr_marker_state "$tag")
    if [[ "$state" != "absent" ]]; then
      echo "sr-vm-lib: WARNING prlctl exec reported '${out%%$'\n'*}' but the command may have run (marker: $state); not re-running" >&2
      return 1
    fi
    echo "sr-vm-lib: prlctl exec failed before the command ran ('${out%%$'\n'*}'), retry $try/$SR_EXEC_TRIES" >&2
    sleep 1
  done
  echo "sr-vm-lib: ERROR prlctl exec failed $SR_EXEC_TRIES times; command not run" >&2
  return 1
}

# sr_probe 'powershell' <timeoutSeconds> - run a short PowerShell probe but give
# up after <timeoutSeconds> so a single slow `prlctl exec` (common right after a
# revert while Parallels Tools come up) can't stall a readiness loop for minutes.
# Prints the probe output; returns non-zero on timeout or failure. No coreutils
# `timeout` on stock macOS, so this backgrounds the call and kills it.
sr_probe() {
  local script="$1" secs="${2:-15}" out rc
  out="$(
    { sr_vmps "$script" & local p=$!
      ( sleep "$secs"; kill -9 "$p" 2>/dev/null ) >/dev/null 2>&1 &
      local watcher=$!
      wait "$p" 2>/dev/null; rc=$?
      kill "$watcher" 2>/dev/null
      exit $rc
    }
  )"
  rc=$?
  printf '%s' "$out"
  return $rc
}

# sr_push <local-file> <vm-name> - copy a local file into the VM at
# $SR_GL\<vm-name>, in base64 chunks (the command-length limit forbids one big
# write), then check the copy's SHA-256 against the local file and start over
# if it differs (a lost or doubled chunk). Echoes the byte count on success;
# returns non-zero if the file could not be copied intact.
sr_push() {
  local src="$1" name="$2" b64 dest i want got attempt ok
  dest="$SR_GL\\$name"
  b64=$(base64 < "$src" | tr -d '\n')
  want=$(shasum -a 256 "$src" | awk '{print toupper($1)}')
  for attempt in 1 2 3; do
    sr_vmps "Remove-Item -Force -ErrorAction SilentlyContinue '$dest'; Set-Content -NoNewline -Path '$dest.b64' -Value ''" >/dev/null || continue
    ok=1
    # 1000-char chunks keep the encoded command well under the ~3,900-char
    # prlctl exec limit (see sr_vmps) with room for the run marker.
    for ((i = 0; i < ${#b64}; i += 1000)); do
      sr_vmps "Add-Content -NoNewline -Path '$dest.b64' -Value '${b64:i:1000}'" >/dev/null || { ok=0; break; }
    done
    ((ok)) || continue
    got=$(sr_vmps "[IO.File]::WriteAllBytes('$dest',[Convert]::FromBase64String((Get-Content -Raw -Path '$dest.b64'))); Remove-Item '$dest.b64'; (Get-FileHash -Algorithm SHA256 '$dest').Hash" | tr -d '\r' | tail -n 1)
    if [[ "$got" == "$want" ]]; then
      wc -c < "$src" | tr -d ' '
      return 0
    fi
    echo "sr-vm-lib: copy of $name did not verify (attempt $attempt/3), copying again" >&2
  done
  echo "sr-vm-lib: ERROR could not copy $name into the VM intact" >&2
  return 1
}

# sr_peek 'js' - evaluate a JS expression in the Ghostlight tab over Chrome's
# remote-debugging port and print the result. Reads the page (focused element
# role, live-region text) WITHOUT touching the keyboard input path. cdp helper
# (sr-cdp.mjs) must already be staged in the VM.
sr_peek() {
  local js="$1" x
  x=$(printf '%s' "$js" | base64 | tr -d '\n')
  sr_vmps "[IO.File]::WriteAllBytes('$SR_GL\\sr-expr.js',[Convert]::FromBase64String('$x')); & 'C:\\Program Files\\nodejs\\node.exe' $SR_GL\\sr-cdp.mjs $SR_GL\\sr-expr.js"
}

# sr_keys 'chord,chord' [waitPerChord] - run the staged sr-keys.ps1 in the VM
# and return its raw, per-chord-delimited output (<<<CHORD / Speaking / >>>CHORD).
# Scan-code presser only; never SendKeys.
sr_keys() {
  local seq="$1" wait="${2:-1.5}"
  sr_vmps "& ([scriptblock]::Create((Get-Content -Raw $SR_GL\\sr-keys.ps1))) '$seq' $wait"
}

# capture_chord <chord> <waitSeconds> <rawOutFile> - press one chord (which may
# itself be a comma-sequence like "tab,esc") and write the raw NVDA `Speaking`
# lines it produced to <rawOutFile>, stripping sr-keys.ps1's <<<CHORD / >>>CHORD
# delimiters. An empty file means the chord produced no new speech.
capture_chord() {
  local chord="$1" wait_s="$2" out="$3"
  local raw rc
  raw=$(sr_keys "$chord" "$wait_s"); rc=$?
  printf '%s\n' "$raw" | grep -v -e '^<<<CHORD' -e '^>>>CHORD' | tr -d '\r' > "$out"
  return "$rc"
}

# capture_await <chord> <awaitSubstring> <capSeconds> <rawOutFile> - press the
# chord, then poll the PAGE's live region (over the bridge) until <awaitSubstring>
# appears or <capSeconds> elapses, and write the new NVDA `Speaking` lines to
# <rawOutFile>. Deterministic replacement for a fixed wait on steps whose spoken
# line lands after a variable delay (e.g. Start/onboarding). One round-trip.
capture_await() {
  local chord="$1" await="$2" cap="$3" out="$4"
  local raw rc
  raw=$(sr_vmps "& ([scriptblock]::Create((Get-Content -Raw $SR_GL\\sr-await.ps1))) '$chord' '$await' $cap"); rc=$?
  printf '%s\n' "$raw" | tr -d '\r' > "$out"
  return "$rc"
}
