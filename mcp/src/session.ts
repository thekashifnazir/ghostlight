// The session (Requirements 4, 8).
//
// Holds the single active Transport and the latest RoomState, and is the only
// place the tool layer gets either. It keeps `currentRoom` in step with the
// game so the tool layer can validate a target against the room the player is
// actually in (Req 8), and answer `state` without a round-trip to the engine.
//
// currentRoom is refreshed from three sources, matching the engine contract:
//  - start(): the first room-state the transport returns (Req 8.1);
//  - any room-change diff: a diff that carries `room`/`objects` is the engine
//    reporting a new room, and (per the engine design and tavern.json) it
//    includes the new room's full object list, so we rebuild from it without an
//    extra `state` call;
//  - setRoom(): the `state` tool writes the current room back here.
//
// The tracked inventory is kept current the same way: a full room state and an
// A11Y_INV line set it outright, and every diff's invAdded/invRemoved deltas
// are folded onto it, so held-item target validation stays correct after an
// item is picked up or used mid-room (not just on a room/state snapshot).

import type {
  CommandResult,
  Command,
  RoomState,
  Transport,
} from "./transport.js";

export class Session {
  private transport: Transport | null = null;
  private currentRoom: RoomState | null = null;

  /**
   * Start a fresh session on the given transport. If a session is already
   * running, stop it first so a second start never orphans the previous
   * transport (Req 4.2). Returns and records the first room state (Req 4.1, 8.1).
   */
  async start(transport: Transport): Promise<RoomState> {
    if (this.transport) {
      await this.stop();
    }
    this.transport = transport;
    const room = await transport.start();
    this.currentRoom = room;
    return room;
  }

  /** True once a transport has been started (and not stopped). */
  get isStarted(): boolean {
    return this.transport !== null;
  }

  /** The current room, or null before start. Read by the `state` tool. */
  get room(): RoomState | null {
    return this.currentRoom;
  }

  /**
   * Take a FRESH full snapshot from the engine (the `state`/`dump` command) and
   * record it as the current room, then return it. This is how the `state` tool
   * answers: the session's folded `currentRoom` tracks room/inventory deltas but
   * never re-reads the engine's flags or hero point, so after a command that
   * only flipped a flag or moved the hero (no room change) the tracked flags go
   * stale. Driving the engine's own snapshot replaces them with the live state.
   *
   * When the transport cannot snapshot (replay), fall back to the tracked room
   * so `state` still answers. Throws if no session is running (Req 4.3).
   */
  async snapshot(): Promise<RoomState | null> {
    const transport = this.requireTransport();
    const fresh = await transport.snapshot();
    if (fresh) this.currentRoom = fresh;
    return this.currentRoom;
  }

  /**
   * Send a command through the active transport and keep currentRoom in step:
   * a room-change diff (carrying the new room's `room` and `objects`) rebuilds
   * currentRoom from the diff, and every diff's inventory deltas are folded
   * into the tracked inventory. Throws if no session is running — the tool
   * layer turns that into the "call start first" error (Req 4.3).
   */
  async send(cmd: Command): Promise<CommandResult> {
    const transport = this.requireTransport();
    const result = await transport.send(cmd);
    this.applyRoomChange(result);
    this.applyInventory(result);
    return result;
  }

  /**
   * Send a raw engine command line (survey-only `room N`) and keep the tracked
   * room in step. Errors if the transport has no raw channel (replay).
   */
  async sendRaw(line: string): Promise<CommandResult> {
    const transport = this.requireTransport();
    if (!transport.sendRaw) {
      throw new Error("this transport cannot send raw engine commands (native only).");
    }
    const result = await transport.sendRaw(line);
    this.applyRoomChange(result);
    this.applyInventory(result);
    return result;
  }

  /**
   * Rebuild currentRoom when a diff reports a room change. The engine includes
   * the new room's full object list in that diff (engine design; tavern.json's
   * walk-105 crossing carries room [62,14] + 12 objects), so we can refresh
   * chapter/room/objects without a separate room-state line. Fields the diff
   * does not restate (hero, inventory, flags) are carried from the prior room;
   * a following `state`/room-state line, when present, supersedes them.
   */
  private applyRoomChange(result: CommandResult): void {
    // Prefer an explicit room-state event if the command produced one.
    const roomEvent = result.events.find((e) => e.type === "room");
    if (roomEvent && roomEvent.type === "room") {
      this.currentRoom = roomEvent.state;
      return;
    }
    const diff = result.diff;
    if (!diff || diff.room === undefined || !this.currentRoom) return;
    const [, toRoom] = diff.room;
    this.currentRoom = {
      ...this.currentRoom,
      room: toRoom,
      chapter: diff.chapter ? diff.chapter[1] : this.currentRoom.chapter,
      objects: diff.objects ?? this.currentRoom.objects,
    };
  }

  /**
   * Keep the tracked inventory in step with the game. A full room state carries
   * the complete `inventory`, but a diff carries only deltas: `invAdded` and
   * `invRemoved` item ids (a11y-diff is a sparse delta). An A11Y_INV line (the
   * `inventory` tool) restates the full held list. So: an explicit room-state
   * event already set the full inventory in applyRoomChange; an `inv` event
   * replaces the tracked inventory outright; otherwise fold each diff's
   * invAdded/invRemoved onto the running list. Without this, open 183 adds the
   * handbag (22) but open 22 is wrongly rejected as not held.
   */
  private applyInventory(result: CommandResult): void {
    if (!this.currentRoom) return;
    // A room-state event already carried the full inventory.
    if (result.events.some((e) => e.type === "room")) return;

    // An A11Y_INV line is the authoritative full held list; refresh from it.
    const invEvent = result.events.find((e) => e.type === "inv");
    if (invEvent && invEvent.type === "inv") {
      this.currentRoom = {
        ...this.currentRoom,
        inventory: invEvent.items.map((i) => i.id),
      };
      return;
    }

    // Otherwise fold the diff's inventory deltas onto the tracked list.
    const diff = result.diff;
    if (!diff) return;
    const added = diff.invAdded ?? [];
    const removed = diff.invRemoved ?? [];
    if (added.length === 0 && removed.length === 0) return;

    const removedIds = new Set(removed.map((i) => i.id));
    const held = this.currentRoom.inventory.filter((id) => !removedIds.has(id));
    for (const { id } of added) {
      if (!held.includes(id)) held.push(id);
    }
    this.currentRoom = { ...this.currentRoom, inventory: held };
  }

  /** Record the room the `state` tool observed, keeping validation current. */
  setRoom(room: RoomState): void {
    this.currentRoom = room;
  }

  /** Is `num` a hotspot present in the current room? Used by target validation. */
  isTargetInRoom(num: number): boolean {
    return (this.currentRoom?.objects ?? []).some((o) => o.num === num);
  }

  /** The ids of the items currently held, for `use`-target validation. */
  heldItemIds(): number[] {
    return this.currentRoom?.inventory ?? [];
  }

  /** Stop the active transport and clear the session. Safe with none (Req 4.4). */
  async stop(): Promise<void> {
    const transport = this.transport;
    this.transport = null;
    this.currentRoom = null;
    if (transport) await transport.stop();
  }

  private requireTransport(): Transport {
    if (!this.transport) {
      throw new Error("no game session; call the start tool first.");
    }
    return this.transport;
  }
}
