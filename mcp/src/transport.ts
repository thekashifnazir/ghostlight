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
  /** End the session and release resources. Safe to call with no session (Req 4.4). */
  stop(): Promise<void>;
}
