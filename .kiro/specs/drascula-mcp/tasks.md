# Tasks: Drascula MCP server

These tasks build the server incrementally, replay-first so everything is runnable before the native engine exists. Each task cites the requirements it satisfies. Stay inside `mcp/` and the single `.kiro/settings/mcp.json` entry; never touch `engine/`. Import the contract from `src/engine/` and read fixtures from `tests/engine/fixtures/` — do not copy either. After each task, append a `## NN · mcp · ...` entry to `docs/kiro-process.md`, update the relevant `docs/kiro-features.md` row, and commit only your own explicit paths.

- [x] 1. Scaffold the `mcp/` package
  - Create `mcp/package.json` (ESM, private) with its own `test` script (`vitest run`) and `@modelcontextprotocol/sdk`, `zod` as deps and `tsx`/`vitest` available; `mcp/tsconfig.json` extending the repo's config.
  - Give `mcp/` its own `mcp/vitest.config.ts` scoped to `mcp/test`. Do NOT edit the root `vitest.config.ts` or the root `package.json` — `mcp/` is self-contained.
  - Add a `mcp/README.md` stub naming the transports and the `replay` default.
  - Verify: `tsc --noEmit` over `mcp/` passes on an empty entrypoint; `npm --prefix mcp test` discovers `mcp/test` (no tests yet is fine).
  - _Requirements: 1.1, 10.1_

- [x] 2. Define the transport interface and the command result
  - Add `mcp/src/transport.ts`: the `Transport` interface (`start`/`send`/`stop`) and the `CommandResult` type, importing `Command`, `EngineEvent`, `RoomState`, `Diff` from `../../src/engine/adapter.js`. Define no parallel contract types.
  - Verify: `tsc --noEmit` resolves the `src/engine/` imports against the real exports.
  - _Requirements: 5.1, 5.4, 2.7, 3.7_

- [x] 3. Build the replay transport over the shared `ReplayAdapter`
  - Add `mcp/src/replay.ts`: load a fixture from `tests/engine/fixtures/<name>.json`, concatenate `startRaw` + each step's `raw[]` into one newline-delimited blob, construct `new ReplayAdapter(blob)` from `../../src/engine/replay-adapter.js`, and adapt its event stream to the request/response `Transport` (collect events per `send` until the diff/error, resolve with `CommandResult`).
  - `start()` returns the first `room` event as `RoomState`; a command the fixture did not record next returns the `ReplayAdapter`'s quoted mismatch error as `CommandResult.error`.
  - Verify: a scratch script (or the first unit test) loads `tavern`, starts, and reads back the room — remove the scratch before commit.
  - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 5.2, 5.3, 5.4_

- [x] 4. Build the session (transport holder + current room tracking)
  - Add `mcp/src/session.ts`: hold `Transport | null` and `currentRoom: RoomState | null`; `start` stops any existing session first, boots, stores the first room; refresh `currentRoom` from any room-change diff and from `state`; expose `isTargetInRoom(num)`, `heldItemIds()`, `send(cmd)`, `stop()`.
  - Verify: unit test that a room-change diff (the `walk 105` chapter crossing from `tavern.json`) updates `currentRoom` to room 14 with the new objects.
  - _Requirements: 4.1, 4.2, 8.1, 8.4_

- [x] 5. Config and transport selection
  - Add `mcp/src/config.ts`: resolve transport (`replay` default) and fixture name from env/flags; resolve native launch config (binary, game path, extrapath, savepath default `/tmp/ghostlight-mcp`, optional slot) with defaults matching `scripts/build-engine.sh`. Throw a clear named error for an unresolvable selection. Never read or print a key.
  - Verify: unit test that default selection is `replay` + `tavern`, and that a missing fixture name throws a message naming it.
  - _Requirements: 1.3, 1.4, 1.6, 6.1, 9.3, 9.4_

- [x] 6. Tool layer: schemas, start/stop, and the no-session guard
  - Add `mcp/src/tools.ts`: register `start` (`{ slot?: int }`) and `stop` on an `McpServer`; `start` returns the first `RoomState`, `stop` returns `{ stopped: true }` and is safe with no session.
  - Register the game-playing tools' schemas (target-verb `{ target: int }`, `use` `{ item, target }`, `choose` `{ n: 1..4 }`, `save` `{ slot }`, and the no-arg `inventory`/`choices`/`skip`/`state`), each guarded to error with "call start first" when no session exists.
  - Document the `inv`/`inventory` and `dump`/`state` aliases in the tool descriptions.
  - Verify: unit test that a game tool before `start` returns the start-first error; after `start`, `state` returns the current room.
  - _Requirements: 2.1, 2.2, 2.3, 2.5, 2.6, 2.8, 4.1, 4.3, 4.4_

- [x] 7. Target validation before send (Req 8)
  - In `tools.ts`, before building any command: reject a target-verb `target` not in `session.currentRoom`; reject a `use` `target` that is not an in-room hotspot, a held item id, or `50` (self). Rejections are MCP errors and send nothing to the transport. Judge validity against the current room only.
  - Verify: covered by the property test in task 11; add a focused unit case here (look at an absent number rejects; look at a present number passes validation).
  - _Requirements: 8.2, 8.3, 8.4, 8.5, 2.4_

- [x] 8. Wire command tools to the session and shape JSON replies
  - Each target-verb/`use`/`choose`/`skip` tool builds a `Command`, calls `session.send()` (which uses `serializeCommand`), and returns `CommandResult` (events + diff) as JSON; `inventory` returns the `inv` items, `choices` the choices, `save` the saved slot, `state` the current room. An engine `A11Y_ERR` result is returned as an MCP error-flagged result that leaves the session usable.
  - Verify: unit test over replay that `talk 53` returns the four choices and `look 999` comes back error-flagged.
  - _Requirements: 2.7, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.8_

- [x] 9. Server entrypoint over stdio
  - Add `mcp/src/server.ts`: read config, construct the chosen transport and the session, register all tools, connect `StdioServerTransport`. All logging goes to stderr; stdout carries only protocol. A failed transport init exits with the named error.
  - Verify: launch the server with the MCP SDK's inspector or a scripted client over stdio; confirm tools are listed and `start`→`state` works on replay. Confirm nothing but protocol reaches stdout.
  - _Requirements: 1.1, 1.2, 1.4, 1.5, 1.6_

- [x] 10. Replay regression test — recorded diffs for `tavern.cmd`
  - Add `mcp/test/replay.test.ts`: start the `tavern` replay session and drive the tools in the fixture's re-recorded order (8 steps; the `inv` step omitted per the entry-65 gap): `look 102`, `talk 53`, `choose 2`, `choose 4`, `walk 105` (door text), `talk 52`, `walk 105` (crossing). Assert each returns the recorded parsed diff/events — `look 102` the "BEST BURGERS…" `said`/`changed:false`, `talk 53` the four choices (option 4 `ends:true`), `choose 2` the two-line exchange with option 2 then `used`, `talk 52` `flags {"0":[0,1]}` / `changed:true`, and the second `walk 105` the chapter crossing (`chapter [1,2]`, `room [62,14]`, new objects). The `look 999` error case is the validation property test (task 11), not in this fixture.
  - Verify: `vitest run` green.
  - _Requirements: 7.3, 3.1, 3.2, 5.3_

- [x] 11. Property test — every tool rejects an out-of-room target
  - Add `mcp/test/validation.test.ts`: with a started replay session in room 62, use `fast-check` to generate integers outside the room's hotspot numbers (and, for `use`, also outside held item ids and `50`), and assert every target-verb tool and `use` reject them with a target error and send nothing. Add the positive check that a valid in-room target passes validation.
  - _Requirements: 8.2, 8.3, 8.4_

- [x] 12. Contract-sharing guard test
  - Add an assertion (in a test or a tiny static check) that the server imports `serializeCommand` and `parseA11yLine` from `src/engine/` and defines no local copy, so copying the contract later fails the suite.
  - Verify: `vitest run` green; a deliberate local redefinition makes it fail.
  - _Requirements: 2.7, 3.7, 5.4_

- [x] 13. Register the server in `.kiro/settings/mcp.json`
  - Create the file if absent, or add/update only the `drascula` entry if it exists, leaving any other entries untouched. Launch over stdio, default `env` `DRASCULA_MCP_TRANSPORT=replay`, no key embedded. Set sensible `autoApprove` for read-only tools.
  - Verify: the entry parses; Kiro reconnects and lists the `drascula` tools; a `start` then `state` call over replay returns the room.
  - _Requirements: 9.1, 9.2, 9.3, 9.4, 10.4_

- [ ] 14. Native transport (written to the contract; verified when the engine build lands)
  - Add `mcp/src/native.ts`: spawn `vendor/scummvm/scummvm` with `--savepath=/tmp/ghostlight-mcp --subtitles` plus the game/extra paths from config and the optional load-slot; create and own `/tmp/ghostlight-mcp`; write commands to its `a11y-cmd.txt`; read stderr, parse each line with `parseA11yLine`, buffer partial lines.
  - Settle on markers (`A11Y_CMD` echo → single `A11Y_DIFF`/`A11Y_ERR`, accumulating interleaved events), with a hard 60 s cap returning a timeout `CommandResult.error`; never use fixed sleeps. Surface a subtitles-off `A11Y_ERR` as a start error.
  - Teardown: `SIGTERM` then `SIGKILL`, remove only the command file (`a11y-cmd.txt`); never delete the save files, because the `--save-slot` start path needs them to begin partway through. A process-exit handler kills a still-running child.
  - Verify (when the native build exists): `start` reaches the tavern room; the first few `tavern.cmd` commands return diffs matching the replay JSON. Until then, confirm it fails loud with a clear message when the binary is absent, and that selecting `native` with a present binary boots to a room. Launch with the MCP save path `/tmp/ghostlight-mcp`; `kill -9` the window when done; never share a save dir with another chat.
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 4.5, 5.2, 5.3_

- [x] 15. Final verification pass
  - Run `tsc --noEmit` over `mcp/` and `vitest run`; confirm the replay regression and the property test pass, the contract-sharing guard holds, and the `drascula` MCP entry lists and drives on replay. Confirm no file under `engine/` was touched and the only `.kiro/settings/mcp.json` change is the `drascula` entry.
  - _Requirements: 1.1, 2.1, 3.1, 5.3, 7.3, 8.2, 9.1, 10.2, 10.3_
