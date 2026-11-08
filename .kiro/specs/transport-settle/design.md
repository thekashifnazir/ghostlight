# transport-settle — design

## Reproduction (done first, before any change)

Work dir: `/tmp/ghostlight-transport`. The crew save slot 10 was copied there
(`cp` only, the original at `/Users/kash/Code/showcase/ghostlight-crew/.saves/drascula.010`
was never edited).

### What slot 10 actually is

Booting slot 10 reports **chapter 2, room 15** (objects: 172 ESCALERAS door,
188 MACHINE, 205 PAPERS, 206 CURTAIN). Hotspot 53 does not exist there, so
`talk 53` from slot 10 just errors immediately (`A11Y_ERR object 53 is not in
this room`) — it does not hang. The save had been overwritten to room 15 since
the surveyor's run (its mtime is recent). The surveyor's `talk 53` was the
tavern **drunkard** (room 62, hotspot 53), which opens the 4-option menu — the
real conversation settle path. So the reproduction drives two sweeps:

1. **Slot 10 as-is** (error path): `talk 53` / `choose 3` / `choose 4`, 50×, each
   from a fresh boot of the slot-10 copy. Every command errors in ~60 ms. **0
   timeouts** — the error-settle path is not where the hang lives.

2. **Fresh tavern** (conversation path): a fresh game boots into room 62, so the
   drunkard menu opens. `talk 53` / `choose 3` / `choose 4`, 50×. This is the
   path the surveyor actually exercised.

The harnesses drive the **real `NativeTransport`** (not drive.sh, which writes a
whole script up front) one command per `send()`, exactly as the MCP server does.

### Why the 50× sweeps did not reproduce the 60 s hang

The stream-split race (root cause below) needs stdout and stderr to interleave
mid-line under specific timing; a single-threaded, serialized-window sweep does
not trigger it, so both sweeps showed **0 timeouts**. The hang was instead
reproduced **deterministically as a unit test** (`mcp/test/native-stream-split.test.ts`):
on the unfixed transport, a partial stdout line followed by a stderr A11Y line
corrupts that A11Y line, the command never settles, and the test hangs; on the
fixed transport it settles at once. That test is the authoritative before/after
for the hang itself.

### Numbers

Tavern conversation path, settle outcome per command (50 iterations each):

| command  | before (outcome ×50) | after (outcome ×50) |
|----------|----------------------|---------------------|
| talk 53  | choices ×50          | choices ×50         |
| choose 3 | **choices ×50**      | **diff ×50**        |
| choose 4 | diff ×50             | diff ×50            |

Timeouts: before 0, after 0. Settle times unchanged (the choose diff arrives at
the same instant as the re-presented choices): talk ~1.37 s, choose 3 ~3.86 s,
choose 4 ~2.16 s mean. The behavioural change is that a `choose` now settles on
its **diff** (carrying the committed flags) instead of the re-presented choices.

Stream-split unit reproduction: before — 2 of 3 cases hang (never settle, would
hit the 60 s cap); after — all 3 settle in ~2 ms.

## Root cause

`NativeTransport` pumped **both** `child.stdout` and `child.stderr` into a single
shared line buffer (`this.buffer`). The engine prints A11Y lines on stderr
(`g_system->logMessage(kError)`), but the child also writes unrelated chatter on
stdout (the "User picked target…" / "packet.001: …" banner) and on stderr
(ScummVM "WARNING:" lines). stdout and stderr are independent event sources, and
a chunk boundary can land mid-line.

When a stdout chunk arrived **without a trailing newline** just before a stderr
A11Y line, the shared buffer spliced them:

```
buffer = "User picked target 'drascula'"      // partial stdout chunk, no \n
buffer += "A11Y_CMD look 52\n"                 // stderr A11Y line
       => "User picked target 'drascula'A11Y_CMD look 52\n"
```

The line the pump then extracted was `User picked target 'drascula'A11Y_CMD look
52`, which `parseA11yLine` does not recognise — so the command's echo (or its
terminal diff/err) was dropped, the command never settled, and `send()` waited
its full hard cap. By hand, stdout is quiet during a settled call, so no
interleaving happens and the same call settles at once — exactly the surveyor's
"timed out at 60 s from the crew, settled by hand" report. This is the same
class as the no-op `skip` timeout (a terminal marker the transport never
matches), confirmed deterministically by the unit reproduction.

A separate, caller-visible gap: a non-ending `choose` settled on the
**re-presented A11Y_CHOICES**, which the engine emits on the settling frame
**just before** the choose's own A11Y_DIFF (live/recorded order in
`tavern.json`). Settling on the choices dropped the diff — and with it the flags
the choice committed — so a caller had to run `state` to see a flag commit.

## The fix (all in `mcp/src/native.ts`)

1. **Per-stream line buffers.** `stdoutBuffer` and `stderrBuffer` replace the one
   shared `buffer`; `onChunk(stream, data)` carries a partial final line within
   that stream only. A partial line on stdout can never corrupt an A11Y line on
   stderr. (R1)

2. **`choose` settles on its diff, not the choices.** `routeToPending` treats
   A11Y_CHOICES as terminal only for `talk`/`choices` (`choicesSettles()`
   returns false for `choose`). A `choose` collects the re-presented choices into
   `events` and waits for its own A11Y_DIFF (or A11Y_ERR). This matches the
   replay transport, which already reads "up to and including the diff", so the
   two transports agree and the caller sees the committed flags without `state`.
   An ending `choose` (option 4) emits no re-presented choices and settles on its
   diff from `onConverseEnd()`. (R2, R3)

3. **Quiet-period command cap with the last A11Y line.** The per-command wait is
   a ~10 s **inactivity** cap (`COMMAND_CAP_MS`), reset on every parsed A11Y line
   (`bump()`), not an absolute cap. A command still emitting output (echo, drawn
   text, choices refresh) is never cut off; only a genuine stall — no A11Y output
   for 10 s — returns an error naming the command and the **last A11Y line seen**
   (`lastA11yLine`), instead of 60 s of silence. The start() cap stays 60 s
   (`START_CAP_MS`) because a cold boot legitimately takes seconds. (R4)

### Why no engine source change

Requirement 2.4 ("the engine emit flag changes in the A11Y_DIFF after every
choose and when a conversation ends") is **already met by the engine**:
`A11yLayer::emitDiff()` unconditionally includes every changed flag (gotcha 8;
proven by the `talk 52` fixture carrying `"flags":{"0":[0,1]}`), and the same
`emitDiff()` builds every `choose` diff and the conversation-end diff. The
conversation's story flags are set inside the option responses, which run during
each `choose`'s processing, so each flag commit lands in that choose's diff; the
post-loop `converse()` tail sets no flags. The defect was that the **transport**
dropped the choose diff, not that the engine failed to emit the flags. So the
fix is entirely in `mcp/`, and `git status engine/` is empty. The native and web
engine were rebuilt to confirm the build still works; the wasm is unchanged.

## Risks and how they are handled

- *A `choose` that never emits a diff would now hang.* The engine always emits a
  choose's diff (the deferred `_choiceDiffPending` flush on the next converse
  frame for a non-ending choose, or `onConverseEnd()` for an ending choose), or
  an A11Y_ERR for a bad option number — both terminal. The quiet-period cap is
  the backstop if the engine truly stalls.
- *Reordering the engine's choices/diff emission* would have been simpler but
  would break the recorded fixtures (owned by the engine-a11y-layer spec) and the
  documented wire order. The transport-side fix keeps the engine/fixture contract
  intact and aligns the native transport with the replay transport.
