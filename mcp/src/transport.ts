// The one seam the tool layer depends on (Requirement 5.1).
//
// The player consumes the engine as a continuous event stream (EngineAdapter);
// an MCP tool call must instead resolve once, to a single reply. So the
// Transport interface is request/response: send(cmd) resolves when the command
// has settled (its single A11Y_DIFF, or an A11Y_ERR). The two implementations
// — native (the real engine) and replay (recorded fixtures) — are
// interchangeable, and the tool layer never knows which is active (Req 5.2).
//
// Crucially, this file defines NO contract types of its own. Command, the
// EngineEvent union, RoomState and Diff all come from src/engine/adapter.ts —
// the exact types the player uses — so the MCP server cannot drift from the
// engine or the player (Req 2.7, 3.7, 5.4). The contract-sharing guard test
// (task 12) defends this import against a future copy-paste.

import type {
  Choice,
  Command,
  Diff,
  EngineEvent,
  InvItem,
  RoomState,
} from "../../src/engine/adapter.js";

export type { Choice, Command, Diff, EngineEvent, InvItem, RoomState };

/**
 * Every parsed event one command produced, up to and including its diff or
 * error — the engine's full settled response to that command (Req 3.2). The
 * same shape comes back from both transports (Req 5.3), so a test passing
 * against replay exercises the contract the native engine must also meet.
 */
export interface CommandResult {
  /** Ordered EngineEvents: the cmd echo, any text/choices/inv/room, then diff/error. */
  events: EngineEvent[];
  /** The single diff, when the command settled with one. */
  diff?: Diff;
  /** The error message, when the command produced an A11Y_ERR (or timed out) instead. */
  error?: string;
  /**
   * Set when the command ended the whole game (`A11Y_GAME_END`): the last
   * chapter finished. `said` is the ending's spoken lines. The engine runs the
   * credits and exits on its own afterwards; that exit is expected, not an
   * error, and no further command will be answered.
   */
  ended?: { said: { color: string; text: string; voiced?: boolean }[] };
}

/**
 * The transport seam. Both `native` and `replay` implement this, and the tool
 * layer depends only on it.
 */
export interface Transport {
  /** Boot the game; resolve with the first room state (Req 4.1). */
  start(): Promise<RoomState>;
  /**
   * Issue one command; resolve when it has settled (diff or error). The result
   * carries every event the command produced, so no engine output is lost.
   */
  send(cmd: Command): Promise<CommandResult>;
  /**
   * Optional: send one already-serialised engine command line that is not in
   * the shared Command union (the Queen survey-only `room N`). Only the native
   * transport implements it; the replay transport has no such step.
   */
  sendRaw?(line: string): Promise<CommandResult>;
  /**
   * Ask the engine for a FRESH full room-state snapshot — the `state`/`dump`
   * command — and resolve with it. Unlike send(), this does not go through the
   * Command union (the player has no `state` verb); it drives the engine's own
   * snapshot command directly and returns the `A11Y { ... }` room-state line it
   * emits. The snapshot reflects the engine's live chapter, room, hero point,
   * objects, inventory and all flags at the moment it is taken, so a reader gets
   * current state rather than a session's folded approximation.
   *
   * Returns null when the transport cannot produce a fresh snapshot (the replay
   * transport replays a fixed script with no `state` step), so the caller falls
   * back to the room it already tracks.
   */
  snapshot(): Promise<RoomState | null>;
  /** End the session and release resources. Safe to call with no session (Req 4.4). */
  stop(): Promise<void>;
}
