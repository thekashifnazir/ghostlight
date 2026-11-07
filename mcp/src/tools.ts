// The tool layer (Requirements 2, 3, 4, 8).
//
// Registers one tool per engine command plus start/stop on an McpServer. The
// tool logic lives in a transport-agnostic `Tools` object so the replay and
// property tests can drive the exact same handlers the MCP server exposes,
// without a live stdio connection. `registerTools` is the thin MCP binding
// around it.
//
// Task split (one file, three commits):
//   - task 6: schemas, start/stop, the no-session guard, alias docs.
//   - task 7: target validation before send (added in this file by task 7).
//   - task 8: wiring command tools to the session + JSON shaping.
//
// The contract is imported, never copied: Command is from src/engine/adapter.ts
// (re-exported via transport.ts), and session.send() serialises with the shared
// serializeCommand. This layer builds Command values and shapes replies; it
// never assembles a command-file line itself.

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { Session } from "./session.js";
import type { RoomState, Transport } from "./transport.js";

/** A plain tool reply: JSON payload plus an error flag the MCP layer maps. */
export interface ToolReply {
  /** The JSON value returned to the caller (serialised as text content). */
  data: unknown;
  /** True when this reply represents an error (engine A11Y_ERR or a rejection). */
  isError: boolean;
}

function ok(data: unknown): ToolReply {
  return { data, isError: false };
}

function err(message: string, extra?: Record<string, unknown>): ToolReply {
  return { data: { error: message, ...extra }, isError: true };
}

/**
 * The transport-agnostic tool logic. Construct with a Session and a factory
 * that builds the configured Transport on each `start` (so a re-start gets a
 * fresh transport). Every method returns a ToolReply.
 */
export class Tools {
  constructor(
    private readonly session: Session,
    private readonly makeTransport: () => Transport,
  ) {}

  // --- session lifecycle (Req 4) --------------------------------------------

  async start(): Promise<ToolReply> {
    try {
      const room = await this.session.start(this.makeTransport());
      return ok(room satisfies RoomState);
    } catch (e) {
      return err(`start failed: ${messageOf(e)}`);
    }
  }

  async stop(): Promise<ToolReply> {
    await this.session.stop();
    return ok({ stopped: true });
  }

  // --- the no-session guard (Req 4.3) ---------------------------------------

  /** Returns a "call start first" error reply when no session is running. */
  private requireSession(): ToolReply | null {
    if (!this.session.isStarted) {
      return err("no game session; call the start tool first.");
    }
    return null;
  }

  // --- state (Req 3.5): answered locally from the tracked room --------------

  /**
   * Return the current room state. The engine's snapshot command is `dump`/
   * `state`; the server answers it from the session's tracked room rather than
   * sending a command, so it is cheap and always current (alias documented on
   * the tool).
   */
  state(): ToolReply {
    const guard = this.requireSession();
    if (guard) return guard;
    const room = this.session.room;
    if (!room) return err("no room state is known yet.");
    return ok(room satisfies RoomState);
  }

  // Command tools (the verbs that send) are wired to the session in task 8;
  // task 7 inserts target validation ahead of that send. requireSession() is
  // the single guard every game tool runs first.
}

/** Narrow an unknown thrown value to a message string. */
export function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Zod raw-shape input schemas for the tools, shared by registration. */
export const schemas = {
  start: { slot: z.number().int().nonnegative().optional() },
  target: { target: z.number().int() },
  use: { item: z.number().int(), target: z.number().int() },
  choose: { n: z.number().int().min(1).max(4) },
  save: { slot: z.number().int().nonnegative() },
  empty: {},
} as const;

/**
 * Bind the Tools logic to an McpServer as discoverable MCP tools (Req 1.2).
 * Each handler returns MCP content; an error reply sets isError. The command
 * tools are registered in task 8; here we wire start/stop and the schemas so
 * the surface is discoverable.
 */
export function registerTools(
  server: McpServer,
  tools: Tools,
): void {
  const reply = (r: ToolReply) => ({
    content: [{ type: "text" as const, text: JSON.stringify(r.data, null, 2) }],
    isError: r.isError,
  });

  server.registerTool(
    "start",
    {
      description:
        "Start a new Drascula game session and return the first room state as JSON. " +
        "On the native transport, an optional `slot` loads a saved game to begin partway through.",
      inputSchema: schemas.start,
    },
    async () => reply(await tools.start()),
  );

  server.registerTool(
    "stop",
    {
      description: "Stop the current game session and release its resources. Safe to call with no session.",
      inputSchema: schemas.empty,
    },
    async () => reply(await tools.stop()),
  );

  server.registerTool(
    "state",
    {
      description:
        "Return the current room state as JSON (chapter, room, hero, objects, inventory, flags). " +
        "Answered from the tracked room; the engine's own snapshot command is `dump`/`state`.",
      inputSchema: schemas.empty,
    },
    async () => reply(tools.state()),
  );

  // The sending command tools (look/take/open/close/talk/push/walk/use/
  // inventory/choices/choose/skip/save) are registered in task 8, once the
  // Tools logic wires them to the session.
}
