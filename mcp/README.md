# drascula-mcp

A stdio MCP server that exposes Drascula as tools, so an agent (Kiro while
testing), the Playwright checks, and later the survey crew can play the game
through the engine's own command set. Each verb becomes one tool; a call issues
the command and returns the parsed `A11Y_DIFF` or room state as JSON.

It is a thin wrapper over one shared contract: the command serialiser and the
A11Y line parser are **imported** from `../src/engine/` (`adapter.ts`,
`a11y-lines.ts`), never copied, so the player, the tests and this server cannot
drift.

## Transports

The server runs over two interchangeable transports behind one interface:

- **replay** (default) — plays the recorded fixtures in
  `../tests/engine/fixtures/`, so the server works and is testable before the
  native engine build exists. Select with `DRASCULA_MCP_TRANSPORT=replay`
  (default) and `DRASCULA_MCP_FIXTURE=<name>` (default `tavern`).
- **native** — spawns the native ScummVM build from `scripts/build-engine.sh`
  under its own save path `/tmp/ghostlight-mcp`, with `--subtitles`. Select with
  `DRASCULA_MCP_TRANSPORT=native`. Requires a built `vendor/scummvm/scummvm`.

## Run

```sh
npm --prefix mcp install
npm --prefix mcp start        # stdio server, replay transport
npm --prefix mcp test         # vitest (mcp/vitest.config.ts only)
```

Registered in the workspace MCP config (`.kiro/settings/mcp.json`) as
`drascula`, defaulting to the replay transport.
