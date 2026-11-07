// drascula-mcp server entrypoint (Requirement 1).
//
// Reads config, constructs the chosen transport factory and the session,
// registers every tool, and connects a stdio transport. All logging goes to
// stderr; stdout carries only MCP protocol traffic, so the stdio stream is
// never corrupted (Req 1.5). A transport that cannot be initialised makes the
// process exit with the named error (Req 1.4).

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { resolveConfig, type Config } from "./config.js";
import { NativeTransport } from "./native.js";
import { ReplayTransport } from "./replay.js";
import { Session } from "./session.js";
import { Tools, registerTools } from "./tools.js";
import type { Transport } from "./transport.js";

/** Log to stderr only — stdout is reserved for the MCP protocol (Req 1.5). */
function log(message: string): void {
  process.stderr.write(`[drascula-mcp] ${message}\n`);
}

/**
 * Build the per-session transport factory for the selected kind. The replay
 * transport validates its fixture at construction, and the native config's
 * binary presence is checked in resolveConfig, so a bad selection has already
 * failed before this runs (Req 1.4).
 */
function transportFactory(config: Config): () => Transport {
  if (config.transport === "replay") {
    return () => new ReplayTransport(config.fixture);
  }
  return () => new NativeTransport(config.native);
}

async function main(): Promise<void> {
  let config: Config;
  try {
    config = resolveConfig();
  } catch (e) {
    log(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }

  log(
    `starting (transport=${config.transport}` +
      (config.transport === "replay" ? `, fixture=${config.fixture}` : "") +
      ")",
  );

  const session = new Session();
  const tools = new Tools(session, transportFactory(config));

  // Kill any spawned engine when the process goes down, so a disconnect or
  // crash never orphans a native child (Req 4.5). stop() is safe with no
  // session and harmless on the replay transport.
  const shutdown = () => {
    void session.stop();
  };
  process.on("SIGINT", () => {
    shutdown();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    shutdown();
    process.exit(0);
  });
  process.on("exit", shutdown);

  const server = new McpServer({ name: "drascula", version: "0.1.0" });
  registerTools(server, tools);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log("connected over stdio; tools are ready.");
}

main().catch((e) => {
  log(`fatal: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
