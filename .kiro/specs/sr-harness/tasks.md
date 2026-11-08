# Tasks: sr-harness

Owns only `scripts/sr-*`, `tests/sr/`, one `.kiro` hook/workflow file, and one `.gitignore` line for `tests/sr/reports/`. Does NOT edit `src/` or `engine/`. Nothing is pasted from `reference/`; the Spike 10 techniques are re-implemented. The two pure modules (`sr-parse`, `sr-match`) are built and unit-tested before the VM-bound script, so the testable logic lands first. Requires a running Mac with `prlctl` and the "Ghostlight Win11" VM on snapshot 3 only for the live task (task 8), which cannot be verified in CI.

- [ ] 1. Scaffold the harness tree and the reports gitignore (R6.4, R11.1)
  - Create `tests/sr/` with `scenarios/` and `reports/` subfolders, and a placeholder `tests/sr/reports/summary.md` with a one-line header.
  - Add one `.gitignore` rule: ignore `tests/sr/reports/` but un-ignore `tests/sr/reports/summary.md`, placed near the existing report/log rules with a one-line comment. Confirm `tests/sr/scenarios/` and the sample logs are NOT ignored.
  - _Requirements: 6.4, 11.1_

- [ ] 2. Build the scenario parser `sr-parse` (pure) (R3, R10.2)
  - Write a pure TypeScript module that reads a scenario JSON path and returns a validated `Scenario` (`name`, optional `url`/`fixture`, `steps[]`) or throws a clear, located error. `Step` = `{ keys (required string), expectSpoken?: string[], expectNotSpoken?: string[], waitMs?: number, note?: string }`.
  - Errors: file not found names the scenario; invalid JSON names the file and the JSON error; a step missing `keys` names the step index; a wrong-typed field (`keys` not string, `expectSpoken`/`expectNotSpoken` not string[], `waitMs` not number) names the step and field.
  - No VM, file-mutation, or network side effects beyond reading the one file. Place under an owned path (`tests/sr/sr-parse.ts` or `scripts/sr-parse`).
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 10.2_

- [ ] 3. Build the speech-log matcher `sr-match` (pure) (R5, R10.3)
  - Write a pure `matchStep(utterances: string[], step: Step): StepVerdict` returning `{ pass, missing[], forbidden[], utterances[] }`.
  - Include the shared reducer that turns raw NVDA `Speaking [...]` lines into utterances (strip `LangChangeCommand`, `CancellableSpeech`, and the Chrome window/document focus lines), matching the spike's reduction exactly, so the live runner and the tests reduce identically.
  - Rules: case-insensitive substring compare; pass iff all `expectSpoken` present and no `expectNotSpoken` present; empty utterances is valid input (fail when speech expected, pass when only `expectNotSpoken`). No VM/file/network access.
  - _Requirements: 5.2, 5.3, 5.4, 5.5, 5.6, 10.3_

- [ ] 4. Commit two sample NVDA logs and unit-test parser + matcher (R10.1, R10.2, R10.3, R10.4)
  - Add `tests/sr/sample-pass.log` and `tests/sr/sample-fail.log`: small, real-shaped NVDA `Speaking` lines (one set satisfies a step's expectations, one is missing an expected line / contains a forbidden one). These are committed fixtures, not reports.
  - `tests/sr/sr-parse.test.ts`: valid scenario; missing `keys`; wrong type for `expectSpoken` and `waitMs`; malformed JSON — each asserting the located error.
  - `tests/sr/sr-match.test.ts`: feed the sample logs through the shared reducer and assert `expectSpoken` present→pass, absent→fail (listed in `missing`), `expectNotSpoken` present→fail (in `forbidden`), absent→pass, case-insensitive match, and empty-utterance→fail-when-expected / pass-when-only-notSpoken.
  - Add a self-contained `tests/sr/vitest.config.ts` scoped to `tests/sr/**/*.test.ts` (the root config excludes `tests/**`), and run with `npx vitest run --config tests/sr/vitest.config.ts`. Confirm they run with no VM/`prlctl`/NVDA/network.
  - _Requirements: 10.1, 10.2, 10.3, 10.4_

- [ ] 5. Re-implement the Spike 10 VM helpers as owned `scripts/sr-*` (R1.6, R8.2, R11.3)
  - Re-implement (not paste) the spike techniques under `scripts/sr-*`: `vmps` (PowerShell as logged-in user via `prlctl exec --current-user`, UTF-16LE+base64, hidden window, CLIXML filtered, chunking for the ~8 KB limit); the scan-code key presser (`keybd_event` ONLY — never `WScript.Shell.SendKeys`, which sends numpad keys NVDA reads as review commands and gives false results; extended-key flags, `nvda`→`insert`, chord `+` / sequence `,`, tail new `Speaking` lines after each chord); the page bridge over port 9222 (focused-element role, live-region text; reads only, never the input path); and the chunked `push`. Optionally the in-session screenshot for failure artifacts.
  - Depend only on spike-set tools (`prlctl`, `base64`, `iconv`, Node, staged `C:\gl` helpers). No shared folders anywhere.
  - _Requirements: 1.6, 5.7, 8.2, 11.3_

- [ ] 6. Write the orchestrator `scripts/sr-check.sh` (R1, R2, R6, R8, R9.2)
  - Args: require `<url>` (usage + non-zero exit if absent); default scenario `tavern`. Parse the scenario via `sr-parse` BEFORE any VM action; a missing/invalid scenario stops here, VM never started (R1.3, R3.4).
  - VM guard + lifecycle: confirm the "Ghostlight Win11" VM and snapshot 3 exist (else clear error + non-zero, never run against unknown state); revert to snapshot 3; start the VM; wait for the logged-in session with a bounded poll; stage helpers + scenario to `C:\gl`; start NVDA; start Chrome with `--remote-debugging-port=9222` and a FRESH empty `--user-data-dir=C:\gl\chrome-<runid>` (never the snapshot's cached profile, so the MIDI prompt starts unanswered — R2.5) plus `<url>`; when `<url>` is `http`, also pass `--unsafely-treat-insecure-origin-as-secure=<origin>` scoped to that origin so `crypto.subtle` exists and hints/saves match the HTTPS site, and omit it for `https` (R2.6); wait for the Ghostlight tab via the page bridge before step 1.
  - Run steps in file order: count NVDA log lines, press `keys` with the scan-code presser only (R5.7), wait `waitMs`, ship the new lines back, reduce + `matchStep` on the Mac. Map action tokens (`start`, `reload`, `continue`, save via `C`) to chords/page-bridge actions.
  - Teardown via `trap`: delete the fresh profile dir and revert to snapshot 3 on pass, fail, OR error (R2.5, R8.3). Never change UAC/security/policy, never enable sharing (R8.1, R8.2). Never read `.env` or emit secrets (R8.4). Exit zero only if every step passed (R1.5).
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 3.5, 5.7, 8.1, 8.2, 8.3, 8.4, 9.2_

- [ ] 7. Report writer and console output (R6)
  - Per step, print `PASS`/`FAIL` with the step note/keys, and on failure the `missing`/`forbidden` substrings and the actual utterances (R6.1).
  - Write `tests/sr/reports/<date>/report.json` (URL, scenario, ISO start time, per-step keys/note/expectations/waitMs/utterances/verdict, top-level `result`) and the raw NVDA speech; on run error record `stoppedAt` + `reason` instead of a false pass (R6.2, R6.3, R6.5).
  - Append a one-line run entry to the committed `tests/sr/reports/summary.md` (date, URL, scenario, pass/fail counts). Confirm nothing but `summary.md` under `reports/` is committed.
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

- [ ] 8. Author `tests/sr/scenarios/tavern.json` and dry-run the live harness (R3, R4)
  - Write `tavern.json`: name, `fixture`/`url` hint, and the ordered steps — `start`, `right`, `down`, `L`, `H`, `tab`, `esc`, `V`, `esc`, `S`, `N`, `G`, `shift+r`, `C` (save), `reload`, `continue` — each with `expectSpoken`/`expectNotSpoken`/`waitMs` per the design table. NO NVDA+Space step: passing depends on the page entering focus mode on its own (R4.2).
  - Assert `continue` lands on the same room name as `start` (R4.4); add a run-wide `expectNotSpoken` for the MIDI prompt text "Control and reprogram MIDI devices" (R4.5). Use the page bridge only to corroborate (R4.6).
  - Dry-run `scripts/sr-check.sh <url> tavern` against the VM on snapshot 3 (requires the live Mac + VM; not CI-verifiable). Confirm a full pass/fail report, the VM left on snapshot 3, and exit code matching the outcome. Record the run in `summary.md`.
  - _Requirements: 3.1, 3.2, 3.3, 3.5, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

- [ ] 9. Decide and document the Windows Narrator question (R7)
  - Check whether Narrator exposes any per-utterance speech capture of reliability comparable to NVDA's IO log (documented log, SAPI/TTS tap, or UIA) without adding a new tool or non-deterministic transcription.
  - If a reliable capture exists, note it as a possible future second screen reader behind the same scenarios/matcher. If not (expected per the design), write the finding and the reason in the harness README and skip Narrator; keep NVDA as the one covered screen reader.
  - _Requirements: 7.1, 7.2, 7.3, 7.4_

- [ ] 10. Create the single `sr-check` `.kiro` trigger (R9)
  - Create exactly one `.kiro` artifact named `sr-check` that runs `scripts/sr-check.sh <url> [scenario]` on demand and surfaces pass/fail. Prefer a workflow (parameterised by URL, run after a deploy); if a hook, make it a single manual-trigger button hook with a `command` action. Use `createHook` for a hook or author one `.workflow.json` for a workflow — do not hand-write a hook JSON.
  - Confirm it is on-demand only (no automatic firing on saves or unrelated events) and is the only `.kiro` file this spec owns.
  - _Requirements: 9.1, 9.2, 9.3, 9.4_

- [ ] 11. Add a harness README and verify ownership boundaries (R6.4, R7.3, R11)
  - Add `tests/sr/README.md` (or `scripts/sr-README.md` under an owned path): how to run `sr-check.sh`, the scenario JSON shape, where reports land, the gitignore rule, and the Narrator finding from task 9.
  - Verify the whole change touches only `scripts/sr-*`, `tests/sr/`, the one `.kiro` file, and the single `.gitignore` edit — nothing under `src/` or `engine/`, nothing pasted from `reference/`. Run `npx vitest run --config tests/sr/vitest.config.ts` green.
  - _Requirements: 6.4, 7.3, 11.1, 11.2, 11.3_
