// A room state between commands updates the session's room (tester report,
// 18 Nov). When a conversation ends and the game then moves the hero (passing
// the room 18 test puts you in room 17), the engine emits the new room's state
// just after the `choose` diff has settled, with no command waiting. The native
// transport used to drop every line between commands, so the session kept room
// 18 and refused the next `walk 177` as "not a hotspot in the current room"
// until a `state` snapshot. Now the transport passes that room state on and the
// session tracks it.

import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  pid = 4321;
  kill = vi.fn();
  /** Push a whole line on stderr (where A11Y lines appear). */
  err(line: string): void {
    this.stderr.emit("data", Buffer.from(line + "\n", "utf8"));
  }
}

let fakeChild: FakeChild;
vi.mock("node:child_process", () => ({ spawn: () => fakeChild }));
vi.mock("node:fs", () => ({
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  rmSync: vi.fn(),
  writeSync: vi.fn(),
}));

const { NativeTransport } = await import("../src/native.js");
const { Session } = await import("../src/session.js");
import type { NativeConfig } from "../src/config.js";

const config: NativeConfig = {
  binary: "vendor/scummvm/scummvm",
  gamePath: "vendor/game/drascula",
  extraPath: "vendor/scummvm/dists/engine-data",
  savePath: "/tmp/ghostlight-mcp-test",
};

const room = (n: number, objects: number[]) =>
  `A11Y {"chapter":2,"room":${n},"hero":{"x":128,"y":136},"objects":[${objects
    .map((o) => `{"num":${o},"name":"O${o}","rect":[0,0,10,10],"walkTo":[5,5],"visible":true,"door":true}`)
    .join(",")}],"inventory":[11],"flags":[0]}`;

describe("a room state between commands", () => {
  beforeEach(() => {
    fakeChild = new FakeChild();
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("moves the session to the room the engine reports after a choose settles", async () => {
    const session = new Session();
    const t = new NativeTransport(config, () => {});
    const started = session.start(t);
    fakeChild.err(room(18, [178, 55]));
    await started;
    expect(session.room?.room).toBe(18);

    // The test's last choice settles on its diff; then the game moves the hero
    // and the engine emits room 17's state with no command in flight.
    const sent = session.send({ verb: "choose", n: 2 });
    fakeChild.err("A11Y_CMD choose 2");
    fakeChild.err('A11Y_DIFF {"cmd":"choose 2","hero":{"x":146,"y":146},"invAdded":[{"id":19,"name":"one coin"}],"changed":true}');
    await sent;
    fakeChild.err(room(17, [176, 177]));

    expect(session.room?.room).toBe(17);
    expect(session.isTargetInRoom(177)).toBe(true);
    expect(session.isTargetInRoom(55)).toBe(false);
  });

  it("still ignores other stray lines between commands", async () => {
    const session = new Session();
    const t = new NativeTransport(config, () => {});
    const started = session.start(t);
    fakeChild.err(room(18, [178, 55]));
    await started;
    fakeChild.err('A11Y_DIFF {"cmd":"talk 55","changed":false}');
    expect(session.room?.room).toBe(18);
  });
});
