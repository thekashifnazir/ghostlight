// `state` returns a FRESH engine snapshot, not a stale folded room.
//
// Regression (Crew surveyor): the `state` tool used to answer from the
// session's tracked room (session.currentRoom). That room is folded from each
// command's diff — it follows room changes and inventory deltas — but the
// session never re-reads the engine's flags or hero point, so after a command
// that only flipped a flag or moved the hero (no room change) the tracked flags
// stayed at their last full-snapshot value and looked stale.
//
// The fix makes `state` drive the engine's own `state`/`dump` command through a
// new Transport.snapshot(), which re-emits the full room state (chapter, room,
// hero, objects, inventory and ALL flags), and returns that live snapshot.
//
// Two levels are covered:
//   * Tools.state() asks the session for a fresh snapshot and returns it, even
//     when the tracked (folded) room disagrees — proving it no longer answers
//     from the stale tracked room.
//   * NativeTransport.snapshot() drives the engine's `state` command against a
//     fake child and settles on the fresh A11Y room-state line (ignoring the
//     trailing changed:false diff), returning that RoomState.

import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Session } from "../src/session.js";
import { Tools } from "../src/tools.js";
import type {
  Command,
  CommandResult,
  RoomState,
  Transport,
} from "../src/transport.js";

// --- Tools.state freshness ---------------------------------------------------

const STALE_FLAGS = new Array(50).fill(0);
const FRESH_FLAGS = new Array(50).fill(0);
FRESH_FLAGS[0] = 1; // the engine flipped flag 0 (e.g. talk 52) since the fold.

const trackedRoom: RoomState = {
  chapter: 1,
  room: 62,
  hero: { x: 65, y: 145 },
  objects: [
    { num: 52, name: "BARTENDER", rect: [113, 50, 39, 34], walkTo: [113, 121], visible: true, door: false },
  ],
  inventory: [28],
  flags: STALE_FLAGS,
};

// The live engine snapshot: same room, but flag 0 set and the hero moved. This
// is what the `state`/`dump` command re-emits; the folded tracked room never
// picked up either change (a flag-only, no-room-change command).
const freshSnapshot: RoomState = {
  ...trackedRoom,
  hero: { x: 120, y: 150 },
  flags: FRESH_FLAGS,
};

/**
 * A transport whose folded room (returned by start) carries STALE flags, but
 * whose snapshot() returns the FRESH live state. If `state` answered from the
 * tracked room it would show stale flags; it must show the snapshot's.
 */
class StaleVsFreshTransport implements Transport {
  async start(): Promise<RoomState> {
    return trackedRoom;
  }
  async send(_cmd: Command): Promise<CommandResult> {
    // A flag-only diff the session does NOT fold into currentRoom.flags.
    return {
      events: [{ type: "diff", diff: { cmd: "talk 52", changed: true, flags: { "0": [0, 1] } } }],
      diff: { cmd: "talk 52", changed: true, flags: { "0": [0, 1] } },
    };
  }
  async snapshot(): Promise<RoomState | null> {
    return freshSnapshot;
  }
  async stop(): Promise<void> {}
}

describe("Tools.state returns a fresh engine snapshot", () => {
  it("shows the engine's live flags and hero, not the stale tracked room", async () => {
    const tools = new Tools(new Session(), () => new StaleVsFreshTransport());
    await tools.start();

    // A flag-only command settles; the session's tracked room keeps stale flags
    // (it folds room/inventory deltas, not flags). talk 52 is a valid room-52
    // target, so it reaches the transport.
    await tools.targetVerb("talk", 52);

    const reply = await tools.state();
    expect(reply.isError).toBe(false);
    const room = reply.data as RoomState;
    // The fresh snapshot's flag 0 is set; the stale tracked room had it at 0.
    expect(room.flags[0]).toBe(1);
    // And the hero point is the live one, not the tracked room's.
    expect(room.hero).toEqual({ x: 120, y: 150 });
  });
});

// --- NativeTransport.snapshot drives the engine `state` command --------------

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  pid = 5555;
  kill = vi.fn();
  emitLine(line: string): void {
    this.stdout.emit("data", Buffer.from(line + "\n", "utf8"));
  }
}

let fakeChild: FakeChild;

vi.mock("node:child_process", () => ({
  spawn: () => fakeChild,
}));

vi.mock("node:fs", () => ({
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  rmSync: vi.fn(),
  writeSync: vi.fn(),
}));

const { NativeTransport } = await import("../src/native.js");
import type { NativeConfig } from "../src/config.js";

const nativeConfig: NativeConfig = {
  binary: "vendor/scummvm/scummvm",
  gamePath: "vendor/game/drascula",
  extraPath: "vendor/scummvm/dists/engine-data",
  savePath: "/tmp/ghostlight-mcp-test",
};

const START_ROOM =
  'A11Y {"chapter":1,"room":62,"hero":{"x":65,"y":145},"objects":[],"inventory":[28],"flags":[0]}';

// The engine's `state` command re-emits the full room state with the live flag
// (flag 0 now 1) and hero, then a trailing changed:false diff.
const FRESH_ROOM =
  'A11Y {"chapter":1,"room":62,"hero":{"x":120,"y":150},"objects":[],"inventory":[28],"flags":[1]}';

describe("NativeTransport.snapshot drives the engine state command", () => {
  beforeEach(() => {
    fakeChild = new FakeChild();
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("settles on the fresh A11Y room-state line and returns it", async () => {
    const logs: string[] = [];
    const t = new NativeTransport(nativeConfig, (line) => logs.push(line));
    const started = t.start();
    fakeChild.emitLine(START_ROOM);
    await started;

    const snap = t.snapshot();
    // The engine echoes the state command, re-emits the room state, then a diff.
    fakeChild.emitLine("A11Y_CMD state");
    fakeChild.emitLine(FRESH_ROOM);
    fakeChild.emitLine('A11Y_DIFF {"cmd":"state","changed":false}');
    const room = await snap;

    expect(room.chapter).toBe(1);
    expect(room.room).toBe(62);
    expect(room.hero).toEqual({ x: 120, y: 150 });
    expect(room.flags[0]).toBe(1);
    // It logged the snapshot and that it settled on a room line.
    expect(logs.some((l) => l.startsWith('snapshot "state"'))).toBe(true);
    expect(logs.some((l) => l.includes("room (chapter 1, room 62)"))).toBe(true);
  });

  it("the trailing changed:false diff is ignored and does not wedge the slot", async () => {
    const t = new NativeTransport(nativeConfig, () => {});
    const started = t.start();
    fakeChild.emitLine(START_ROOM);
    await started;

    const snap = t.snapshot();
    fakeChild.emitLine("A11Y_CMD state");
    fakeChild.emitLine(FRESH_ROOM);
    fakeChild.emitLine('A11Y_DIFF {"cmd":"state","changed":false}');
    await snap;

    // A following command runs fine (the pending slot was cleared by the room
    // settle; the stray diff between commands did not jam it).
    const sent = t.send({ verb: "inventory" });
    fakeChild.emitLine("A11Y_CMD inventory");
    fakeChild.emitLine('A11Y_DIFF {"cmd":"inventory","changed":false}');
    const result = await sent;
    expect(result.diff?.cmd).toBe("inventory");
  });
});
