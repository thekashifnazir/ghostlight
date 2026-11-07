# Design: Drascula MCP server

## Overview

`drascula-mcp` is a small TypeScript stdio MCP server in `mcp/` that turns the game into tools. An MCP client (Kiro, Playwright, the survey crew) connects over stdio, discovers one tool per engine command plus `start`/`stop`, and plays the game by calling them. Each call issues a command and returns the parsed result — an `A11Y_DIFF`, a `RoomState`, inventory, or choices — as JSON.

The server is deliberately thin. It owns three things only:

1. the **tool layer** (MCP wiring, argument schemas, target validation),
2. a **session** that holds the active transport and the current room state, and
3. two **transports** — `native` (the real engine) and `replay` (recorded fixtures) — behind one interface.

Everything about the *contract* — what a command looks like on the wire, and how an engine line decodes to a typed event — is imported from `src/engine/`, never re-implemented:

- `serializeCommand`, the `Command` type, and the event/state types from `src/engine/adapter.ts`;
- `parseA11yLine` from `src/engine/a11y-lines.ts`.

This is the whole point of the spec: the player, the tests and the MCP server share one encode/decode path, so none can drift from the engine. The `ReplayAdapter` in `src/engine/replay-adapter.ts` already drives a recorded log through exactly this contract; the replay transport reuses that same logic rather than writing a second one.

### Where the code lives

```
mcp/
  package.json            # own manifest; @modelcontextprotocol/sdk, tsx/vitest
  tsconfig.json
  src/
    server.ts             # entrypoint: build the MCP server, pick transport, connect stdio
    tools.ts              # one tool per command + start/stop; schemas; validation
    session.ts            # holds the active transport + current room state
    transport.ts          # the Transport interface + the parsed-events result type
    native.ts             # NativeTransport: spawn the engine, command file, stderr markers
    replay.ts             # ReplayTransport: fixtures via src/engine replay logic
    config.ts             # transport selection + native launch config from env/flags
  test/
    replay.test.ts        # replay returns the recorded tavern.cmd diffs
    validation.test.ts    # property test: every tool rejects an out-of-room target
.kiro/settings/mcp.json   # one "drascula" entry (created/updated, not clobbered)
```

Nothing under `engine/` is created, edited, or deleted. `src/engine/` is imported read-only; `tests/engine/fixtures/` is read read-only.

### Design principles

- **Import the contract, never copy it.** The command serialiser and the A11Y parser come from `src/engine/`. If the engine contract changes, the player, the tests and this server move together (Requirement 2.7, 3.7, 5.4).
- **One interface, two transports.** The tool layer talks to a `Transport`. `native` and `replay` are interchangeable; the tools never know which is active (Requirement 5).
- **Markers, not sleeps.** The native transport decides a command has settled by watching the engine's own log markers (`A11Y_CMD` echo → single `A11Y_DIFF`/`A11Y_ERR`), with a hard 60 s cap. No fixed sleeps (Requirement 6.5, 6.6).
- **Validate before sending.** A target not in the current room is rejected in the tool layer before any byte reaches the transport, so a bad hotspot number fails fast and identically on both transports (Requirement 8).
- **Fail loud at the edges.** A missing binary, a missing fixture, or a command before `start` returns a clear message; it never hangs (Requirement 1.4, 4.3).

## Architecture

```
          MCP client (Kiro / Playwright / survey crew)
                         │  stdio (JSON-RPC)
                         ▼
   ┌──────────────────────────────────────────────── mcp/ ─────────────────┐
   │  server.ts                                                             │
   │    McpServer (@modelcontextprotocol/sdk) ── StdioServerTransport        │
   │                         │ registers                                     │
   │  tools.ts               ▼                                               │
   │    look/take/open/close/talk/push/walk/use/inventory/choices/choose/    │
   │    skip/save/state  + start/stop                                        │
   │      │ validate target against current room (Req 8)                      │
   │      │ build Command, serializeCommand()  ◄── import src/engine/adapter  │
   │      ▼                                                                   │
   │  session.ts  (holds transport + current RoomState)                      │
   │      │ send(Command) : Promise<CommandResult>                            │
   │      ▼                                                                   │
   │  transport.ts  interface Transport { start, send, stop }                │
   │      ├── native.ts   NativeTransport                                     │
   │      │     spawn vendor/scummvm/scummvm --savepath=/tmp/ghostlight-mcp   │
   │      │       --subtitles [load slot] ...                                 │
   │      │     write /tmp/ghostlight-mcp/a11y-cmd.txt                        │
   │      │     read stderr lines ─► parseA11yLine ─► wait markers (≤60 s)     │
   │      └── replay.ts   ReplayTransport                                     │
   │            load tests/engine/fixtures/<name>.json|.cmd                   │
   │            drive through src/engine ReplayAdapter logic                  │
   │                         │ both parse with                                │
   │                         ▼                                                │
   │   parseA11yLine  ◄── import src/engine/a11y-lines                        │
   └────────────────────────────────────────────────────────────────────────┘
```

## Components

### Transport interface (`transport.ts`)

The one seam the tool layer depends on. It mirrors the player's `EngineAdapter` but is request/response rather than event-stream, because an MCP tool call is a single request that must resolve to a single reply.

```ts
import type { Command, EngineEvent, RoomState } from "../../src/engine/adapter.js";

/** Every parsed event one command produced, up to and including its diff/error. */
export interface CommandResult {
  /** The ordered EngineEvents from this command (cmd echo, text, choices, inv, diff/error). */
  events: EngineEvent[];
  /** The single diff, if the command settled with one. */
  diff?: Extract<EngineEvent, { type: "diff" }>["diff"];
  /** The error message, if the command produced an A11Y_ERR instead of a diff. */
  error?: string;
}

export interface Transport {
  /** Boot the game; resolve with the first room state. */
  start(): Promise<RoomState>;
  /** Issue one command; resolve when it has settled (diff or error). */
  send(cmd: Command): Promise<CommandResult>;
  /** End the session and release resources. Safe to call with no session. */
  stop(): Promise<void>;
}
```

`EngineEvent`, `Command`, `RoomState`, `Diff` etc. are the exact types from `src/engine/adapter.ts`; the server adds no parallel types for the contract.

### Session (`session.ts`)

Holds the single active `Transport` and the latest `RoomState`, and is the only place the tool layer gets either. Responsibilities:

- Own the `Transport | null` (null before `start`).
- Track `currentRoom: RoomState | null`, updated from `start`, from any room-change diff (`diff.room`/`diff.objects` present), and from a `state` call.
- `isTargetInRoom(num)`, `heldItemIds()` helpers used by validation (Req 8).
- On `start`, stop any existing session first (Req 4.2); expose `send` and `stop` that delegate to the transport and keep `currentRoom` in step.

Keeping `currentRoom` from the diff matters: a `walk` that changes room carries the new room's `objects[]` in the diff (see the engine design and `tavern.json`), so the session refreshes `currentRoom` from that without an extra `state` round-trip.

### Tool layer (`tools.ts`)

Registers every tool on the `McpServer`. Each tool:

1. declares a Zod/JSON input schema (SDK `registerTool`),
2. for game-playing tools, checks a session exists (else "call start first", Req 4.3),
3. for target tools, validates the target against `session.currentRoom` (Req 8) **before** building a command,
4. builds a `Command` and calls `session.send()`,
5. shapes `CommandResult` into the tool's JSON reply.

Tool table:

| Tool | Args | Command built | Returns |
|---|---|---|---|
| `start` | `{ slot?: number }` (native only) | — | first `RoomState` |
| `stop` | — | — | `{ stopped: true }` |
| `look`/`take`/`open`/`close`/`talk`/`push`/`walk` | `{ target: int }` | `{ verb, target }` | `CommandResult` (diff + events) |
| `use` | `{ item: int, target: int }` | `{ verb: "use", item, target }` | `CommandResult` |
| `inventory` | — | `{ verb: "inventory" }` | parsed `inv` items |
| `choices` | — | `{ verb: "choices" }` | current choices |
| `choose` | `{ n: 1..4 }` | `{ verb: "choose", n }` | `CommandResult` |
| `skip` | — | `{ verb: "skip" }` | `CommandResult` |
| `save` | `{ slot: int }` | `{ verb: "save", slot }` | saved slot |
| `state` | — | — (reads session room) | current `RoomState` |

`use` on self is `target: 50` (the hero), per the engine's object-50 convention and the player's `Command` type (Req 2.4).

Each tool returns its JSON as the MCP tool-result content. An `A11Y_ERR` result sets the MCP result's `isError` flag and carries the message (Req 3.8), while leaving the session alive.

#### Command-name aliasing (Req 2.8)

The on-the-wire form is whatever `serializeCommand` from `src/engine/adapter.ts` emits — the server never assembles a command line itself. There is one known naming seam to document, not to patch here:

- the player's `serializeCommand` emits `inventory`, while the engine command file and the fixtures use `inv`;
- the engine uses `dump`/`state` for a room-state snapshot, which the server answers from `session.currentRoom` via the `state` tool rather than sending a command.

The tool descriptions note these aliases so a human reading the tool list understands the mapping. The serialiser is the single source of truth for the bytes.

**Known gap (not a live bug).** `serializeCommand` emits `inventory`; the engine (`engine/a11y.cpp`) accepts BOTH `inventory` and `inv`, so the live player is correct. But the recorded `tavern.json` fixture stored the command as `inv`, so replaying the `inventory` tool against that fixture triggers `ReplayAdapter`'s command-match mismatch (`sent "inventory" … next recorded is "inv"`). The engine spec owns the fixtures, so this spec does not edit them; the replay regression test (task 10) skips the inventory step with a comment pointing here, and it is logged as a known gap. Nothing in `src/engine/` or the fixtures is changed. If the fixture is ever re-recorded with `inventory`, the skip can be removed.

### Native transport (`native.ts`)

Spawns and drives the real engine.

- **Spawn.** `child_process.spawn` of `vendor/scummvm/scummvm` with the arguments the build script documents:
  `--path=vendor/game/drascula --extrapath=vendor/scummvm/dists/engine-data --savepath=/tmp/ghostlight-mcp --subtitles drascula`, plus the load-slot args when a `slot` is given (Req 6.1, 6.2). The binary path, game path and extrapath come from `config.ts` (env-overridable) with these defaults.
- **Own save path.** `/tmp/ghostlight-mcp`, created on start, so the MCP session never shares `a11y-cmd.txt` or a save directory with the engine-spec or player chats (Req 6.3, process-log parallel-chats rule). The command file is `/tmp/ghostlight-mcp/a11y-cmd.txt`.
- **Read path.** Attach to the child's `stderr`, split into lines, run each through `parseA11yLine`. Buffer partial lines across chunks.
- **Settling by markers.** `send(cmd)` writes the serialised line to the command file, then waits on the line stream for the engine's own markers: the `A11Y_CMD <command>` echo, then collect every event until the single `A11Y_DIFF` (success) or an `A11Y_ERR` (failure). Interleaved `A11Y_TEXT`/`A11Y_CHOICES`/`A11Y`/`A11Y_INV`/`A11Y_SAVED`/further `A11Y_CMD skip` lines are accumulated into `CommandResult.events` (Req 3.2). No `setTimeout(sleep)` gates settling.
- **Hard cap.** A single 60 s timer per `send`. If it fires before a diff/error, resolve the call with a timeout `CommandResult.error` and keep the child alive so the caller can `stop` (Req 6.6).
- **Subtitles guard.** If the engine emits an `A11Y_ERR` about subtitles at boot (or boot never reaches a room), surface it as a start error (Req 6.7).
- **Teardown.** `stop()` sends `SIGTERM`, then `SIGKILL` if the child ignores it (ScummVM ignores SIGTERM in a window — process-log note), and removes only the command file (`a11y-cmd.txt`). It never deletes the save files in `/tmp/ghostlight-mcp`: the `--save-slot` start path (Req 6.2) needs them to begin a session partway through. A `process.on("exit")` / signal handler kills a still-running child so a server crash never orphans the engine (Req 4.5).

Why markers and a cap, not sleeps: a conversation or a chapter-crossing cutscene can take many seconds and a variable amount of time; the engine signals completion by emitting exactly one `A11Y_DIFF` once it has settled (engine design, "Settling"). Waiting for that marker is correct where any fixed sleep is either too short (truncates a cutscene reply) or wastefully long. The 60 s cap is the backstop for a wedged engine.

> The native transport is written against the documented engine contract and the build script, but the native build and the full `A11Y_CMD`/`A11Y_DIFF` emission are produced by the engine-a11y-layer spec, which is still in progress. Until that build exists, the native transport is exercised only by starting against a present binary; the behavioural tests run on the replay transport (below), which returns the identical JSON shape (Req 5.3). This is called out so the native path is not mistaken for verified end-to-end here.

### Replay transport (`replay.ts`)

Plays the recorded fixtures so the server works today (Req 7).

- **Load.** A fixture name (default `tavern`) selects `tests/engine/fixtures/<name>`. The fixtures exist in two shapes: `tavern.cmd` (a command script with `#` comments) and `tavern.json` (the golden transcript with `startRaw` + per-step `raw[]` lines). The replay transport uses the recorded **log** form: it reconstructs the raw A11Y line stream from the fixture and drives it through the same logic as `src/engine/replay-adapter.ts`'s `ReplayAdapter`.
- **Reuse, don't re-write.** `ReplayAdapter` already: parses every line with `parseA11yLine`, emits up to the first room on `start`, and on each `send(Command)` matches the next recorded `A11Y_CMD` against `serializeCommand(cmd)` and emits through the next diff, surfacing a quoted mismatch error otherwise (Req 7.3, 7.4). The replay transport adapts that event-stream adapter to the request/response `Transport` interface by subscribing a collector around each `send` and resolving when the diff (or error) arrives. It constructs the `ReplayAdapter` from the fixture's raw lines, so the shared parser validates the fixture on load (Req 7.5).
- **First room.** `start()` returns the `room` event the `ReplayAdapter` emits first, as `RoomState` (Req 7.2).
- **Mismatch.** If a tool sends a command the fixture did not record next, the `ReplayAdapter` emits a `{ type: "error" }` quoting both sides; the transport returns it as `CommandResult.error` (Req 7.4).

Because the replay transport is a thin adapter over the already-tested `ReplayAdapter`, the "one contract" guarantee is literal: the exact code the player uses to replay a log is what answers MCP tool calls in replay mode.

#### Fixture → raw-line stream

`tavern.json` stores `startRaw` and each step's `raw: string[]` — these are the literal engine lines. The transport concatenates `startRaw` + every step's `raw` lines (in order) into one newline-delimited blob and hands it to `new ReplayAdapter(blob)`. That blob is exactly what a live stderr capture would have looked like, so `ReplayAdapter` drives it unchanged. (The `.cmd` file is the command script a native run would send; replay does not need it, since the `.json` already carries both the commands — as `A11Y_CMD` lines — and their responses.)

### Config (`config.ts`)

Resolves, from environment variables and/or CLI flags, with safe defaults:

- `transport`: `"replay"` (default) or `"native"` — `DRASCULA_MCP_TRANSPORT` / `--transport` (Req 1.3).
- `fixture`: replay fixture name, default `"tavern"` — `DRASCULA_MCP_FIXTURE`.
- native launch: binary, game path, extrapath, savepath (default `/tmp/ghostlight-mcp`), optional default slot — `DRASCULA_MCP_SCUMMVM`, `DRASCULA_MCP_GAME`, `DRASCULA_MCP_EXTRA`, etc.

No secret is read or printed; config references values by name (Req 1.6, 9.4). An unresolvable transport (native binary absent, fixture missing) throws at startup with a message naming the cause (Req 1.4).

## MCP registration (`.kiro/settings/mcp.json`)

Create the file if absent, or add/update only the `drascula` entry if it exists, leaving any other entries untouched (Req 9.1, 9.2):

```jsonc
{
  "mcpServers": {
    "drascula": {
      "command": "npx",
      "args": ["tsx", "mcp/src/server.ts"],
      "env": { "DRASCULA_MCP_TRANSPORT": "replay" },
      "disabled": false,
      "autoApprove": ["start", "state", "look", "inventory", "choices"]
    }
  }
}
```

Replay is the default so the entry starts cleanly on a machine with no native build (Req 9.3). Switching to the real engine is a one-line `env` change to `native` (plus a built `vendor/scummvm/scummvm`). No key appears in the entry (Req 9.4). The exact launcher (`npx tsx` vs a prebuilt `node dist/server.js`) is settled in tasks against what `mcp/package.json` provides; the shape above is the intent.

## Data shapes

The server invents no contract types. Tool replies are the imported types serialised as JSON:

- `start` / `state` → `RoomState` (`src/engine/adapter.ts`).
- target-verb / `use` / `choose` / `skip` → `CommandResult` = `{ events: EngineEvent[]; diff?: Diff; error?: string }`.
- `inventory` → `{ items: InvItem[] }` (from the `inv` event).
- `choices` → `{ choices: Choice[] }`.
- `save` → `{ slot: number }` (from the `saved` event).

A target-validation rejection and a "start first" rejection are returned as MCP errors (thrown in the tool handler / `isError` result), not as a `CommandResult`, so they are distinguishable from an engine `A11Y_ERR` (Req 8.2, 4.3 vs 3.8).

## Testing strategy

Tests live in `mcp/test/` and run under the repo's `vitest`. They use the **replay** transport, so they are real and runnable before the native build exists, and they assert the shared contract the native engine must also meet (Req 5.3).

1. **Replay returns the recorded diffs (`replay.test.ts`, Req 7.3).** Load the `tavern` fixture, `start`, then drive the server tools in the fixture's recorded command order (the sequence in `tavern.cmd` / the `tavern.json` steps: `dump`→`state`, `look 102`, `talk 53`, `choose 2`, `choose 4`, `walk 105`, `talk 52`, `walk 105`+`skip`, `look 999`). Assert each tool returns the recorded parsed diff/events for that step — in particular that `talk 53` returns the four choices, `talk 52` returns the `flags {"0":[0,1]}` progress change with `changed: true`, the chapter-crossing `walk 105` returns `chapter [1,2]`, `room [62,14]` with the new objects, and `look 999` returns an engine-error result. This is the spec's "replay transport returns the recorded diffs for `tavern.cmd`".

2. **Property test: every tool rejects an out-of-room target (`validation.test.ts`, Req 8).** With a started replay session in a known room (room 62 from the tavern fixture, whose object numbers are {52,53,54,100..106}), use `fast-check` (already a dev dependency) to generate integers that are **not** present in the current room, and assert that every target-verb tool (`look`/`take`/`open`/`close`/`talk`/`push`/`walk`) and the `use` tool's `target` reject such a number with a target error and send nothing to the transport. The generator is constrained to the complement of the current room's hotspot numbers (and, for `use`, also excluding held item ids and `50`). A companion positive check confirms a valid in-room target is *not* rejected by validation (it then follows the fixture's own order or returns a replay mismatch, which is a transport outcome, not a validation one), so the test pins the validation boundary exactly.

3. **Contract-sharing guard.** A small assertion that the server imports `serializeCommand` and `parseA11yLine` from `src/engine/` (no local redefinition), so a future refactor that copies them instead of importing them fails the test. This defends Req 2.7 / 3.7 / 5.4 mechanically.

Typecheck (`tsc --noEmit`) runs over `mcp/` as part of verification, since the imports from `src/engine/` must line up with the real exported types.

## Decisions and trade-offs

- **Request/response transport vs the player's event-stream adapter.** The player consumes a continuous event stream; an MCP tool call must resolve once. The `Transport` interface is therefore request/response, implemented by wrapping the event-stream `ReplayAdapter` (replay) and by a marker-driven collector (native). The decode/encode path is still the shared one; only the *shape of the await* differs, which is inherent to MCP.
- **Reuse `ReplayAdapter` rather than a new fixture reader.** `tests/engine/src/fixture.ts` has a `FixtureHarness`, but it lives under `tests/engine/` (another area) and speaks raw command strings, not `Command`s. Driving the fixture's raw lines through `src/engine/replay-adapter.ts` keeps the MCP server's dependency on *shared* code in `src/engine/`, and gets command-matching, mismatch errors and parsing for free.
- **Validation in the tool layer, not the transport.** Rejecting an out-of-room target before `send` means both transports behave identically and the replay fixture is not consulted for a target the room never had. It also makes the property test independent of fixture order.
- **Native not verified end-to-end here.** The native transport is written to the documented contract and the build script, but the engine build is another spec in progress. The design says so plainly; the behavioural guarantees are tested on replay, which the native engine must match.

## Open questions deferred

- Exact native launcher command in `mcp.json` (`npx tsx` vs prebuilt) — settled in tasks against `mcp/package.json`.
- Loading a save slot on the native transport is wired per the build script's save-path convention; the concrete ScummVM load-slot flag is confirmed against the native build when the engine spec lands, without changing the tool surface.
- A survey-crew-specific toolset or batching is out of scope here; the crew uses these same tools.
