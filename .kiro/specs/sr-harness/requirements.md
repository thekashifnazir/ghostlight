# Requirements: sr-harness (one command checks the game with a real screen reader)

## Introduction

Ghostlight is tested on Mac VoiceOver, but Spike 10 (`reference/spikes/10-nvda-vm.md`) showed that the Windows screen readers — NVDA and JAWS — break the game in ways VoiceOver never surfaces: after Start, keyboard focus sat on `<body>`, NVDA stayed in browse mode, and every game key (Right, Down, L, H …) was eaten by the screen reader's virtual cursor instead of reaching the game. A surprise MIDI permission prompt, a changing tab title, and double-spoken menus rode along. These are *mechanical* screen-reader bugs: whether a key press reaches the game and whether the right line is spoken. They are invisible to a Mac VoiceOver run and only showed up once a real screen reader drove the live site.

This spec turns that spike into a repeatable harness. The spike's scripts already work today: Claude Code drove NVDA inside the Parallels VM "Ghostlight Win11" (Windows 11 ARM) from the Mac, pressing real keys into Chrome and reading back what NVDA spoke from its IO-level log. The harness packages that into one command — `scripts/sr-check.sh <url> [scenario]` — that reverts the VM to a known snapshot, boots NVDA and Chrome on the URL, runs a scenario of key presses, and reports pass/fail per step against what the screen reader actually said. Scenarios are data files, not code, so new checks are a JSON edit, not a script change. The goal is to catch mechanical screen-reader bugs on a build before a human tester ever sees them.

This spec owns only `scripts/sr-*`, `tests/sr/` and a single `.kiro` hook or workflow file. It does **not** edit `src/` or `engine/`; it is a test harness that runs against a deployed URL, not a change to the player or the engine. It builds on ScummVM's and the player's existing behaviour; the new work is the VM lifecycle, the scenario format, the speech-log matcher, the report, and the on-demand trigger. The bugs the spike found are fixed by the separate `screen-reader-focus` spec; this harness is what proves they stay fixed and catches the next one.

Requirements use EARS (Easy Approach to Requirements Syntax). Terms:

- **the VM**: the Parallels virtual machine named "Ghostlight Win11" (Windows 11 ARM, 8 GB RAM, no shared folders), driven from the Mac with `prlctl`.
- **snapshot 3**: the VM snapshot named `3 NVDA logging + helpers` — NVDA installed with `loggingLevel = IO`, Chrome configured for remote debugging, Node present, welcome/update/stats prompts off, and the spike helper files staged on `C:\gl`. This is the known-good starting state every run reverts to.
- **NVDA speech log**: NVDA's log at `%TEMP%\nvda.log`, which at IO logging level records every utterance as a `Speaking [...]` line. This is the single source of truth for "what the screen reader said".
- **utterance**: one `Speaking [...]` entry in the NVDA speech log, reduced to its spoken text (LangChangeCommand and CancellableSpeech wrappers stripped), as the spike's `keys.ps1` already does.
- **a scenario**: a JSON file under `tests/sr/scenarios/` describing an ordered list of steps to run against a URL, with a human name and the fixture/URL assumptions it needs.
- **a step**: one entry in a scenario — a key chord (or chords) to press, the substrings that must appear in what the screen reader speaks after it (`expectSpoken`), the substrings that must not appear (`expectNotSpoken`), and how long to wait for speech to settle (`waitMs`).
- **a chord**: one key press, possibly with modifiers, expressed as the spike's comma-and-plus syntax (e.g. `right`, `shift+r`, `tab`), pressed into Chrome with real scan codes so the screen reader sees it as a typed key.
- **the matcher**: the pure function that takes the utterances captured after a step and the step's `expectSpoken`/`expectNotSpoken` lists and decides the step's pass/fail.
- **the report**: the JSON result file plus the raw NVDA speech, written under `tests/sr/reports/<date>/` for one run.
- **the page bridge**: reading the Ghostlight tab's DOM (focused element, live-region text) over Chrome's remote-debugging port, as the spike's `peek.sh`/`cdp.mjs` do, without touching the keyboard input path.
- **Narrator**: Windows' built-in screen reader, which has no per-utterance speech log equivalent to NVDA's.

## Requirements

### Requirement 1: One command runs a full screen-reader check

**User story:** As a maintainer, I want a single command that drives a real screen reader through the game and tells me pass or fail, so that I can check a build for mechanical screen-reader bugs without doing it by hand.

#### Acceptance criteria

1. THE harness SHALL provide one entry point, `scripts/sr-check.sh <url> [scenario]`, that takes a target URL and an optional scenario name and runs that scenario end to end against the URL.
2. WHEN no scenario name is given THEN `sr-check.sh` SHALL run the default scenario `tavern`.
3. WHEN `sr-check.sh` is given a scenario name that has no matching file under `tests/sr/scenarios/` THEN it SHALL stop with a clear error naming the missing scenario and SHALL NOT start the VM.
4. WHEN `sr-check.sh` is given no URL THEN it SHALL stop with a usage message and a non-zero exit code.
5. WHEN every step of the scenario passes THEN `sr-check.sh` SHALL exit zero; WHEN any step fails or the run cannot complete THEN it SHALL exit non-zero.
6. THE harness SHALL depend only on tools the spike already relies on (`prlctl`, `base64`, `iconv`, Node, and the staged `C:\gl` helpers), and SHALL NOT require any tool not present in the spike set-up.

### Requirement 2: Every run starts from the known VM snapshot

**User story:** As a maintainer, I want each run to start from a clean, known VM state, so that a result reflects the build under test and not leftover state from a previous run.

#### Acceptance criteria

1. WHEN `sr-check.sh` starts a run THEN it SHALL revert the VM to snapshot 3 with `prlctl` before starting NVDA or Chrome.
2. WHEN the VM is not the expected "Ghostlight Win11" VM, snapshot 3 does not exist, or the revert fails THEN `sr-check.sh` SHALL stop with a clear error and a non-zero exit code rather than run against an unknown state.
3. WHEN the revert succeeds THEN `sr-check.sh` SHALL ensure the VM is running and the user session is logged in before it starts NVDA and Chrome.
4. THE harness SHALL start NVDA and SHALL start Chrome on the target URL with the spike's remote-debugging configuration, and SHALL wait until the Ghostlight tab is loaded before running the first step.
5. WHEN `sr-check.sh` starts Chrome THEN it SHALL use a fresh, empty `--user-data-dir` created for that run and SHALL delete it afterwards, because the snapshot's own Chrome profile has a cached MIDI permission decision that would make the no-MIDI check (Requirement 4) meaningless.
6. WHEN the target URL uses `http` (for example a local build served to the VM at `10.211.55.2`) THEN `sr-check.sh` SHALL start Chrome with `--unsafely-treat-insecure-origin-as-secure=<origin>` for that origin, because without a secure context `crypto.subtle` is absent and hints and saves behave differently from the HTTPS site; WHEN the URL uses `https` THEN the flag SHALL NOT be added.

### Requirement 3: Scenarios are data, not code

**User story:** As a maintainer, I want to add or change a screen-reader check by editing a data file, so that new coverage does not require changing the harness scripts.

#### Acceptance criteria

1. THE harness SHALL read scenarios from JSON files under `tests/sr/scenarios/`, one scenario per file, named `<scenario>.json`.
2. A scenario SHALL carry a human-readable name and an ordered list of steps, and MAY declare the fixture or URL assumptions it needs (for example a replay fixture query string).
3. A step SHALL be an object with the fields `keys` (the chord or chords to press), `expectSpoken` (substrings that must appear in the spoken text after the step), `expectNotSpoken` (substrings that must not appear), and `waitMs` (how long to wait for speech to settle), where `expectSpoken` and `expectNotSpoken` are optional and `keys` is required.
4. WHEN a scenario file is not valid JSON or a step is missing its required field or has a field of the wrong type THEN the harness SHALL report a clear parse error naming the file and the offending step, and SHALL NOT start the VM.
5. THE harness SHALL run the steps of a scenario in file order and SHALL NOT reorder, skip, or parallelise them.

### Requirement 4: The tavern scenario covers the opening loop end to end

**User story:** As a maintainer, I want a ready scenario that walks the opening tavern room the way the spike did, so that the first run exercises the keys and regressions the spike found.

#### Acceptance criteria

1. THE harness SHALL ship a scenario `tavern.json` that drives the opening tavern room from Start.
2. THE `tavern` scenario SHALL start the game and SHALL rely on the page entering focus mode on its own, pressing no manual focus-mode chord (no NVDA+Space) of its own.
3. THE `tavern` scenario SHALL include steps for Right, Down, L, H, Tab then Escape, V then Escape, S, N, G, and Shift+R, each asserting the right line is spoken.
4. THE `tavern` scenario SHALL include a save-and-reload step: C to save, reload the page, and Continue, and SHALL assert that Continue lands back in the same room.
5. THE `tavern` scenario SHALL assert, across the run, that no "Control and reprogram MIDI devices" permission prompt text appears in the spoken output (`expectNotSpoken`).
6. WHERE the page bridge is used, the `tavern` scenario MAY assert the focused element's role or the live-region text to corroborate a step, without pressing keys through that bridge.

### Requirement 5: The matcher decides pass/fail from what was actually spoken

**User story:** As a maintainer, I want each step judged against the screen reader's real speech, so that a pass means the key reached the game and the right line was heard, not that a script merely ran.

#### Acceptance criteria

1. WHEN a step is run THEN the harness SHALL capture only the utterances the screen reader produced after that step's key presses, using the new `Speaking` lines in the NVDA speech log, as the spike's `keys.ps1` does.
2. WHEN a step declares `expectSpoken` substrings THEN the matcher SHALL pass the step only if every `expectSpoken` substring appears in that step's captured utterances.
3. WHEN a step declares `expectNotSpoken` substrings THEN the matcher SHALL fail the step if any `expectNotSpoken` substring appears in that step's captured utterances.
4. THE matcher SHALL compare substrings case-insensitively and SHALL ignore the NVDA log's wrapper noise (LangChangeCommand, CancellableSpeech, and the Chrome window/document focus utterances) already stripped by the spike's reducer.
5. THE matcher SHALL be a pure function — captured utterances and the step's expectations in, a per-step verdict out — with no VM, file, or network access, so it can be unit-tested on recorded logs.
6. WHEN a step produces no new utterances within its `waitMs` THEN the matcher SHALL treat that as spoken output of empty, so a step that expected something spoken fails rather than hangs.
7. THE harness SHALL press every key with the scan-code presser (`keybd_event`) only, and SHALL NOT use `WScript.Shell.SendKeys`, because `SendKeys` sends numpad keys that NVDA treats as review-cursor commands and so gives false results (Spike 10).

### Requirement 6: A clear per-step report, saved and summarised

**User story:** As a maintainer, I want to see which step failed and what was actually said, so that I can tell a real regression from a flaky run and keep a record.

#### Acceptance criteria

1. WHEN a run completes THEN `sr-check.sh` SHALL print one pass/fail line per step to the console, naming the step and, on failure, the expected substrings and what was actually spoken.
2. WHEN a run completes THEN the harness SHALL write a JSON report and the raw NVDA speech for the run under `tests/sr/reports/<date>/`, where `<date>` identifies the run.
3. THE JSON report SHALL record the target URL, the scenario name, the start time, and per step the keys, the expectations, the captured utterances, and the verdict.
4. THE `tests/sr/reports/` directory SHALL be gitignored except for a short committed run summary, so raw speech logs and full reports are not committed while a human-readable summary is.
5. WHEN the run cannot complete (VM, NVDA, or Chrome failure) THEN the report SHALL record how far it got and why it stopped, rather than claiming a pass or silently producing nothing.

### Requirement 7: Decide whether Windows Narrator can be captured

**User story:** As a maintainer, I want to know whether Narrator can be checked the same way as NVDA, so that we either cover it too or record clearly why we cannot.

#### Acceptance criteria

1. THE spec SHALL determine whether Windows Narrator's speech can be captured for matching the way NVDA's IO log is, given that Narrator has no equivalent per-utterance speech log.
2. WHEN Narrator's speech can be captured by a mechanism of comparable reliability THEN the harness MAY add Narrator as a second screen reader behind the same scenario and matcher.
3. WHEN Narrator's speech cannot be captured reliably THEN the spec SHALL write down the finding and the reason in the harness documentation and SHALL skip Narrator, keeping NVDA as the covered screen reader.
4. THE harness's primary covered screen reader SHALL remain NVDA regardless of the Narrator finding.

### Requirement 8: Never weaken VM security, and leave the VM as found

**User story:** As the VM's owner, I want the harness to run without lowering the VM's security or leaving it in a changed state, so that running a check is safe to repeat and does not drift the VM.

#### Acceptance criteria

1. THE harness SHALL NOT change UAC settings, security policy, or any other Windows security control to make a run work.
2. THE harness SHALL NOT enable Parallels shared folders or any other host-guest file sharing; files reach the VM only by the spike's in-band chunked copy over `prlctl exec`.
3. WHEN a run finishes, whether it passed, failed, or errored THEN the harness SHALL leave the VM reverted to snapshot 3.
4. THE harness SHALL NOT print, log, or write any secret or API key into a report; a target URL is treated as non-secret, and nothing from `.env` is read.

### Requirement 9: Run it on demand after a deploy

**User story:** As a maintainer, I want to kick off the screen-reader check on demand after a deploy, so that a fresh build is checked with a real screen reader before testers see it.

#### Acceptance criteria

1. THE spec SHALL provide exactly one `.kiro` artifact — a hook or a workflow named `sr-check` — that runs the harness on demand.
2. WHEN the `sr-check` artifact is triggered THEN it SHALL run `scripts/sr-check.sh` against a provided or configured URL and surface the pass/fail outcome.
3. THE `sr-check` artifact SHALL be on-demand (manual, or tied to a deploy step the maintainer runs) and SHALL NOT run automatically on unrelated events such as every file save.
4. THE `sr-check` artifact SHALL be the only `.kiro` file this spec owns.

### Requirement 10: The parser and matcher are unit-tested on recorded logs

**User story:** As a maintainer, I want the scenario parser and the speech-log matcher covered by fast unit tests on real recorded speech, so that the harness logic is trusted without needing the VM for every change.

#### Acceptance criteria

1. THE spec SHALL commit two small sample NVDA speech logs as fixtures under `tests/sr/`, one exercising a passing match and one a failing match.
2. THE scenario parser SHALL be unit-tested for a valid scenario, a missing required field, a wrong field type, and invalid JSON, asserting the clear errors required by Requirement 3.
3. THE matcher SHALL be unit-tested against the committed sample logs for: an `expectSpoken` substring present (pass), absent (fail), an `expectNotSpoken` substring present (fail) and absent (pass), case-insensitive matching, and a step with no new utterances (fail when speech was expected).
4. THE unit tests SHALL run in the repo's existing test runner without the VM, `prlctl`, NVDA, or network access.

### Requirement 11: Stay inside the harness's own files

**User story:** As a maintainer of the rest of the codebase, I want this harness confined to its own files, so that it cannot change the player or the engine.

#### Acceptance criteria

1. THE spec SHALL create and edit only files under `scripts/sr-*`, `tests/sr/`, and the single `.kiro` hook or workflow file for `sr-check`.
2. THE spec SHALL NOT edit any file under `src/` or `engine/`.
3. THE spec SHALL NOT copy code from `reference/` into `scripts/` or `tests/`; it is written from what Spike 10 proved, and may port the spike's techniques, not paste reference files as source.
