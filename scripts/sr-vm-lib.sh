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
# progress noise filtered out. There is a ~8 KB command-length limit on the
# encoded command, which is why sr_push chunks file copies.
sr_vmps() {
  local script="$1" encoded
  encoded=$(printf '$ProgressPreference="SilentlyContinue"; %s' "$script" \
    | iconv -t UTF-16LE | base64)
  prlctl exec "$SR_VM" --current-user powershell -NoProfile -NonInteractive \
    -WindowStyle Hidden -EncodedCommand "$encoded" 2>&1 \
    | grep -v -e '^#< CLIXML' -e '^<Objs'
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
# write). Echoes the final byte count on success.
sr_push() {
  local src="$1" name="$2" b64 dest i
  dest="$SR_GL\\$name"
  b64=$(base64 < "$src" | tr -d '\n')
  sr_vmps "Set-Content -NoNewline -Path '$dest.b64' -Value ''" >/dev/null
  # 1200-char chunks keep (2500 stopped fitting on 9 Nov: the first chunk was silently dropped) the UTF-16LE+base64 EncodedCommand under the ~8 KB
  # prlctl-exec limit while making far fewer round-trips than tiny chunks.
  for ((i = 0; i < ${#b64}; i += 1200)); do
    sr_vmps "Add-Content -NoNewline -Path '$dest.b64' -Value '${b64:i:1200}'" >/dev/null
  done
  sr_vmps "[IO.File]::WriteAllBytes('$dest',[Convert]::FromBase64String((Get-Content -Raw -Path '$dest.b64'))); Remove-Item '$dest.b64'; (Get-Item '$dest').Length"
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
  sr_keys "$chord" "$wait_s" \
    | grep -v -e '^<<<CHORD' -e '^>>>CHORD' \
    | tr -d '\r' > "$out" || true
}

# capture_await <chord> <awaitSubstring> <capSeconds> <rawOutFile> - press the
# chord, then poll the PAGE's live region (over the bridge) until <awaitSubstring>
# appears or <capSeconds> elapses, and write the new NVDA `Speaking` lines to
# <rawOutFile>. Deterministic replacement for a fixed wait on steps whose spoken
# line lands after a variable delay (e.g. Start/onboarding). One round-trip.
capture_await() {
  local chord="$1" await="$2" cap="$3" out="$4"
  sr_vmps "& ([scriptblock]::Create((Get-Content -Raw $SR_GL\\sr-await.ps1))) '$chord' '$await' $cap" \
    | tr -d '\r' > "$out" || true
}
