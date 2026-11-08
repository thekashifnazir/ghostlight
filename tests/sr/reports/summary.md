# sr-harness run summary

One line per `scripts/sr-check.sh` run. The full per-run JSON reports and the raw
NVDA speech logs live beside this file under `tests/sr/reports/<date>/` and are
gitignored; only this summary is committed.

| date | url | scenario | pass | fail | result |
|------|-----|----------|------|------|--------|
| 2026-11-08 | https://ghostlight.kashifnazir.com/ | tavern | 0 | 1 | error (run blocked, see note) |

## 2026-11-08 — tavern against the live Worker build: blocked by VM latency

First real end-to-end bring-up of the harness against the deployed build at
https://ghostlight.kashifnazir.com/. The harness logic worked: it validated the
scenario, reverted the VM to snapshot 3, booted NVDA and Chrome on a fresh
profile, pressed the Start step with real scan codes, and captured, reduced,
matched, and wrote a report — the full pipeline ran.

Step 0 (`start`) captured the single utterance **"Ghostlight game"** — the
`role="application"` label — which confirms the page took focus mode on its own
(the screen-reader-focus fix is live). But the onboarding line "Left and Right…"
was not in the captured window, so step 0 was marked fail and the run did not
complete the remaining steps.

The run could not be driven to completion because `prlctl exec` round-trips to
the "Ghostlight Win11" VM were pathologically slow on this host during the
attempt (tens of seconds per call under sustained load), so the chunked file
staging and the step loop stalled. This is a host/VM performance condition, not
a harness defect: the parser and matcher pass all 20 unit tests, and the
pipeline produced a correct report for the step it reached. Mitigations already
applied: per-probe timeout on the session-ready loop, and larger (2500-char)
push chunks to cut round-trips.

Still to do on a responsive VM: a clean full tavern run, and — because the
Start step read only the focus label — tune the Start step's capture (wait for
the onboarding line via the page bridge, or raise its `waitMs`) so the onboarding
assertion is reliable. The VM was left reverted to snapshot 3.
