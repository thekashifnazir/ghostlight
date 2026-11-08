# sr-harness — real screen-reader checks for Ghostlight

One command drives a **real** screen reader (NVDA) through the game inside a
Windows VM and tells you pass or fail per step. It catches the *mechanical*
screen-reader bugs that Mac VoiceOver testing misses — whether a key press
reaches the game and whether the right line is spoken — before a human tester
sees the build. Built from Spike 10 (`reference/spikes/10-nvda-vm.md`), which
proved every piece works today.

## Run it

```sh
scripts/sr-check.sh <url> [scenario]
```

- `<url>` — the build to check: the hosted `https://…` site, or a local
  `http://…` build served to the VM (for example `http://10.211.55.2:8000/`).
- `[scenario]` — a scenario name under `tests/sr/scenarios/` (default `tavern`).

Example:

```sh
scripts/sr-check.sh https://ghostlight.pages.dev/
scripts/sr-check.sh http://10.211.55.2:8000/ tavern
```

The command:

1. Validates the scenario (and stops here if it is missing or malformed — the
   VM is never touched).
2. Reverts the Parallels VM **"Ghostlight Win11"** to snapshot
   **"3 NVDA logging + helpers"**, starts NVDA, and starts Chrome on the URL.
3. Runs the scenario's steps in order, pressing real keys and reading back what
   NVDA actually spoke.
4. Prints one PASS/FAIL line per step, writes a JSON report plus the raw NVDA
   speech under `tests/sr/reports/<date>/`, and appends one row to
   `tests/sr/reports/summary.md`.
5. **Leaves the VM reverted to the snapshot** on every exit path (pass, fail, or
   error), and deletes the fresh Chrome profile it created.

Exit code is `0` only if every step passed.

## The readiness signal (`window.__ghostlight`)

The player publishes a tiny, read-only status object on `window.__ghostlight`
so a test or screen-reader harness can wait on **real engine state** instead of
a fixed sleep. It is observer-only: it never writes to the live region, binds no
keys and renders nothing, so it cannot change what a player hears or does. The
source and the full phase list are in
[`src/engine/status.ts`](../../src/engine/status.ts).

What it exposes:

| Field | Meaning |
|---|---|
| `phase` | the readiness phase (below) |
| `room` / `chapter` | the engine's current room and chapter numbers |
| `lineSeq` | increments on every functional live-region line |
| `lastLine` | the most recent live-region line's text |
| `lines` | the last 200 lines as `{ seq, t (ms since boot), text }` |
| `waitFor(phase, timeoutMs?)` | a Promise that resolves when the phase is reached |
| `waitWhile(pred, timeoutMs?)` | a Promise that resolves when `pred(phase)` first goes false (wait until a phase is *left*) |

Phases: `gate` (start gate up), `booting` (fresh boot), `loading` (save-slot
boot), `ready` (engine settled after the last command, keys accepted), `busy`
(a sent command has not settled), `conversation` (dialogue still arriving),
`choice` (a choice menu waits for the player), `cutscene` (a skippable scene),
`error` (the engine reported an error).

The current phase is also mirrored on
`document.documentElement.dataset.glPhase`, so a Playwright test gets built-in
auto-waiting:

```ts
// wait until the engine accepts keys again after an action
await page.waitForFunction(() => window.__ghostlight?.phase === "ready");
// or, equivalently, on the mirrored attribute:
await expect(page.locator("html")).toHaveAttribute("data-gl-phase", "ready");

// wait until a bartender conversation finishes (the phase leaves 'conversation')
await page.waitForFunction(
  () => window.__ghostlight?.phase !== "conversation",
);
```

Settling reuses the transport-settle **quiet-period** rule (see
`mcp/src/native.ts`): a sent command moves the phase to `busy` and arms an
inactivity timer that every engine line and event resets, so a slow-but-still-
talking command (a multi-second conversation reply, a paced cutscene) is never
prematurely called ready; a definitive `room`/`diff`/`choices`/`error` event
settles it at once. Prefer waiting on this signal over `page.waitForTimeout(...)`
in the live Playwright specs.

### Requirements

- A Mac with `prlctl` and the "Ghostlight Win11" VM on snapshot 3. This cannot
  run in CI — it needs the live VM.
- Node (for the TypeScript helpers, run through `vite-node`).

### Two safety details that matter

- **Fresh Chrome profile per run.** The snapshot's own Chrome profile has
  already answered the "Control and reprogram MIDI devices" permission prompt
  once, so reusing it would make the no-MIDI check always pass regardless of the
  build. Each run gets a brand-new empty `--user-data-dir`, deleted afterwards,
  so the MIDI decision starts unanswered.
- **Secure context for `http` URLs.** When the URL is `http` (a local build),
  Chrome is started with `--unsafely-treat-insecure-origin-as-secure=<origin>`,
  because without a secure context `window.crypto.subtle` is undefined and the
  hint and save paths behave differently from the HTTPS site. The flag is added
  only for `http` origins, never for `https`.

Keys are pressed with scan codes (`keybd_event`) only, never
`WScript.Shell.SendKeys` — `SendKeys` toggles Num Lock and emits numpad keys
that NVDA treats as review-cursor commands, giving false "the key worked"
results (Spike 10).

The harness never changes UAC or any Windows security control, never enables
shared folders (files reach the VM only by a chunked in-band copy over
`prlctl exec`), and never reads `.env` or prints a secret.

## Scenarios are data

A scenario is a JSON file under `tests/sr/scenarios/`, one per file. Each has a
name, optional `url`/`fixture` hints, and an ordered list of steps:

```jsonc
{
  "name": "tavern",
  "fixture": "tavern",
  "steps": [
    {
      "keys": "right",          // required: a chord ("right", "shift+r", "tab,esc")
                                 //   or an action token ("start", "reload", "continue")
      "expectSpoken": ["of"],    // substrings that MUST appear in what NVDA said
      "expectNotSpoken": ["no next"], // substrings that must NOT appear
      "waitForSpoken": "room",   // optional: poll the page's live region for this
                                 //   substring before capturing (deterministic wait)
      "waitMs": 1500,            // settle time, or the poll cap when waitForSpoken is set
      "note": "Right cycles the room"  // optional human label for the report
    }
  ]
}
```

Add or change a check by editing a scenario file — no script change needed.
Matching is case-insensitive substring matching against the reduced NVDA
utterances. A step that expected something spoken but got nothing fails.

`waitForSpoken` makes a step deterministic when its line lands after a variable
delay. The Start step uses it: onboarding ("Left and Right…") is appended to the
first room reading, which arrives when the engine is ready, not at a fixed time.
With `waitForSpoken` set, the runner presses the keys, then polls the page's live
region over the bridge until that substring appears (bounded by `waitMs`), then
captures NVDA's speech — instead of sleeping a guessed duration. The tavern Start
and Continue steps use it.

`tavern.json` walks the opening tavern room the way Spike 10 did (Start, Right,
Down, L, H, Tab/Escape, V/Escape, S, N, G, Shift+R, C to save, reload, Continue)
and asserts the *fixed* behaviour: it presses no NVDA+Space, so it passes only if
the page enters focus mode on its own, and it asserts the MIDI permission prompt
never appears.

## Layout

```
scripts/sr-check.sh      the one command (VM lifecycle + step loop + report)
scripts/sr-vm-lib.sh     VM primitives (vmps, push, peek, keys) — sourced, not run
scripts/sr-keys.ps1      scan-code key presser run inside the VM
scripts/sr-await.ps1     press + poll the live region for a line + capture (one round-trip)
scripts/sr-cdp.mjs       page bridge over Chrome's debugging port (read + reload)
tests/sr/scenarios/      scenario data files (tavern.json)
tests/sr/sr-parse.ts     scenario parser (pure, unit-tested)
tests/sr/sr-match.ts     speech-log reducer + matcher (pure, unit-tested)
tests/sr/sr-report.ts    report builder + writer + summary (library)
tests/sr/sr-*-cli.ts     thin CLI wrappers sr-check.sh calls via vite-node
tests/sr/sample-*.log    committed sample NVDA logs for the unit tests
tests/sr/reports/        run reports (gitignored except summary.md)
tests/sr/vitest.config.ts  self-contained config for the unit tests
.kiro/workflows/sr-check.workflow.json  on-demand trigger to run it after a deploy
```

## Unit tests

The scenario parser and the speech-log matcher are pure and covered by fast
unit tests on two committed sample NVDA logs — no VM, prlctl, NVDA, or network:

```sh
npx vitest run --config tests/sr/vitest.config.ts
```

(The root `vitest.config.ts` excludes `tests/**`, so this harness ships its own
config scoped to `tests/sr`.)

## Windows Narrator: not captured (and why)

The harness covers **NVDA** only. We checked whether Windows' built-in screen
reader, Narrator, could be driven the same way, and it cannot — reliably.

NVDA at IO logging level writes every utterance to `%TEMP%\nvda.log` as a
`Speaking [...]` line. That textual, per-utterance log is the whole reason the
matcher can be exact and deterministic. NVDA also offers a Speech Viewer and a
community speech-logger add-on. **Narrator has no equivalent per-utterance text
log.** Capturing Narrator's actual speech would mean either tapping the SAPI/
text-to-speech layer (brittle and version-dependent), or capturing the audio and
transcribing it with a speech-to-text engine (a new, non-deterministic
dependency that is unreliable for a pass/fail gate), or scraping UI Automation
for what Narrator *would* read (which tests the DOM, not Narrator's output, so it
does not prove the Narrator path).

**Decision:** skip Narrator and keep NVDA as the covered screen reader. The
scenario and matcher are screen-reader-agnostic, so if a reliable Narrator
capture ever appears it can be added behind the same scenarios and matcher
without reshaping the harness.
