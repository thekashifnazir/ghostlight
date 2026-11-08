# transport-settle — tasks

- [x] 1. Reproduce first. Copy crew save slot 10 into `/tmp/ghostlight-transport`
  (never edit the original). Build a harness that drives the real
  `NativeTransport` one command per `send()` and runs `talk 53` / `choose 3` /
  `choose 4` fifty times from a fresh start, counting timeouts and settle times.
  Record the numbers in design.md before changing anything. (R: reproduce)
  - Found slot 10 is chapter 2 room 15 (no hotspot 53), so added a second
    fresh-tavern sweep for the real conversation path. Both sweeps: 0 timeouts.
  - Reproduced the actual hang deterministically as a unit test
    (`mcp/test/native-stream-split.test.ts`): 2 of 3 cases hang on unfixed code.

- [x] 2. Find the root cause in how settle is detected. (R1)
  - Root cause: `NativeTransport` merged stdout and stderr into one shared line
    buffer; a partial stdout line splices into a stderr A11Y line and corrupts
    it, so the terminal marker is never matched and the command hangs to the cap.
  - Secondary: a non-ending `choose` settled on the re-presented A11Y_CHOICES,
    dropping the choose's A11Y_DIFF (and its flags).

- [x] 3. Fix it. (R1, R2, R3)
  - Per-stream line buffers (`stdoutBuffer`/`stderrBuffer`, `onChunk(stream,…)`).
  - `choose` settles on its diff, not the choices (`choicesSettles()`), so flags
    reach the caller without `state`; `talk`/`choices` still settle on choices.
  - The engine already emits flags in every choose/conversation-end diff
    (`emitDiff`); no engine source change was needed (see design "Why no engine
    source change"). `git status engine/` is empty.

- [x] 4. Clear error after ~10 s, not 60 s of silence. (R4)
  - Per-command quiet-period cap `COMMAND_CAP_MS = 10_000`, reset on every A11Y
    line, reporting the last A11Y line seen. start() keeps the 60 s boot cap.

- [x] 5. Rerun the fifty; record before and after; keep tests green; rebuild. (R5)
  - After: tavern sweep 0 timeouts, `choose 3` now settles on its diff (was
    choices). Numbers in design.md.
  - `tests/engine/`: 34 passed. `mcp/`: 52 passed (incl. the two new regression
    files `native-stream-split.test.ts` and `native-choose-diff.test.ts`).
  - Native engine rebuilt (`scripts/build-engine.sh`); web engine rebuilt
    (`scripts/build-web.sh`). No deploy.
