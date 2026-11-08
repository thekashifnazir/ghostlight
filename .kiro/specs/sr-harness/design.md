# Design: sr-harness

## Overview

`sr-harness` is a thin orchestration layer over the Spike 10 scripts, plus two small pure modules (a scenario parser and a speech-log matcher) that are unit-tested, plus one report writer and one `.kiro` trigger. Nothing here touches `src/` or `engine/`. The harness runs a scenario of key presses against a deployed Ghostlight URL inside the "Ghostlight Win11" Parallels VM, reads back what NVDA actually spoke from its IO-level log, and judges each step against substrings declared in the scenario.

The spike already proved every hard part works today: reverting is `prlctl`, running PowerShell as the logged-in user is `vmps.sh`, real scan-code key presses that NVDA sees are `keys.ps1`, reading the page over the debugging port is `cdp.mjs`/`peek.sh`, and copying files into the VM in chunks is `push.sh`. The design's job is to wrap these into one command with a clean pass/fail contract, move the per-step expectations out of PowerShell into JSON data, and make the matching logic testable off-VM.

```
scripts/sr-check.sh <url> [scenario]
        │
        ├─ sr-parse  (pure)      tests/sr/scenarios/<scenario>.json → validated Scenario
        │                        (unit-tested, no VM)
        │
        ├─ VM lifecycle (prlctl)  revert → snapshot 3, boot VM, start NVDA + Chrome on <url>
        │   (ported spike technique: vmps / keys / peek / push staged on C:\gl)
        │
        ├─ per step:  press keys in VM  ──▶  capture new NVDA `Speaking` lines
        │                                     │
        │                                     ▼
        │              sr-match  (pure)   utterances + step expectations → verdict
        │                                 (unit-tested on recorded logs, no VM)
        │
        ├─ report writer          tests/sr/reports/<date>/report.json + raw nvda speech
        │                         + committed summary.md line
        │
        └─ exit 0 all-pass / non-zero on any fail or run error ; VM left on snapshot 3
```

## Why this shape

- **Scenarios as data, matcher as a pure function.** The spike baked the expectations into `keys.ps1` output that a human read. Moving them into JSON steps and a separate matcher is what lets Requirement 10 unit-test the logic on recorded logs without the VM — the slow, flaky, VM-bound part (pressing keys, capturing speech) is cleanly separated from the fast, deterministic part (does this utterance set satisfy these expectations).
- **Revert first, always leave on snapshot 3.** A screen-reader run leaves NVDA config, Chrome profile and page state dirty. Reverting to snapshot 3 before every run (R2.1) and restoring it after (R8.3) makes a result mean "this build", and makes running the check idempotent and safe to repeat. This is the one piece of VM state the harness is strict about.
- **NVDA's IO log is the single source of truth.** Spike finding: with `loggingLevel = IO`, every utterance is a `Speaking [...]` line in `%TEMP%\nvda.log`. The harness reads only the *new* lines produced after a step's key presses (count-before / tail-after, exactly as `keys.ps1` does) so each step is judged on its own speech, not the whole session's.
- **Keys are real scan codes, reads go over the debugging port.** Pressing keys with `keybd_event` (not `SendKeys`) is why NVDA treats them as genuine typed keys — the spike found `SendKeys` toggles Num Lock and sends numpad review-cursor keys, giving false results. The harness therefore uses the scan-code presser exclusively and never `WScript.Shell.SendKeys` (R5.7). Page reads use Chrome's remote-debugging port, a separate channel that never touches the input path, so corroborating the focused element or live region can't perturb the thing under test.
- **Fresh Chrome profile per run, and a secure context for http.** The snapshot's own Chrome profile has already answered the MIDI permission prompt once, so reusing it would make the no-MIDI check (R4.5) always pass regardless of the build. Each run gets a brand-new empty `--user-data-dir` (created under a run temp path, deleted on teardown) so the MIDI decision starts unanswered (R2.5). And when the URL is `http` — a local build served to the VM at `10.211.55.2` rather than the HTTPS site — Chrome needs `--unsafely-treat-insecure-origin-as-secure=<origin>`, because without a secure context `window.crypto.subtle` is undefined and the hint and save paths behave differently from production (R2.6). The flag is added only for `http` origins and scoped to the exact origin.

## Components

### 1. `scripts/sr-check.sh` — the one command (R1, R2, R4, R6, R8, R9)

The orchestrator. Bash, in the same style as the spike scripts. Sequence:

1. **Argument check (R1.1, R1.4).** Require `<url>`; default scenario to `tavern`. No URL → usage + non-zero exit.
2. **Parse the scenario first (R1.3, R3.4).** Call the scenario parser (component 3) *before* touching the VM. A missing file or invalid scenario stops here with a clear error and the VM is never started — fast failure, no cost.
3. **Guard the VM (R2.2, R8).** Confirm the target is the "Ghostlight Win11" VM and that snapshot 3 exists (`prlctl snapshot-list`). If not, stop with a clear error. Never change security settings; never enable shared folders.
4. **Revert and boot (R2.1, R2.3).** `prlctl snapshot <vm> --id <snap3>` to revert, `prlctl start`, then wait for the logged-in user session (poll with a bounded number of `vmps.sh` probes, not an unbounded loop).
5. **Stage helpers (R1.6).** Ensure the harness's own helper files are on `C:\gl` using the chunked `push` technique. The scenario JSON is pushed too, or the expectations are kept Mac-side and only the keys are sent to the VM (see "Where the matcher runs").
6. **Start NVDA + Chrome (R2.4, R2.5, R2.6).** Launch NVDA. Create a fresh empty profile dir for this run (e.g. `C:\gl\chrome-<runid>`) — never the snapshot's cached profile, so the MIDI permission starts unanswered. Launch Chrome with `--remote-debugging-port=9222 --user-data-dir=C:\gl\chrome-<runid>` and, when `<url>` is `http`, `--unsafely-treat-insecure-origin-as-secure=<origin>` scoped to that origin (so `crypto.subtle` exists and hints/saves match the HTTPS site); omit the flag for `https`. Wait (via the page bridge) until the Ghostlight tab's document is ready before the first step. The fresh profile dir is deleted during teardown (the whole VM reverts to snapshot 3 anyway, but the dir is removed explicitly so a run that errors before revert leaves nothing behind).
7. **Run steps (R3.5, R5.1).** For each step in file order: record the NVDA log line count, press the step's `keys` with the spike's scan-code presser, wait `waitMs`, read the new `Speaking` lines, reduce them to utterances, and hand utterances + expectations to the matcher. Special steps (reload, Continue) are expressed in the scenario as keys/actions the runner understands (see "The tavern scenario").
8. **Report (R6).** Print one pass/fail line per step; write the JSON report and raw speech under `tests/sr/reports/<date>/`; append/update the committed summary line.
9. **Teardown (R8.3).** Whether pass, fail, or error (bash `trap`), revert the VM to snapshot 3 so it is left as found. Exit zero only if every step passed.

The URL is treated as non-secret; nothing reads `.env`, and the report writer never emits secrets (R8.4).

### 2. Ported spike helpers under `scripts/sr-*` (R1.6, R11.3)

The spike techniques are re-implemented as the harness's own `scripts/sr-*` files (not pasted from `reference/`, per R11.3 and the structure steering) — or invoked as small sr-prefixed wrappers that stage the same operations. The techniques carried over verbatim in behaviour:

- **`vmps`** — run a PowerShell snippet as the logged-in user via `prlctl exec --current-user`, UTF-16LE + base64 encoded, hidden window, CLIXML noise filtered. ~8 KB command-length limit, so large payloads chunk.
- **key presser** — `keybd_event` with mapped scan codes **only** (never `WScript.Shell.SendKeys`, R5.7), extended-key flags for arrows/insert, `nvda`→`insert` alias, chord split on `+`, sequence split on `,`; after each chord, tail the new `Speaking` lines and reduce them (strip `LangChange`/`CancellableSpeech`, drop the Chrome window/document focus utterances). This is the capture half of the matcher's input.
- **page bridge** — `cdp.mjs` over port 9222 to evaluate JS in the Ghostlight tab (focused element role, live-region text) for corroboration only (R4.6).
- **chunked push** — copy a file into `C:\gl` in base64 chunks because `prlctl exec` has a command-length limit.
- **shot** (optional) — in-session screenshot for a failure artifact; `prlctl capture` returns black while NVDA is active, so the in-session DIB capture is the one that works.

### 3. `sr-parse` — scenario parser (pure, R3, R10.2)

A pure module (TypeScript, run by the repo's existing test runner and callable from the harness) that reads a scenario JSON file and returns a validated `Scenario`, or throws a clear, located error.

```ts
interface Scenario {
  name: string;                 // human-readable
  url?: string;                 // optional per-scenario URL/fixture hint
  fixture?: string;             // optional replay fixture (e.g. "tavern")
  steps: Step[];
}
interface Step {
  keys: string;                 // required: "right" | "tab,esc" | "shift+r" | action token
  expectSpoken?: string[];      // substrings that must appear
  expectNotSpoken?: string[];   // substrings that must not appear
  waitForSpoken?: string;       // poll the page's live region for this before capturing
  waitMs?: number;              // fixed settle time, or the poll cap when waitForSpoken is set
  note?: string;                // optional human label for the report
}
```

`waitForSpoken` makes a step deterministic when its spoken line lands after a
variable delay. The Start step is the motivating case: onboarding ("Left and
Right…") is appended to the first room reading, which arrives when the engine is
ready, not at a fixed time, so a fixed `waitMs` races it. With `waitForSpoken`
set, the runner presses the keys, then polls the live region over the page
bridge until that substring appears (bounded by `waitMs` as a cap), then
captures NVDA's speech — rather than sleeping a guessed duration. It runs in one
VM round-trip via the staged `sr-await.ps1` (press + poll + capture), which
matters given per-call VM latency. Steps without `waitForSpoken` keep the fixed
`waitMs` settle. The tavern Start and Continue steps use it.

Validation rules (each maps to an R3.4 error): file not found → name the scenario; not valid JSON → name the file + JSON error; a step missing `keys` → name the step index; a field of the wrong type (`keys` not a string, `expectSpoken` not a string array, `waitMs` not a number) → name the step and field. The parser does not start the VM and has no side effects, so it is unit-tested directly (R10.2, R10.4).

### 4. `sr-match` — speech-log matcher (pure, R5, R10.3)

A pure function:

```ts
interface StepVerdict {
  pass: boolean;
  missing: string[];      // expectSpoken substrings not found
  forbidden: string[];    // expectNotSpoken substrings that were found
  utterances: string[];   // the reduced lines this step saw
}
function matchStep(utterances: string[], step: Step): StepVerdict;
```

Rules (R5.2–R5.6):
- Comparison is case-insensitive (R5.4). The matcher assumes utterances are already reduced (wrapper noise and Chrome focus lines stripped) — it defines and shares that same reducer so the unit tests feed it raw recorded `Speaking` lines and get the same reduction the live runner produces.
- `pass` is true iff every `expectSpoken` substring is present AND no `expectNotSpoken` substring is present.
- Empty utterances (a step produced no new speech within `waitMs`) is a valid, non-throwing input; a step that expected something spoken fails (R5.6) and a step with only `expectNotSpoken` on empty speech passes.
- No VM, file, or network access — it takes already-captured utterances. This is what makes R10.3 possible: the same function the live runner calls is exercised on the two committed sample logs.

**Where the matcher runs.** The matcher is Mac-side TypeScript. The VM's only job is to press keys and return the new NVDA log lines (the capture, in PowerShell). The runner ships those lines back over `vmps` stdout, reduces and matches them on the Mac. This keeps all judgement logic in one testable place and keeps the VM side as dumb as the spike's `keys.ps1`.

### 5. Report writer (R6)

Writes to `tests/sr/reports/<date>/` where `<date>` is a run stamp (date, or date-time if more than one run per day):
- `report.json` — target URL, scenario name, ISO start time, and a `steps[]` array of `{ keys, note, expectSpoken, expectNotSpoken, waitMs, utterances, verdict }` (R6.3), plus a top-level `result` and, on a run error, `stoppedAt` and `reason` (R6.5).
- `nvda-<step>.log` or one `speech.log` — the raw NVDA speech captured, for forensics.
- Console: one line per step, `PASS`/`FAIL`, step note/keys, and on failure the missing/forbidden substrings and the actual utterances (R6.1).

`.gitignore` gets `tests/sr/reports/` ignored **except** a committed `tests/sr/reports/summary.md` (R6.4) that the writer appends a one-line-per-run entry to (date, build/URL, scenario, pass/fail count). The raw logs and full JSON stay local.

### 6. The `tavern` scenario (`tests/sr/scenarios/tavern.json`) (R4)

Mirrors the spike's working walk of room 62, but as data, and asserting the *fixed* behaviour (focus mode on its own, no MIDI prompt), so it is both a smoke test and a regression guard for `screen-reader-focus`:

| step `keys` | asserts (`expectSpoken`) | `expectNotSpoken` |
|---|---|---|
| `start` (action token: dismiss start gate) | first room reading / room name | — |
| `right` | next hotspot name (focus mode working, not NVDA review cursor) | NVDA review-cursor artifacts |
| `down` | next hotspot | — |
| `L` | room description read | "no next list" |
| `H` | a hint line | — |
| `tab` | inventory menu name + count | the focused item name (double-speak guard) |
| `esc` | focus back; no document title re-read | the game's DOS title |
| `V` | verb menu opened | — |
| `esc` | focus back | — |
| `S` | sonar summary line | — |
| `N` | next sonar thing | — |
| `G` | ghost toggle line | — |
| `shift+r` | last line repeated | — |
| `C` (action: save) | save confirmation | — |
| `reload` (action: reload page, wait for boot) | — | — |
| `continue` (action: Continue) | the same room name as the Start step | — |

Global `expectNotSpoken` across the run (R4.5): the MIDI prompt text "Control and reprogram MIDI devices". Action tokens (`start`, `reload`, `continue`, save via `C`) are keys/operations the runner maps to a chord or a page-bridge action; `reload` reloads the tab over the debugging port and waits for boot. R4.2 is honoured by *not* including an NVDA+Space step — the scenario's passing depends on the page entering focus mode on its own, which is exactly the `screen-reader-focus` behaviour under test.

### 7. `sr-check` `.kiro` trigger (R9)

One `.kiro` file only (R9.4). Choice: a **workflow** `sr-check` over a hook, because the harness is an on-demand, parameterised (URL) action a maintainer runs after a deploy, not an event reaction — and it must *not* fire on unrelated events like file saves (R9.3). The workflow wraps `scripts/sr-check.sh <url> [scenario]` and surfaces the pass/fail outcome. If a hook is preferred instead, it is a single manual-trigger (button) hook with a `command` action running the same script; either way it is the one `.kiro` artifact this spec owns, and it is on-demand. The tasks phase picks one and creates it with the proper tool (`createHook` for a hook; a `.workflow.json` for a workflow).

## Windows Narrator (R7)

Finding to confirm in the tasks phase and then written down in the harness README:

- NVDA at IO logging level writes every utterance to `%TEMP%\nvda.log` as a `Speaking [...]` line. That textual, per-utterance log is the whole reason the matcher can be exact and deterministic.
- **Narrator has no equivalent speech log.** It has no documented per-utterance text log comparable to NVDA's IO log. Capturing Narrator speech reliably would mean one of: tapping the SAPI/text-to-speech layer (brittle, version-dependent), capturing audio and transcribing it (adds a speech-to-text dependency and non-determinism — forbidden by R1.6's "no new tools" spirit and unreliable for pass/fail), or UI Automation scraping of what Narrator *would* read (which tests the DOM, not Narrator's actual output, so it doesn't prove the Narrator path).
- **Decision:** unless the tasks-phase check turns up a log of comparable reliability, record in the README that Narrator cannot be captured the way NVDA is, and skip it (R7.3). NVDA stays the covered screen reader (R7.4). The scenario/matcher design is screen-reader-agnostic, so if a reliable Narrator capture is ever found it can be added behind the same scenarios and matcher (R7.2) without reshaping the harness.

## Unit tests (R10)

- Two committed sample NVDA speech logs under `tests/sr/` (small, a handful of `Speaking` lines each): `sample-pass.log` (contains the lines a passing step expects) and `sample-fail.log` (missing an expected line / containing a forbidden one). These are test fixtures, not run reports, so they are committed (R10.1) — distinct from the gitignored `tests/sr/reports/`.
- Parser tests (R10.2): valid scenario parses; missing `keys` → located error; wrong type for `expectSpoken`/`waitMs` → located error; malformed JSON → file-named error.
- Matcher tests (R10.3), driven by the sample logs reduced through the shared reducer: `expectSpoken` present → pass; absent → fail with it listed in `missing`; `expectNotSpoken` present → fail with it in `forbidden`; absent → pass; case-insensitive match; empty-utterance step → fail when speech expected, pass when only `expectNotSpoken`.
- All run in Vitest, no VM/`prlctl`/NVDA/network (R10.4). The root `vitest.config.ts` deliberately excludes `tests/**` (that tree is the engine harness, owned by another chat), so this spec ships its own self-contained `tests/sr/vitest.config.ts` scoped to `tests/sr/**/*.test.ts` and runs with `npx vitest run --config tests/sr/vitest.config.ts`. This keeps every sr-harness file inside the owned `tests/sr/` tree and touches no shared config. Test files are named by spec prefix (`tests/sr/sr-parse.test.ts`, `tests/sr/sr-match.test.ts`).

## Security and VM hygiene (R8)

- No UAC, security-policy, or Windows security-control changes (R8.1). Snapshot 3 already has NVDA logging and Chrome debugging configured; the harness consumes that state, it does not relax security to create it.
- No shared folders or host-guest sharing; files move only by the chunked `prlctl exec` copy (R8.2).
- `trap`-based teardown reverts to snapshot 3 on any exit path (R8.3).
- No secret or key is read or written; the URL is non-secret, `.env` is untouched, and the report writer emits only URL, scenario, keys, expectations, and utterances (R8.4).

## File ownership (R11)

Created/edited by this spec, and nothing else:

```
scripts/sr-check.sh            the one command
scripts/sr-*                   ported spike helpers (vmps/keys/await/peek/push/shot equivalents)
tests/sr/scenarios/tavern.json the default scenario
tests/sr/sr-parse.ts           scenario parser (pure)        } may live under scripts/sr-* or tests/sr/,
tests/sr/sr-match.ts           speech-log matcher (pure)     } both are owned paths
tests/sr/sr-parse.test.ts      parser unit tests
tests/sr/sr-match.test.ts      matcher unit tests
tests/sr/vitest.config.ts      self-contained vitest config for tests/sr (root excludes tests/**)
tests/sr/sample-pass.log       committed sample NVDA log
tests/sr/sample-fail.log       committed sample NVDA log
tests/sr/reports/summary.md    committed run summary (reports/ otherwise gitignored)
.kiro/<hook-or-workflow>       the single sr-check trigger
.gitignore                     one edit: ignore tests/sr/reports/ except summary.md
```

The `.gitignore` edit is the one file outside the three owned areas; it is a one-line ignore rule for this spec's own report directory, listed here so the tasks phase can account for it. No `src/` or `engine/` file is touched (R11.2). Nothing is pasted from `reference/`; the spike's techniques are re-implemented (R11.3).
