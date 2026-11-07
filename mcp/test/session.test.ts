import { describe, expect, it } from "vitest";

import { Session } from "../src/session.js";
import type {
  Command,
  CommandResult,
  RoomState,
  Transport,
} from "../src/transport.js";

/** A hand-driven transport: start returns a fixed room, send returns queued results. */
class FakeTransport implements Transport {
  stopped = false;
  private readonly queued: CommandResult[];
  constructor(
    private readonly startRoom: RoomState,
    queued: CommandResult[] = [],
  ) {
    this.queued = [...queued];
  }
  async start(): Promise<RoomState> {
    return this.startRoom;
  }
  async send(_cmd: Command): Promise<CommandResult> {
    const next = this.queued.shift();
    if (!next) throw new Error("FakeTransport: no queued result");
    return next;
  }
  async stop(): Promise<void> {
    this.stopped = true;
  }
}

const room62: RoomState = {
  chapter: 1,
  room: 62,
  hero: { x: 65, y: 145 },
  objects: [
    { num: 52, name: "BARTENDER", rect: [113, 50, 39, 34], walkTo: [113, 121], visible: true, door: false },
    { num: 105, name: "DOOR", rect: [206, 44, 28, 39], walkTo: [220, 116], visible: true, door: true, toRoom: 63 },
  ],
  inventory: [28],
  flags: new Array(50).fill(0),
};

describe("Session", () => {
  it("rejects send before start", async () => {
    const s = new Session();
    await expect(s.send({ verb: "look", target: 52 })).rejects.toThrow(/start tool first/);
    expect(s.isStarted).toBe(false);
    expect(s.room).toBeNull();
  });

  it("records the first room on start and exposes room helpers", async () => {
    const s = new Session();
    const room = await s.start(new FakeTransport(room62));
    expect(room.room).toBe(62);
    expect(s.isStarted).toBe(true);
    expect(s.isTargetInRoom(52)).toBe(true);
    expect(s.isTargetInRoom(999)).toBe(false);
    expect(s.heldItemIds()).toEqual([28]);
  });

  it("rebuilds currentRoom from a room-change diff (the walk-105 chapter crossing)", async () => {
    // The real tavern.json walk-105 diff: chapter [1,2], room [62,14], new objects.
    const crossing: CommandResult = {
      events: [
        { type: "cmd", cmd: "walk 105" },
        {
          type: "diff",
          diff: {
            cmd: "walk 105",
            chapter: [1, 2],
            room: [62, 14],
            objects: [
              { num: 159, name: "ESCALERA", rect: [4, 66, 36, 68], walkTo: [38, 128], visible: true, door: true, toRoom: 12 },
              { num: 162, name: "HABITACIONES", rect: [200, 39, 37, 49], walkTo: [238, 109], visible: true, door: true, toRoom: 16 },
              { num: 171, name: "DOOR", rect: [254, 47, 25, 57], walkTo: [245, 107], visible: true, door: true, toRoom: 15 },
            ],
            flags: { "0": [1, 0], "16": [0, 1], "17": [0, 1], "27": [0, 1] },
            changed: true,
          },
        },
      ],
      diff: {
        cmd: "walk 105",
        chapter: [1, 2],
        room: [62, 14],
        objects: [
          { num: 159, name: "ESCALERA", rect: [4, 66, 36, 68], walkTo: [38, 128], visible: true, door: true, toRoom: 12 },
          { num: 162, name: "HABITACIONES", rect: [200, 39, 37, 49], walkTo: [238, 109], visible: true, door: true, toRoom: 16 },
          { num: 171, name: "DOOR", rect: [254, 47, 25, 57], walkTo: [245, 107], visible: true, door: true, toRoom: 15 },
        ],
        changed: true,
      },
    };
    const s = new Session();
    await s.start(new FakeTransport(room62, [crossing]));
    await s.send({ verb: "walk", target: 105 });

    const room = s.room;
    expect(room?.chapter).toBe(2);
    expect(room?.room).toBe(14);
    // Validation now follows the NEW room, not the old one.
    expect(s.isTargetInRoom(162)).toBe(true); // HABITACIONES, a chapter-2 door
    expect(s.isTargetInRoom(105)).toBe(false); // the old tavern door is gone
  });

  it("stops the previous transport when started again, and stop() is idempotent", async () => {
    const s = new Session();
    const first = new FakeTransport(room62);
    await s.start(first);
    const second = new FakeTransport(room62);
    await s.start(second);
    expect(first.stopped).toBe(true);
    await s.stop();
    expect(second.stopped).toBe(true);
    await expect(s.stop()).resolves.toBeUndefined(); // safe with no session
  });
});
