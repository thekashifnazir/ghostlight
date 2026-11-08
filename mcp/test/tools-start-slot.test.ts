import { describe, expect, it } from "vitest";

import { Session } from "../src/session.js";
import { Tools } from "../src/tools.js";
import type { Command, CommandResult, RoomState, Transport } from "../src/transport.js";

// The start tool advertised a `slot` argument (schemas.start) but ignored it:
// Tools.start took no argument, so the only way to load a save was
// DRASCULA_MCP_SLOT at launch. start now takes an optional slot and passes it
// to the transport factory, which loads that save (Req 6.2). These tests pin
// that the slot reaches the factory, and that start with no slot passes
// undefined (game start), using a fake factory that records what it received.

const room62: RoomState = {
  chapter: 1,
  room: 62,
  hero: { x: 65, y: 145 },
  objects: [],
  inventory: [],
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
    return room62;
  }
  async stop(): Promise<void> {}
}

/** Build Tools whose factory records every slot it is asked to build with. */
function makeTools() {
  const slots: (number | undefined)[] = [];
  const tools = new Tools(new Session(), (slot) => {
    slots.push(slot);
    return new FakeTransport();
  });
  return { tools, slots };
}

describe("Tools.start slot (start tool)", () => {
  it("passes the given slot to the transport factory", async () => {
    const { tools, slots } = makeTools();
    const reply = await tools.start(3);
    expect(reply.isError).toBe(false);
    expect(slots).toEqual([3]);
  });

  it("passes undefined when no slot is given (game start)", async () => {
    const { tools, slots } = makeTools();
    await tools.start();
    expect(slots).toEqual([undefined]);
  });

  it("allows slot 0", async () => {
    const { tools, slots } = makeTools();
    await tools.start(0);
    expect(slots).toEqual([0]);
  });
});
