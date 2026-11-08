import { describe, expect, it } from "vitest";

import { Session } from "../src/session.js";
import { Tools } from "../src/tools.js";
import type { Command, CommandResult, RoomState, Transport } from "../src/transport.js";

const room62: RoomState = {
  chapter: 1,
  room: 62,
  hero: { x: 65, y: 145 },
  objects: [
    { num: 52, name: "BARTENDER", rect: [113, 50, 39, 34], walkTo: [113, 121], visible: true, door: false },
  ],
  inventory: [28],
  flags: new Array(50).fill(0),
};

class FakeTransport implements Transport {
  async start(): Promise<RoomState> {
    return room62;
  }
  async send(_cmd: Command): Promise<CommandResult> {
    return { events: [] };
  }
  async snapshot(): Promise<RoomState | null> {
    // The `state` tool takes a fresh snapshot; return the live room state.
    return room62;
  }
  async stop(): Promise<void> {}
}

function makeTools(): Tools {
  return new Tools(new Session(), () => new FakeTransport());
}

describe("Tools lifecycle (task 6)", () => {
  it("state before start returns the start-first error", async () => {
    const reply = await makeTools().state();
    expect(reply.isError).toBe(true);
    expect((reply.data as { error: string }).error).toMatch(/start tool first/);
  });

  it("start returns the first room state; state then returns a fresh snapshot", async () => {
    const tools = makeTools();
    const started = await tools.start();
    expect(started.isError).toBe(false);
    expect((started.data as RoomState).room).toBe(62);

    const state = await tools.state();
    expect(state.isError).toBe(false);
    expect((state.data as RoomState).room).toBe(62);
    expect((state.data as RoomState).chapter).toBe(1);
  });

  it("stop returns { stopped: true } and is safe with no session", async () => {
    const tools = makeTools();
    const r = await tools.stop();
    expect(r.isError).toBe(false);
    expect(r.data).toEqual({ stopped: true });
  });
});
