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
import type { GameId } from "./config.js";
import type { Command, RoomState, Transport } from "./transport.js";

/** The engine target verbs that act on a single hotspot number (Req 2.3). */
export const TARGET_VERBS = [
  "look",
  "take",
  "open",
  "close",
  "talk",
  "push",
  "walk",
] as const;
export type TargetVerb = (typeof TARGET_VERBS)[number];

/**
 * The target verbs that may act on a held inventory item as well as a room
 * hotspot. The engine accepts held items as targets for look/take/open/close/
 * push (engine task 11); walk and talk only make sense on a room hotspot, so
 * they stay room-only.
 */
const ITEM_TARGET_VERBS: ReadonlySet<TargetVerb> = new Set([
  "look",
  "take",
  "open",
  "close",
  "push",
]);

/** The hero object number: `use <item> 50` and acting on self (Req 2.4). */
const HERO = 50;

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
    private readonly makeTransport: (slot?: number) => Transport,
    private readonly game: GameId = "drascula",
  ) {}

  // --- session lifecycle (Req 4) --------------------------------------------

  /**
   * Start a new game session. On the native transport an optional `slot` loads
   * that saved game so the session begins partway through (Req 6.2). The slot
   * is passed to the transport factory, which overrides the launch config's
   * slot with it; the replay transport ignores it (fixtures have no slot).
   */
  async start(slot?: number): Promise<ToolReply> {
    try {
      const room = await this.session.start(this.makeTransport(slot));
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

  // --- state (Req 3.5): a fresh snapshot from the engine --------------------

  /**
   * Return the current room state by taking a FRESH snapshot from the engine —
   * the engine's own `state`/`dump` command, which re-emits the full room state
   * (chapter, room, hero, objects, inventory and all flags). The session's
   * tracked room folds room/inventory diffs but never re-reads the engine's
   * flags or hero point, so after a command that only flipped a flag or moved
   * the hero the tracked flags would be stale; driving the engine's snapshot
   * returns the live state instead. On the replay transport (no `state` step to
   * drive) the session falls back to the tracked room, so `state` still answers.
   */
  async state(): Promise<ToolReply> {
    const guard = this.requireSession();
    if (guard) return guard;
    try {
      const room = await this.session.snapshot();
      if (!room) return err("no room state is known yet.");
      return ok(room satisfies RoomState);
    } catch (e) {
      return err(`state failed: ${messageOf(e)}`);
    }
  }

  // --- target validation before send (Req 8) --------------------------------

  /**
   * Reject a target that is neither present in the current room nor (for the
   * item-capable verbs) a held inventory item, BEFORE any command reaches the
   * transport (Req 8.2). Validity is judged against the current room only, so a
   * target valid in a previous room is rejected after a room change (Req 8.4).
   * Returns an error reply to send back, or null when valid.
   *
   * The session guard runs first, so by the time validation is reached a room
   * is known (Req 8.5); the defensive `room == null` branch keeps this total.
   */
  private rejectBadTarget(verb: TargetVerb, target: number): ToolReply | null {
    if (this.session.isTargetInRoom(target)) return null;
    // look/take/open/close/push also accept a currently held item (Req 8.3,
    // engine task 11); walk and talk stay room-only.
    const allowHeld = ITEM_TARGET_VERBS.has(verb);
    if (allowHeld && this.session.heldItemIds().includes(target)) return null;
    const room = this.session.room;
    const present = (room?.objects ?? []).map((o) => o.num);
    const held = this.session.heldItemIds();
    const message = allowHeld
      ? `target ${target} is neither a hotspot in the current room nor a held item ` +
        `(chapter ${room?.chapter ?? "?"}, room ${room?.room ?? "?"}).`
      : `target ${target} is not a hotspot in the current room ` +
        `(chapter ${room?.chapter ?? "?"}, room ${room?.room ?? "?"}).`;
    return err(
      message,
      allowHeld
        ? { room: room?.room, validTargets: present, heldItems: held }
        : { room: room?.room, validTargets: present },
    );
  }

  /**
   * A `use` target is valid if it is an in-room hotspot, the id of a currently
   * held item, or the hero (50, "use item on self") — Req 8.3, 2.4.
   */
  private rejectBadUseTarget(target: number): ToolReply | null {
    if (target === HERO) return null;
    if (this.session.isTargetInRoom(target)) return null;
    if (this.session.heldItemIds().includes(target)) return null;
    const room = this.session.room;
    return err(
      `use target ${target} is neither a hotspot in the current room, a held ` +
        `item, nor the hero (50).`,
      {
        room: room?.room,
        validTargets: (room?.objects ?? []).map((o) => o.num),
        heldItems: this.session.heldItemIds(),
      },
    );
  }

  // --- command verbs: guard, validate, then send (Req 2, 3) -----------------

  /**
   * A target verb on a hotspot number. look/take/open/close/push also accept a
   * currently held inventory item as the target (Req 8.3); walk and talk stay
   * room-only.
   */
  async targetVerb(verb: TargetVerb, target: number): Promise<ToolReply> {
    const guard = this.requireSession();
    if (guard) return guard;
    const bad = this.rejectBadTarget(verb, target);
    if (bad) return bad;
    return this.dispatch({ verb, target });
  }

  /** `use <item> <target>` — target is a hotspot, a held item, or 50 (self). */
  async use(item: number, target: number): Promise<ToolReply> {
    const guard = this.requireSession();
    if (guard) return guard;
    const bad = this.rejectBadUseTarget(target);
    if (bad) return bad;
    return this.dispatch({ verb: "use", item, target });
  }

  /** `choose <n>` — a conversation option (1 to 4). No target to validate. */
  async choose(n: number): Promise<ToolReply> {
    const guard = this.requireSession();
    if (guard) return guard;
    return this.dispatch({ verb: "choose", n });
  }

  /** `skip` — end the current speech line or cutscene. */
  async skip(): Promise<ToolReply> {
    const guard = this.requireSession();
    if (guard) return guard;
    return this.dispatch({ verb: "skip" });
  }

  /**
   * `inventory` — return the held items (ids, names, look text) from the
   * A11Y_INV event the command produces (Req 3.3). On the engine the command is
   * `inv`/`inventory` (both accepted); the shared serialiser emits `inventory`.
   */
  async inventory(): Promise<ToolReply> {
    const guard = this.requireSession();
    if (guard) return guard;
    const result = await this.session.send({ verb: "inventory" });
    if (result.error) return err(result.error, { events: result.events });
    const inv = result.events.find((e) => e.type === "inv");
    const items = inv && inv.type === "inv" ? inv.items : [];
    return ok({ items, diff: result.diff });
  }

  /** `choices` — return the current conversation choices (Req 3.4). */
  async choices(): Promise<ToolReply> {
    const guard = this.requireSession();
    if (guard) return guard;
    const result = await this.session.send({ verb: "choices" });
    if (result.error) return err(result.error, { events: result.events });
    const ev = result.events.find((e) => e.type === "choices");
    const choices = ev && ev.type === "choices" ? ev.choices : [];
    return ok({ choices, diff: result.diff });
  }

  /** `save <slot>` — save the game; return the saved slot (Req 3.6). */
  async save(slot: number): Promise<ToolReply> {
    const guard = this.requireSession();
    if (guard) return guard;
    const result = await this.session.send({ verb: "save", slot });
    if (result.error) return err(result.error, { events: result.events });
    const saved = result.events.find((e) => e.type === "saved");
    return ok({ slot: saved && saved.type === "saved" ? saved.slot : slot });
  }

  /**
   * `room N` - survey-only jump to a room (Queen only; needs GHOSTLIGHT_SURVEY=1,
   * which the native transport sets for Queen). For Drascula this returns a
   * clear error and sends nothing to the engine.
   */
  async room(n: number): Promise<ToolReply> {
    if (this.game !== "queen") {
      return err(
        "room is survey-only and Queen only; this server is driving Drascula " +
          "(set GHOSTLIGHT_GAME=queen). Nothing was sent.",
      );
    }
    const guard = this.requireSession();
    if (guard) return guard;
    if (!Number.isInteger(n) || n < 0) {
      return err(`room number must be a non-negative integer, got ${n}.`);
    }
    try {
      const result = await this.session.sendRaw(`room ${n}`);
      if (result.error) return err(result.error, { events: result.events });
      return ok({ diff: result.diff, events: result.events });
    } catch (e) {
      return err(`room failed: ${messageOf(e)}`);
    }
  }

  /**
   * Send a validated command and shape the reply. The full CommandResult
   * (events + diff) is returned so no engine output is lost (Req 3.1, 3.2); an
   * engine A11Y_ERR (no diff) comes back error-flagged with the message and the
   * events, leaving the session usable (Req 3.8).
   */
  private async dispatch(cmd: Command): Promise<ToolReply> {
    const result = await this.session.send(cmd);
    if (result.error) return err(result.error, { events: result.events });
    if (result.ended) {
      return ok({
        ended: true,
        message:
          "The game ended. The credits are playing and the engine will exit on " +
          "its own; that exit is expected, not an error. Call stop when done.",
        said: result.ended.said,
        events: result.events,
      });
    }
    return ok({ diff: result.diff, events: result.events });
  }
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
  room: { n: z.number().int().nonnegative() },
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
    async ({ slot }) => reply(await tools.start(slot)),
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
        "Takes a fresh snapshot from the engine's own `dump`/`state` command, so flags and hero are live.",
      inputSchema: schemas.empty,
    },
    async () => reply(await tools.state()),
  );

  // Target verbs: one tool each, same { target } schema (Req 2.1, 2.3).
  const verbDescriptions: Record<TargetVerb, string> = {
    look: "Look at / examine the hotspot with the given number in the current room.",
    take: "Take (pick up) the hotspot with the given number.",
    open: "Open the hotspot with the given number (e.g. a door or container).",
    close: "Close the hotspot with the given number.",
    talk: "Talk to the person with the given number; opens a conversation (see the choices tool).",
    push: "Push the hotspot with the given number.",
    walk: "Walk to the hotspot with the given number; on a door, walk through it.",
  };
  for (const verb of TARGET_VERBS) {
    server.registerTool(
      verb,
      {
        description:
          `${verbDescriptions[verb]} Returns the resulting A11Y diff and events as JSON. ` +
          `Rejects a target not present in the current room.`,
        inputSchema: schemas.target,
      },
      async ({ target }) => reply(await tools.targetVerb(verb, target)),
    );
  }

  server.registerTool(
    "use",
    {
      description:
        "Use an inventory item on a target. `target` is a room hotspot number, " +
        "an inventory item id, or 50 to use the item on the hero (self). Returns the A11Y diff and events.",
      inputSchema: schemas.use,
    },
    async ({ item, target }) => reply(await tools.use(item, target)),
  );

  server.registerTool(
    "inventory",
    {
      description:
        "List the items currently carried (id, name, look text). The engine command is `inv`/`inventory`.",
      inputSchema: schemas.empty,
    },
    async () => reply(await tools.inventory()),
  );

  server.registerTool(
    "choices",
    {
      description: "List the current conversation's choices (1 to 4). Call during a talk conversation.",
      inputSchema: schemas.empty,
    },
    async () => reply(await tools.choices()),
  );

  server.registerTool(
    "choose",
    {
      description: "Choose conversation option `n` (1 to 4); 4 typically ends the conversation.",
      inputSchema: schemas.choose,
    },
    async ({ n }) => reply(await tools.choose(n)),
  );

  server.registerTool(
    "skip",
    {
      description: "Skip the current speech line or cutscene.",
      inputSchema: schemas.empty,
    },
    async () => reply(await tools.skip()),
  );

  server.registerTool(
    "save",
    {
      description: "Save the game to the given slot; returns the saved slot.",
      inputSchema: schemas.save,
    },
    async ({ slot }) => reply(await tools.save(slot)),
  );

  server.registerTool(
    "room",
    {
      description:
        "Survey-only: jump to room N (sends `room N`). Queen only, and the engine " +
        "needs GHOSTLIGHT_SURVEY=1 (the native transport sets it). For Drascula " +
        "this returns an error and sends nothing.",
      inputSchema: schemas.room,
    },
    async ({ n }) => reply(await tools.room(n)),
  );
}
