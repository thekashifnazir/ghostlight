# Requirements: Drascula MCP server

## Introduction

The Drascula MCP server exposes the game as a set of Model Context Protocol tools, so an agent (Kiro while testing), the Playwright checks, and later the survey crew can play Drascula through the engine's own command set. Each verb the engine understands becomes one tool; calling a tool issues the command and returns the parsed result — an `A11Y_DIFF` or a room-state snapshot — as JSON. The agent never reads pixels and never hand-writes the command file; it calls tools and reads structured replies.

The server is a thin, honest wrapper over the same contract the player already uses. The command set, the serialisation of a command to the engine's command-file line, and the parse of an `A11Y` line into a typed event all live in `src/engine/` (`adapter.ts`, `a11y-lines.ts`). The MCP server **imports** them; it never copies them. That way the player, the tests and the MCP server share one contract and cannot drift.

Because the engine a11y layer spec is still in progress, the server runs over two interchangeable transports behind one interface:

- **native** — spawns the native ScummVM build produced by `scripts/build-engine.sh`, drives it through the command file, and reads `A11Y` lines off stderr. This is the real engine.
- **replay** — plays the recorded fixtures in `tests/engine/fixtures/`, so the server works and is testable today, before the native build is wired and before the engine spec finishes.

Scope is the MCP server package in `mcp/` and the single registration entry in `.kiro/settings/mcp.json`. The engine patch, the player page, the pack and the fixtures themselves are other specs. This spec owns only `mcp/` and the one `mcp.json` entry; it never edits anything under `engine/`.

Requirements use EARS (Easy Approach to Requirements Syntax). Terms:

- **MCP server**: the TypeScript stdio process in `mcp/` built on the official MCP SDK (`@modelcontextprotocol/sdk`), exposing the game as tools.
- **tool**: one MCP tool. Most tools map to one engine command; `start` and `stop` manage the session.
- **transport**: the thing that actually runs the game behind a common interface — `native` (the real engine) or `replay` (recorded fixtures).
- **command**: a `Command` value from `src/engine/adapter.ts`, serialised to a command-file line by that module's `serializeCommand`.
- **diff**: the `A11Y_DIFF` result of one command, parsed by `parseA11yLine` from `src/engine/a11y-lines.ts` into a `Diff`.
- **room state**: the `A11Y` room-state snapshot, parsed into a `RoomState`.
- **current room**: the most recent `RoomState` the transport has reported, used to validate targets and answer `state`.
- **settled**: control has returned to the engine's main loop with walking finished, speech over, and any conversation or cutscene ended — the point at which the single `A11Y_DIFF` for a command has been emitted (as defined by the engine a11y layer design).

## Requirements

### Requirement 1: A stdio MCP server on the official SDK

**User story:** As an agent or test harness, I want a standard MCP stdio server, so that I can connect to it the same way I connect to any other MCP server and discover the tools it offers.

#### Acceptance criteria

1. THE MCP server SHALL be a TypeScript program in `mcp/` that communicates over stdio using the official MCP SDK (`@modelcontextprotocol/sdk`).
2. WHEN an MCP client connects THEN the server SHALL advertise its tools with names, descriptions, and JSON input schemas so the client can discover them without prior knowledge.
3. THE server SHALL select its transport from configuration (an environment variable and/or a command-line flag), defaulting to `replay` so it runs with no native build present.
4. WHERE the selected transport cannot be initialised (for example the native binary is missing, or no fixture is named) THE server SHALL fail to start with a clear diagnostic message naming the cause, rather than starting and erroring on every tool call.
5. THE server SHALL write only MCP protocol traffic to stdout; any logging or diagnostics SHALL go to stderr so they never corrupt the stdio protocol stream.
6. THE server SHALL NOT print, log, or otherwise emit the contents of `.env` or any API key.

### Requirement 2: One tool per engine command

**User story:** As an agent playing the game, I want one tool for each thing the engine can do, so that I can look, take, talk, walk, use items and so on by calling a named tool with simple arguments.

#### Acceptance criteria

1. THE server SHALL expose one tool for each engine command: `look`, `take`, `open`, `close`, `talk`, `push`, `walk`, `use`, `inventory`, `choices`, `choose`, `skip`, `save`, and `state`.
2. THE server SHALL additionally expose a `start` tool and a `stop` tool that begin and end a game session.
3. THE target-verb tools (`look`, `take`, `open`, `close`, `talk`, `push`, `walk`) SHALL take a single integer `target` argument, the engine hotspot number.
4. THE `use` tool SHALL take an integer `item` and an integer `target`, WHERE `target` is a room hotspot number, an inventory item id, or `50` to use the item on the hero (self); it SHALL support "use item on object" and "use item on self".
5. THE `choose` tool SHALL take a single integer `n` (the conversation option, 1 to 4), and the `save` tool SHALL take a single integer `slot`.
6. THE `inventory`, `choices`, `skip`, and `state` tools SHALL take no required arguments.
7. THE server SHALL build every command as a `Command` value and serialise it with `serializeCommand` imported from `src/engine/adapter.ts`, so the bytes written to the engine match exactly what the player sends; it SHALL NOT assemble command-file lines by hand.
8. WHERE the engine and player names for a command differ (for example the player's `serializeCommand` emits `inventory` while the engine's command file and fixtures use `inv`, and the engine uses `dump`/`state` for a room-state snapshot), the server SHALL rely on the shared serialiser for the on-the-wire form and document any tool-name alias in the tool description, so one contract governs both.

### Requirement 3: Every tool returns the parsed result as JSON

**User story:** As an agent, I want each tool call to return structured JSON — the diff or the room state — so that I can decide what to do next without parsing raw engine log lines.

#### Acceptance criteria

1. WHEN a target-verb, `use`, or `choose` tool call settles THEN the server SHALL return the single parsed `A11Y_DIFF` for that command as JSON.
2. WHEN a tool call produces interleaved text, choices, inventory, or room lines before the diff (for example a `talk` that opens choices, or a `walk` that crosses a room or chapter) THEN the server SHALL include those parsed events in the returned JSON alongside the diff, so no information the engine emitted is lost.
3. WHEN the `inventory` tool is called THEN the server SHALL return the parsed inventory items (ids, names, and look text).
4. WHEN the `choices` tool is called THEN the server SHALL return the current conversation choices.
5. WHEN the `state` tool is called THEN the server SHALL return the current `RoomState` as JSON.
6. WHEN the `save` tool call settles THEN the server SHALL return the saved slot.
7. THE server SHALL parse every engine line with `parseA11yLine` imported from `src/engine/a11y-lines.ts`, so its JSON matches the typed events the player consumes; it SHALL NOT re-implement line parsing.
8. WHEN a command cannot run and the engine emits an `A11Y_ERR` (no diff) THEN the server SHALL return the error message as a tool result marked as an error, and SHALL leave the session usable for the next call.

### Requirement 4: Session lifecycle through start and stop

**User story:** As an agent, I want explicit start and stop tools, so that I can boot a fresh game, play, and tear it down cleanly without leaking processes.

#### Acceptance criteria

1. WHEN the `start` tool is called THEN the server SHALL initialise the selected transport, boot the game to its first room, and return that first `RoomState` as JSON.
2. WHERE a session is already running WHEN `start` is called THE server SHALL stop the existing session before starting a new one, so a second `start` never leaves an orphaned process.
3. WHEN a game-playing tool is called before `start` THEN the server SHALL return a clear error telling the caller to call `start` first, rather than hanging or crashing.
4. WHEN the `stop` tool is called THEN the server SHALL end the session and release its resources (for the native transport, terminate the engine process and remove its command file), and SHALL be safe to call when no session is running.
5. WHEN the server process exits for any reason THEN it SHALL terminate any running native engine process it spawned, so a crash or disconnect does not leave the engine running.

### Requirement 5: Two transports behind one interface

**User story:** As a maintainer, I want the native engine and the recorded replay to sit behind one transport interface, so that the tool layer is written once and the same tools work before and after the engine spec finishes.

#### Acceptance criteria

1. THE server SHALL define one transport interface with `start()`, `send(command)`, and `stop()` operations, WHERE `send` returns the ordered parsed events a command produced up to and including its diff (or its error).
2. THE server SHALL provide a `native` transport and a `replay` transport, both implementing that interface, and the tool layer SHALL depend only on the interface, never on which transport is active.
3. THE `native` transport and the `replay` transport SHALL return the same JSON shape for the same command, so a test passing against replay exercises the contract the native engine must also meet.
4. THE server SHALL reuse the shared serialiser and parser in both transports, so neither transport can decode or encode the contract differently from the other or from the player.

### Requirement 6: The native transport spawns the real engine

**User story:** As a tester, I want the server to drive the real native ScummVM build, so that tool calls exercise the actual game, not a stand-in.

#### Acceptance criteria

1. THE `native` transport SHALL spawn the native ScummVM binary produced by `scripts/build-engine.sh`, launched with its own save path under `/tmp/ghostlight-mcp`, with `--subtitles`, and with the game and extra paths the build script documents.
2. THE `native` transport SHALL accept an optional save-slot argument and, when given, launch the engine so that it loads that slot, so a session can begin from a recorded point rather than the game start.
3. THE `native` transport SHALL send a command by writing the serialised line to the engine's command file under its save path (`/tmp/ghostlight-mcp`), never to a path shared with another chat or session.
4. THE `native` transport SHALL read `A11Y` lines from the engine's stderr and parse each with `parseA11yLine`.
5. THE `native` transport SHALL treat a command as settled by waiting for its log markers (the `A11Y_CMD` echo followed by the single `A11Y_DIFF` or an `A11Y_ERR`), and SHALL NOT use fixed-duration sleeps to decide that a command has settled.
6. THE `native` transport SHALL apply a hard cap of 60 seconds to waiting for a command to settle; WHEN the cap is reached THE transport SHALL return a timeout error for that call and leave the session in a state the caller can stop.
7. WHERE `--subtitles` is not in effect or the engine reports it is off THE `native` transport SHALL surface that as an error, because without subtitles the game draws no text (engine gotcha 1).

### Requirement 7: The replay transport plays recorded fixtures

**User story:** As a developer, I want a replay transport that plays the recorded fixtures, so that I can build and test the MCP server before the native engine is available.

#### Acceptance criteria

1. THE `replay` transport SHALL load a named fixture from `tests/engine/fixtures/` and expose its recorded run through the same transport interface as the native transport.
2. WHEN `start` is called on the `replay` transport THEN it SHALL return the fixture's recorded first `RoomState`.
3. WHEN a command is sent to the `replay` transport THEN it SHALL return the recorded parsed events for that step, up to and including the diff, exactly as recorded.
4. WHERE a command does not match the fixture's next recorded command THE `replay` transport SHALL return a clear mismatch error that quotes both the command sent and the fixture's next recorded command, rather than inventing engine behaviour.
5. THE `replay` transport SHALL run the recorded lines back through the shared `parseA11yLine`, so a fixture that violates the line contract fails rather than passing silently.

### Requirement 8: Reject targets that are not in the current room

**User story:** As an agent, I want the server to refuse a command whose target is not present in the current room, so that a mistyped or stale hotspot number fails fast with a clear message instead of producing confusing engine output.

#### Acceptance criteria

1. THE server SHALL track the current room state from the most recent `RoomState` (from `start`, from a room-change diff, or from `state`).
2. WHEN a target-verb tool (`look`, `take`, `open`, `close`, `talk`, `push`, `walk`) is called with a `target` that is not a hotspot number present in the current room THEN the server SHALL reject the call with an error naming the bad target and SHALL NOT send any command to the transport.
3. WHEN the `use` tool is called with a `target` that is neither a hotspot number in the current room, nor an id of a currently held inventory item, nor the hero (`50`) THEN the server SHALL reject the call with an error and SHALL NOT send any command to the transport.
4. THE validity of a target SHALL be judged against the current room state only; the server SHALL NOT treat a target valid in a previous room as valid after the room changes.
5. WHERE no room state is known yet (no session started) a target-verb or `use` call SHALL be rejected by the Requirement 4 "start first" rule before target validation is reached.

### Requirement 9: Registered as "drascula" in the workspace MCP config

**User story:** As a Kiro user, I want the server registered in the workspace MCP config, so that Kiro and the tests can launch and talk to it without extra setup.

#### Acceptance criteria

1. THE workspace MCP configuration at `.kiro/settings/mcp.json` SHALL contain exactly one server entry named `drascula` that launches this server over stdio.
2. THE `drascula` entry SHALL be the only part of `.kiro/settings/mcp.json` this spec creates or edits; WHERE the file already holds other entries, this spec SHALL add or update only the `drascula` entry and leave the rest untouched.
3. THE `drascula` entry SHALL default to the `replay` transport so it starts cleanly on a machine with no native build, with the native transport selectable through the documented configuration.
4. THE `drascula` entry SHALL NOT embed any API key; it SHALL reference configuration by name only.

### Requirement 10: Stay inside this spec's files

**User story:** As a developer sharing this working tree with the engine-spec chat, I want this spec to touch only its own files, so that the two chats never clobber each other's work.

#### Acceptance criteria

1. THE server source, package manifest, and tests SHALL live under `mcp/`.
2. THIS spec SHALL NOT create, edit, or delete any file under `engine/`.
3. THIS spec SHALL import from `src/engine/` (the shared contract) and read from `tests/engine/fixtures/` (the recorded runs) without modifying either.
4. WHEN committing, this spec SHALL stage and commit only its own explicit paths (`mcp/`, its spec folder, `.kiro/settings/mcp.json`, and its process-log and feature-table rows), never with a bulk `git add` and never touching the other chat's uncommitted work.
