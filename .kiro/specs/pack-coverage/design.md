# Design: Pack coverage

## Overview

Pack coverage is a four-stage, human-gated pipeline that turns the engine's own room state into accepted entries in `packs/drascula-en.json`. The stages are **survey** (drive the native engine from a checkpoint and dump each room), **draft** (propose names and descriptions into a separate draft file), **approve** (a reviewer accepts entry by entry), and **merge** (accepted entries go into the pack through the existing validator hook). A fifth piece, the **coverage report and test**, measures rooms reachable versus described and fails when the pack falls behind.

Nothing here changes the player, the engine patch, or the command contract. The pipeline is a consumer of three existing things: the `drascula-mcp` native transport (to reach rooms and read state), the Crew checkpoints (to start partway through), and the pack validator and census coverage checker (to keep merges honest). It adds only its own scripts, a `packs/survey/` evidence tree, a draft file, and a review list.

```
Crew checkpoints (.saves/, not committed)
        │  start { slot }
        ▼
┌──────────────────┐   drascula-mcp native   ┌──────────────┐
│  survey script   │ ──────────────────────▶ │  the engine  │
│  (stage 1)       │ ◀────────────────────── │  (real)      │
└──────────────────┘   state / look / walk   └──────────────┘
        │ writes dumps + screenshots
        ▼
   packs/survey/<room>/{state.json, verbs.json, screenshot.png, meta.json}
        │  draft step (stage 2) reads dump + screenshot
        ▼
   packs/survey/draft-<chapter>.json        (proposals, never the pack)
        │  approve step (stage 3): reviewer marks each entry
        ▼
   packs/survey/review-<chapter>.json       (accepted / not-accepted per entry)
        │  merge step (stage 4): accepted only
        ▼
   packs/drascula-en.json  ──save──▶ pack-validate-on-save hook ──▶ validator + coverage checker
        │
        ▼
   coverage report + test (stage 5) read pack + census only
```

## Split with the Kiro Crew surveyor

The two systems share the game and the checkpoints and nothing else.

| | Kiro Crew surveyor (`ghostlight-crew`) | Pack coverage (this spec) |
|---|---|---|
| Job | Play the game as a blind player; find what a blind player cannot get past | Turn engine room state into accepted pack entries |
| Output | Prose reports (`reports/*.md`) and saved checkpoints (`.saves/`) | Dumps (`packs/survey/`), a draft file, a review list, merged pack entries |
| Reads | The live game, the player | Crew checkpoints, the census, the dumps |
| Writes | Its own reports and saves | `packs/survey/`, the draft and review files, `packs/drascula-en.json` |
| Never | Writes pack JSON | Edits Crew reports, commits save files, plays for coverage beyond reaching a room |

Concretely: Crew's run of 8 Nov 2026 produced chapter 2 checkpoints (`drascula.010`, slot 9) and reported a blocker (the held-item `open` rejection in `mcp/src/tools.ts`) that stops the chapter 2 chain reaching room 20. This spec starts from those checkpoints and, where a blocker stops a room being reached, records it as unreached rather than fabricating a dump. Crew's bug reports are inputs this spec respects; fixing the MCP target check is Crew's finding to resolve in its own path, not this spec's.

The handoff is the checkpoint file and the census. If Crew lands more checkpoints (for example a room 19 slot once the transport fix is in), this pipeline picks them up with no change: a run is parameterised by chapter and the checkpoints available for it.

## Dependency: transport-settle must commit first

The native transport (`mcp/src/native.ts`) now settles each command on a quiet-period inactivity cap (`COMMAND_CAP_MS`, 10 s of engine silence) rather than a flat 60 s timeout, and resolves a `choose` on its own deferred diff so a flag a choice commits (flag 40 for `ch2.von-braun-named`) is visible without a follow-up `state`. The Crew run stalled precisely because a missed settle cost 60 s of silence per command, so the driver could not tell slow from hung. That fix is not yet on `main` (HEAD is `1c1bda4`; no settle commit exists).

Because an unattended, checkpoint-to-room survey issues many commands per room with no human watching, it is only viable once a stalled command fails fast and carries its last A11Y line. **No implementation task in this spec may begin until the transport-settle fix has committed.** The tasks list this as a hard precondition on the survey task. Until then the spec stands as requirements, design and tasks only.

## Stage 1: survey script

### Transport and tools

The survey script is a Node script in `packs/survey/` (tooling, GPL-3.0-or-later) that launches `drascula-mcp` with `DRASCULA_MCP_TRANSPORT=native` and its own save path, then calls the MCP tools. It uses only the documented tools; it never touches the command file, the serialiser (`src/engine/adapter.ts`) or the parser (`src/engine/a11y-lines.ts`) directly. This keeps the one-contract rule: the player, the tests, the MCP server and this script all go through the same seam.

It uses its own save path `/tmp/ghostlight-pack-coverage`, distinct from the engine chat (`/tmp/ghostlight-engine`), the player chat, the MCP server (`/tmp/ghostlight-mcp`) and Crew (`ghostlight-crew/.saves/`), per the parallel-chats rule and the native transport's own save-path isolation. It copies a Crew checkpoint into its own save path before loading, so it reads Crew's saves but never writes them.

### Reaching rooms

A run is parameterised by a chapter and a starting checkpoint. From the loaded room the script performs a graph walk over the census exit graph (`reference/census.json`, `exitGraph`) for that chapter:

- Each node is a room; each edge is a census door with its destination.
- The script walks to an unvisited neighbour by issuing `walk <doorHotspot>`, confirms the room changed via the resulting diff or a `state` snapshot, dumps the new room, and recurses. It backtracks along the edge it came in on.
- A door that does not open (the diff reports no room change, or the command does not settle) is recorded as a blocked edge with the reason, and the walk continues with other edges. This is how a Crew-reported blocker (held-item rejection, a flag-gated door) becomes an "unreached room, reason X" line rather than a hang.
- Cutscene-reached rooms (56, 57, 102) have no walkable in-edge; they are surveyed from a checkpoint saved inside them, not by walking. The script treats them as reachable-by-checkpoint: if a checkpoint for that room exists it loads and dumps it, otherwise it records the room as unreached-needs-checkpoint.

Reachability therefore comes from two sources: the exit graph for walkable rooms, and named checkpoints for cutscene-only rooms. The run records a reached/unreached verdict per census room in the target chapter.

### What a dump captures (stage 1 → stage 2 contract)

Per reached room the script writes `packs/survey/<room>/`:

- `state.json` — the engine's `state`/`dump` snapshot as the MCP `state` tool returns it: chapter, room, hero point, every object with hotspot number and rectangle, inventory, all 50 flags. This is the authoritative hotspot list for the room.
- `verbs.json` — for each hotspot, which of `look/take/open/close/talk/push/walk` the engine answered (a diff) versus rejected (an A11Y_ERR), and the game's own look text captured from the `look` diff's said text. Raw engine text is kept verbatim, including Spanish or misspelt names, for a later `textFixes` decision. The script issues these probe verbs read-only where safe (`look` always; `open`/`close`/`talk`/`push` are probed only when the intent is to learn what the engine allows, and any state change is noted so the walk accounts for it).
- `meta.json` — checkpoint slot, date, engine build identifier, and the door flag plus census destination for each hotspot (from the census), so draft and merge can label exits and the coverage checker can verify destinations.
- `screenshot.png` — a picture of the room.

The screenshot is produced by ScummVM's own screenshot facility against the native window the transport already runs (fully headless SDL is flaky, gotcha 12; the transport runs a real window). The exact capture mechanism (ScummVM screenshot keybind via the transport, or a window grab of the known window) is an implementation choice recorded in tasks; the contract is only that a `screenshot.png` lands in the room folder with the dump. If no screenshot can be captured for a room, the dump still writes and the room's draft is forced to `seen: false`.

No dump embeds a key or `.env` contents. Dumps are evidence files read as local JSON and PNG by later stages.

## Stage 2: draft step

A Node script reads each `packs/survey/<room>/` dump and the screenshot and emits `packs/survey/draft-<chapter>.json`. It is a separate file from the pack by construction, so a draft can never be mistaken for a merge.

Per room the draft proposes, keyed on the engine's hotspot numbers:

- `name` (≤40 chars, no article), `short` (≤300 chars), `long` (no cap), following the variant rules only where the dump shows a state that warrants a variant; the common case is a plain string.
- For each door hotspot: an exit `label` (≤60 chars) and the census `to` destination carried from `meta.json`, plus a `direction` where the picture makes it clear.
- For each non-door hotspot: an object `name` (≤40 chars) and, where useful, a `description`, with `type` from the dump (object / npc / exit-like).
- `seen: true` only when written from the screenshot; `seen: false` when the screenshot was missing and only names and look text were available.
- a `provenance` note on each description: "drafted by Kiro from a screenshot" (or "from game text only" when no screenshot was available). This is carried into the review list so the reviewer sees the text is a machine-authored proposal and knows to check it by eye against the picture.

All proposed text follows pack-writing steering: plain British English, no em dashes, concrete left-to-right positioning, no puzzle answers in descriptions, lower-case names unless proper nouns. A Spanish or misspelt engine name (e.g. `ESCALERA`, `AJO`, `CHIMENEA`) is proposed as a translated label plus a `textFixes` suggestion recorded in the draft, never passed through raw.

The draft never invents a hotspot the dump did not report and always lists every hotspot the dump did report, so the reviewer sees the whole room. For a room that already has an accepted pack entry (all of chapter 1 and chapter 2), the draft marks the proposal `alreadyCovered: true` and carries the existing pack text alongside the new proposal, so stage 3 defaults to keeping the proven text and stage 2's chapter 2 output is directly comparable to known-good data (Requirement 6.2).

The draft step writes no API key or `.env` content, and it is a pure transform of local files: dump + screenshot in, draft JSON out. (The actual drafting of English prose is done by Kiro reading the dump and screenshot; the draft file is the structured record of those proposals, not a machine-translation output.)

## Stage 3: approve step

The draft is turned into `packs/survey/review-<chapter>.json`, a review list with one line per reviewable unit: a room's descriptive fields as one unit, and each exit and each object as its own unit, each keyed by room and hotspot number. Each unit carries a `status` the reviewer sets: `accepted`, `rejected`, or the default `pending`, and the `provenance` from the draft ("drafted by Kiro from a screenshot", or from game text only), so the reviewer knows the text is a machine-authored proposal and what to verify by eye.

The reviewer is Kash or Claude Code. Review is entry by entry: accepting a room's `name`/`short`/`long` is independent of accepting each exit label and object name, so a reviewer can accept a solid room description while rejecting one wrong object name. A unit that corresponds to an already-covered entry starts `pending` with the existing text shown; it is only replaced if the reviewer explicitly accepts the redraft, so proven chapter 1 and chapter 2 text is never overwritten silently (Requirement 4.6).

The review list is the gate: nothing downstream reads the draft directly for merging. Only `review-<chapter>.json` statuses drive stage 4.

## Stage 4: merge step

A Node script reads `review-<chapter>.json` and merges only `accepted` units into `packs/drascula-en.json`:

- An accepted room-description unit writes `name`, `short`, `long`, `seen` and the room's `chapters` into `rooms.<room>`.
- An accepted exit unit writes `exits.<hotspot>` (`label`, `to` from the census, optional `direction`, `opensWhen`/`note` where the dump showed a gated door).
- An accepted object unit writes `objects.<hotspot>` (`name`, `type`, optional `description`).
- Accepted `textFixes` suggestions are appended to the pack's `textFixes`.
- `pack.coverage.chapters` gains a chapter only when every reachable room in it has an accepted, merged entry — so a half-done chapter never claims coverage (Requirement 4.4).

Merge writes the file, which fires the `pack-validate-on-save` hook (`packs/tools/.../cli.ts validate`). The merge is complete only when the validator passes and `check-coverage` passes for the claimed chapters. A merge that fails validation is reported with the validator's errors and is not claimed as covered; the merge never disables or bypasses the hook or the coverage checker to force an entry through (Requirement 4.5, 4.7). Merge keys strictly on the engine's own hotspot numbers (`HotspotInfo` has no id; the pack keys on the per-room hotspot number), matching the format.

## Stage 5: coverage report and test

The coverage report is derived from the pack and the census only — no engine run — and reuses the existing checker in `packs/tools/src/coverage.ts` rather than writing a second one. Today's checker already reports `missing-room`, `missing-hotspot`, `door-destination`, `stale-room`, `stale-hotspot`, `exit-graph` and `null-exit-no-note` gaps for the covered chapters. The report this spec adds is a human-readable summary over the same checker's output:

- Per chapter: census rooms reachable vs rooms with a pack entry, naming each reachable room with no entry (the checker's `missing-room` gaps).
- Objects without names: described-room hotspots with no `name`/`label` (the checker's `missing-hotspot` gaps).

Reachability of cutscene-only rooms (56, 57, 102) is a point to confirm against the census representation: the checker reasons over census rooms in a covered chapter and the exit graph. If the census lists those rooms in their chapter (which the spike shows it does), they are already in scope for the checker as census rooms; the report counts them as reachable even though they have no walkable in-edge (Requirement 5.5). Whether the existing checker needs a small reachability note for cutscene rooms is settled in tasks against the actual `census.json` shape; the report does not fork the checker.

The test is a Vitest test (named by the `pack` spec prefix convention, under `packs/tools/test/`) that loads the pack and the census and fails when a chapter claimed in `pack.coverage.chapters` has a reachable room or a described-room hotspot with no coverage. It passes today (chapters 1 and 2 fully covered) and fails if a later chapter is added to coverage before its rooms are described (Requirement 5.4, 5.6). This is the guard rail that stops `coverage.chapters` claiming more than the accepted data supports.

## Data and file layout

```
packs/
  survey/                       (new; tooling + evidence, not the pack)
    README.md                   how to run a survey, draft, review, merge
    survey.ts                   stage 1: drive drascula-mcp native, dump + screenshot
    draft.ts                    stage 2: dump + screenshot -> draft-<chapter>.json
    merge.ts                    stage 4: review-<chapter>.json -> drascula-en.json
    draft-2.json                chapter 2 proposals (pilot)
    review-2.json               chapter 2 review list
    <room>/                     per-room dump
      state.json
      verbs.json
      meta.json
      screenshot.png
  drascula-en.json              (the pack; merge target)
  tools/
    src/coverage.ts             (reused; the report builds on it)
    test/pack-coverage.test.ts  (new; stage 5 test)
```

The `state.json`, `verbs.json` and `meta.json` dumps and the draft and review files under `packs/survey/` are committed as evidence (they are text records, like the census). The **screenshot is game art and is gitignored** (`packs/survey/**/screenshot.png`): the repo never holds game data, consistent with the game-data-not-committed rule. Save files are never committed. No file under `packs/survey/` contains a key.

## Error handling and safety

- **Non-settling command:** recorded against the command and room, the room marked a failed step, the run continues. The transport returns a clear error with its last A11Y line (post transport-settle), so the script can log slow-vs-hung honestly.
- **Unreachable room:** recorded with a reason (locked door, missing checkpoint, cutscene-only with no checkpoint, Crew-reported blocker). Never a fabricated dump.
- **Missing screenshot:** the dump still writes; the room's draft is forced `seen: false`.
- **Validator failure on merge:** reported with the validator's errors; the chapter is not claimed covered; the hook is never bypassed.
- **Shared tree:** the script stays inside `packs/`, uses its own save path, kills only its own child (the native transport already tracks its own PID and `kill -9`s only that), never runs a bulk git command, and commits only its own paths.
- **No keys:** no stage reads or emits `.env` or any key; dumps and drafts are local data files.

## Testing strategy

- **Stage 5 test (the deliverable test):** pack + census → coverage, fails on a claimed-but-uncovered chapter. Runs in CI with no engine.
- **Draft and merge unit tests:** pure-transform tests for the draft step (dump in → draft shape out, no invented hotspots, all dump hotspots listed) and the merge step (only `accepted` units merged, hotspot-number keying, `coverage.chapters` only grows when a chapter is complete, no overwrite of an already-covered entry without an accepted redraft). These reuse the pack tools' fast-check + Vitest setup.
- **Survey script:** validated by running it against the chapter 2 checkpoints once transport-settle lands, and comparing its drafts to the existing, accepted chapter 2 pack entries (Requirement 6.2). This is the end-to-end proof, not a unit test, because it needs the native engine.
- **No new checker:** the coverage checker is reused, so its existing property tests still guard the invariant; this spec adds the reachability-reporting layer and the claimed-chapter test on top.
