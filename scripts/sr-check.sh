#!/usr/bin/env bash
#
# sr-check.sh - one command that checks Ghostlight with a REAL screen reader.
#
# Reverts the "Ghostlight Win11" Parallels VM to the known snapshot, starts NVDA
# and Chrome on the given URL, runs a scenario of real key presses, reads back
# what NVDA actually spoke, and reports pass/fail per step. Writes a JSON report
# and the raw NVDA speech under tests/sr/reports/<date>/, prints one line per
# step, and leaves the VM reverted to the snapshot. Exits 0 only if every step
# passed.
#
#   scripts/sr-check.sh <url> [scenario]
#
# <url>       the build to check (https://... the hosted site, or http://... a
#             local build served to the VM, e.g. http://10.211.55.2:8000/).
# [scenario]  a scenario name under tests/sr/scenarios/ (default: tavern).
#
# Safety (never negotiable):
#   * Reverts to the snapshot before the run and again on EVERY exit path.
#   * Starts Chrome with a FRESH empty profile deleted afterwards, so the
#     snapshot's cached MIDI-permission answer can't make the no-MIDI check lie.
#   * Adds --unsafely-treat-insecure-origin-as-secure ONLY for http URLs, so
#     crypto.subtle exists and hints/saves match the https site.
#   * Presses keys with scan codes only (sr-keys.ps1), never WScript SendKeys.
#   * Never changes UAC / security policy, never enables shared folders, never
#     reads .env or prints a secret.
#
# Requires: a Mac with prlctl and the "Ghostlight Win11" VM on the snapshot,
# plus Node (for the vite-node TS helpers). This cannot run in CI.

set -u -o pipefail

# ---- configuration ---------------------------------------------------------
REPO="$(cd "$(dirname "$0")/.." && pwd)"
export SR_VM="${SR_VM:-Ghostlight Win11}"
export SR_GL="${SR_GL:-C:\\gl}"
if [ "${SR_BROWSER:-chrome}" = edge ]; then SR_SNAPSHOT="${SR_SNAPSHOT:-5 edge ready}"; else SR_SNAPSHOT="${SR_SNAPSHOT:-4 activated}"; fi
SR_PORT="${SR_PORT:-9222}"
# Browser under test: chrome (default) or edge. Edge needs snapshot "5 edge ready"
# (Edge first-run, sign-in, restore and update prompts turned off by policy).
SR_BROWSER="${SR_BROWSER:-chrome}"
case "$SR_BROWSER" in
  chrome) SR_BROWSER_EXE='C:\Program Files\Google\Chrome\Application\chrome.exe' ;;
  edge)   SR_BROWSER_EXE='C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe' ;;
  *) echo "sr-check: SR_BROWSER must be chrome or edge" >&2; exit 2 ;;
esac
DEFAULT_WAIT_MS="${SR_DEFAULT_WAIT_MS:-1500}"

# ---- arguments (Requirement 1.1, 1.2, 1.4) --------------------------------
URL="${1:-}"
SCENARIO_NAME="${2:-tavern}"
if [[ -z "$URL" ]]; then
  echo "usage: scripts/sr-check.sh <url> [scenario]" >&2
  exit 2
fi
SCENARIO_FILE="$REPO/tests/sr/scenarios/$SCENARIO_NAME.json"

run_ts() { npx --prefix "$REPO" vite-node "$1" -- "${@:2}"; }

# ---- parse the scenario FIRST, before any VM action (R1.3, R3.4) -----------
if [[ ! -f "$SCENARIO_FILE" ]]; then
  echo "sr-check: no scenario '$SCENARIO_NAME' at $SCENARIO_FILE" >&2
  exit 2
fi
echo "sr-check: validating scenario $SCENARIO_NAME..."
if ! run_ts "$REPO/tests/sr/sr-parse-cli.ts" "$SCENARIO_FILE"; then
  echo "sr-check: scenario invalid; VM not started." >&2
  exit 2
fi

# ---- run bookkeeping -------------------------------------------------------
DATE="$(date +%Y-%m-%d)"
RUNID="$(date +%Y%m%d-%H%M%S)"
REPORT_DIR="$REPO/tests/sr/reports/$DATE"
CAPTURE_DIR="$(mktemp -d)"
VM_PROFILE="$SR_GL\\chrome-$RUNID"      # fresh, per-run Chrome profile (R2.5)
STOP_REASON=""
STEP_CALL_FAILS=""   # steps whose VM call failed even after sr_vmps's retries

# origin for the insecure-origin flag (scheme://host[:port]) (R2.6)
URL_SCHEME="${URL%%://*}"
URL_ORIGIN="$(printf '%s' "$URL" | sed -E 's#^([a-zA-Z]+://[^/]+).*#\1#')"

# ---- teardown: revert to snapshot on ANY exit (R2.5, R8.3) -----------------
teardown() {
  local code=$?
  echo "sr-check: teardown - deleting run profile and reverting VM to snapshot..."
  # Best-effort delete of the fresh Chrome profile (the revert also discards it).
  sr_vmps "Remove-Item -Recurse -Force '$VM_PROFILE' -ErrorAction SilentlyContinue" >/dev/null 2>&1 || true
  # Resolve the snapshot id if the guard had not yet (e.g. an early failure).
  local snap_id="${SR_SNAP_ID:-}"
  if [[ -z "$snap_id" ]]; then
    snap_id="$(prlctl snapshot-list "$SR_VM" -j 2>/dev/null \
      | python3 -c "import sys,json; d=json.load(sys.stdin); print(next((k for k,v in d.items() if v.get('name')=='$SR_SNAPSHOT'),''))" 2>/dev/null)"
  fi
  if [[ -n "$snap_id" ]]; then
    prlctl snapshot-switch "$SR_VM" --id "$snap_id" >/dev/null 2>&1 \
      || echo "sr-check: WARNING could not revert VM to '$SR_SNAPSHOT'" >&2
  else
    echo "sr-check: WARNING snapshot '$SR_SNAPSHOT' id not resolved; VM left as-is" >&2
  fi
  exit "$code"
}

# shellcheck source=scripts/sr-vm-lib.sh
source "$REPO/scripts/sr-vm-lib.sh"
trap teardown EXIT

# ---- VM guard (R2.2, never run against unknown state) ----------------------
echo "sr-check: checking VM '$SR_VM' and snapshot '$SR_SNAPSHOT'..."
if ! prlctl list --all --output name | grep -qF "$SR_VM"; then
  echo "sr-check: VM '$SR_VM' not found." >&2
  STOP_REASON="vm-not-found"; exit 3
fi
# Snapshot names only appear in the JSON output (the plain list shows ids), and
# `snapshot-switch` reverts by id, not name - so resolve the name to its id once.
SR_SNAP_ID="$(prlctl snapshot-list "$SR_VM" -j 2>/dev/null \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(next((k for k,v in d.items() if v.get('name')=='$SR_SNAPSHOT'),''))" 2>/dev/null)"
if [[ -z "$SR_SNAP_ID" ]]; then
  echo "sr-check: snapshot '$SR_SNAPSHOT' not found on '$SR_VM'." >&2
  STOP_REASON="snapshot-not-found"; exit 3
fi

# ---- revert, boot, wait for the logged-in session (R2.1, R2.3) -------------
echo "sr-check: reverting to snapshot '$SR_SNAPSHOT'..."
prlctl snapshot-switch "$SR_VM" --id "$SR_SNAP_ID"
prlctl start "$SR_VM" >/dev/null 2>&1 || true
echo "sr-check: waiting for the user session..."
ready=""
for i in $(seq 1 30); do
  # Each probe is hard-bounded so one slow prlctl exec can't stall the loop.
  if sr_probe "'ok'" 15 2>/dev/null | grep -q "ok"; then ready="1"; break; fi
  echo "sr-check:   session not ready yet (probe $i)..."
  sleep 4
done
if [[ -z "$ready" ]]; then
  echo "sr-check: VM user session did not become ready." >&2
  STOP_REASON="session-not-ready"; exit 3
fi

# ---- stage helpers + scenario into the VM (R1.6, R8.2, no shared folders) --
echo "sr-check: staging helpers into the VM..."
# Each copy is hash-checked; a helper missing in the VM made every key step
# "speak nothing" on 9 Nov, so a failed copy now stops the run instead.
for helper in sr-keys.ps1 sr-await.ps1 sr-cdp.mjs; do
  if ! sr_push "$REPO/scripts/$helper" "$helper" >/dev/null; then
    echo "sr-check: could not copy $helper into the VM." >&2
    STOP_REASON="stage-failed"; exit 3
  fi
done

# ---- start NVDA, then Chrome with a FRESH profile (R2.4, R2.5, R2.6) -------
echo "sr-check: starting NVDA..."
# The snapshot already has NVDA running, so this start REPLACES it, and the new
# instance rotates nvda.log. Wait inside the VM until nvda.log is a NEW file
# (its first line, which carries NVDA's start time, has changed) that says
# "NVDA initialized", instead of sleeping 6 s and assuming. (File creation time
# can't be used: NTFS tunnels it from the rotated file.)
nvda_state="$(sr_vmps "\$log = Join-Path \$env:TEMP 'nvda.log'; \$old = if (Test-Path \$log) { Get-Content \$log -TotalCount 1 } else { '' }; Start-Process 'C:\\Program Files\\NVDA\\nvda.exe'; for (\$i = 0; \$i -lt 60; \$i++) { Start-Sleep -Milliseconds 500; if (-not (Test-Path \$log)) { continue }; \$c = @(Get-Content \$log -ErrorAction SilentlyContinue); if (\$c.Count -gt 0 -and \$c[0] -ne \$old -and (\$c -match 'NVDA initialized')) { 'nvda-up'; break } }")"
if ! grep -q "nvda-up" <<<"$nvda_state"; then
  echo "sr-check: NVDA did not (re)start in the VM: $nvda_state" >&2
  STOP_REASON="nvda-not-started"; exit 3
fi
sleep 3   # let the new NVDA finish loading its add-ons and settle

CHROME_ARGS="--remote-debugging-port=$SR_PORT --user-data-dir=$VM_PROFILE --no-first-run --no-default-browser-check"
if [[ "$URL_SCHEME" == "http" ]]; then
  echo "sr-check: http URL - enabling secure context for origin $URL_ORIGIN"
  CHROME_ARGS="$CHROME_ARGS --unsafely-treat-insecure-origin-as-secure=$URL_ORIGIN"
fi
echo "sr-check: starting $SR_BROWSER on $URL..."
sr_vmps "Start-Process '$SR_BROWSER_EXE' -ArgumentList '$CHROME_ARGS','$URL'" >/dev/null

# Wait for the Ghostlight tab to be loaded AND showing its start gate. The old
# check grepped for "complete", which also matched Node's own error text when
# Chrome wasn't up yet ("ECONNREFUSED ... [as oncomplete]"), so a run could
# press Start before Chrome existed. Now it must read exactly true.
echo "sr-check: waiting for the Ghostlight tab..."
tab_ready=""
for _ in $(seq 1 40); do
  if sr_peek "document.readyState === 'complete' && !!window.__ghostlight && window.__ghostlight.phase === 'gate'" 2>/dev/null \
      | tr -d '\r' | grep -qx "true"; then tab_ready="1"; break; fi
  sleep 2
done
if [[ -z "$tab_ready" ]]; then
  echo "sr-check: Ghostlight tab did not load." >&2
  STOP_REASON="tab-not-loaded"; exit 3
fi

# ---- run the steps in file order (R3.5, R5.1, R5.7) ------------------------
echo "sr-check: running scenario '$SCENARIO_NAME'..."
# Steps are read on fd 3, not stdin: prlctl exec inside the loop can read stdin
# and swallow the remaining steps (seen 9 Nov: the run stopped after step 0).
while IFS=$'\t' read -r -u 3 idx waitMs keys waitForSpoken; do
  [[ -z "$idx" ]] && continue
  wait_s=$(awk "BEGIN { printf \"%.2f\", $waitMs/1000 }")
  raw="$CAPTURE_DIR/step-$idx.raw"
  # Action tokens Start/Continue are reached by Enter on the focused gate button.
  chord="$keys"; [[ "$keys" == "start" || "$keys" == "continue" ]] && chord="enter"
  if [[ -n "$waitForSpoken" ]]; then
    echo "sr-check:   step $idx - $keys (await \"$waitForSpoken\", cap ${wait_s}s)"
  else
    echo "sr-check:   step $idx - $keys (wait ${wait_s}s)"
  fi
  case "$keys" in
    reload)
      # Page-level action over the bridge; capture any speech the reload makes.
      sr_vmps "& 'C:\\Program Files\\nodejs\\node.exe' $SR_GL\\sr-cdp.mjs --reload" >/dev/null 2>&1 || true
      sleep "$wait_s"
      : > "$raw"
      ;;
    *)
      if [[ -n "$waitForSpoken" ]]; then
        # Deterministic: press, then poll the live region for the awaited line
        # (waitMs is the cap), then capture. Used by Start for the onboarding line.
        capture_await "$chord" "$waitForSpoken" "$wait_s" "$raw" \
          || { echo "sr-check:   WARNING step $idx: the VM call failed; its capture can't be trusted" >&2; STEP_CALL_FAILS="$STEP_CALL_FAILS $idx"; }
      else
        capture_chord "$chord" "$wait_s" "$raw" \
          || { echo "sr-check:   WARNING step $idx: the VM call failed; its capture can't be trusted" >&2; STEP_CALL_FAILS="$STEP_CALL_FAILS $idx"; }
      fi
      ;;
  esac
done 3< <(run_ts "$REPO/tests/sr/sr-steps-cli.ts" "$SCENARIO_FILE" "$DEFAULT_WAIT_MS")

# ---- report (R6) -----------------------------------------------------------
echo "sr-check: building report..."
report_args=("$SCENARIO_FILE" "$CAPTURE_DIR" "$REPORT_DIR" "$URL")
[[ -n "$STOP_REASON" ]] && report_args+=("--stopped" "$STOP_REASON")
run_ts "$REPO/tests/sr/sr-report-cli.ts" "${report_args[@]}"
rc=$?
# A step whose key press never reached the VM can still "pass" when it expects
# no speech, so a failed VM call makes the whole run fail, loudly.
if [[ -n "$STEP_CALL_FAILS" ]]; then
  echo "sr-check: VM call failed on step(s)$STEP_CALL_FAILS; treating the run as FAILED." >&2
  [[ $rc -eq 0 ]] && rc=1
fi
exit $rc
