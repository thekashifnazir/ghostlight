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
    { num: 53, name: "DRUNKARD", rect: [178, 52, 25, 60], walkTo: [153, 115], visible: true, door: false },
    { num: 105, name: "DOOR", rect: [206, 44, 28, 39], walkTo: [220, 116], visible: true, door: true, toRoom: 63 },
  ],
  inventory: [28],
  flags: new Array(50).fill(0),
};

/** Records every command it is sent, so a test can assert "nothing was sent". */
class RecordingTransport implements Transport {
  readonly sent: Command[] = [];
  async start(): Promise<RoomState> {
    return room62;
  }
  async send(cmd: Command): Promise<CommandResult> {
    this.sent.push(cmd);
    return { events: [{ type: "diff", diff: { cmd: "x", changed: false } }], diff: { cmd: "x", changed: false } };
  }
  async stop(): Promise<void> {}
}

async function started(): Promise<{ tools: Tools; transport: RecordingTransport }> {
  const transport = new RecordingTransport();
  const tools = new Tools(new Session(), () => transport);
  await tools.start();
  return { tools, transport };
}

describe("Tools target validation (task 7)", () => {
  it("rejects a target not in the current room and sends nothing", async () => {
    const { tools, transport } = await started();
    const r = await tools.targetVerb("look", 999);
    expect(r.isError).toBe(true);
    expect((r.data as { error: string }).error).toMatch(/target 999 is not a hotspot/);
    expect(transport.sent).toHaveLength(0);
  });

  it("passes validation for a target present in the room (and sends it)", async () => {
    const { tools, transport } = await started();
    const r = await tools.targetVerb("look", 52);
    expect(r.isError).toBe(false);
    expect(transport.sent).toEqual([{ verb: "look", target: 52 }]);
  });

  it("use accepts a held item, the hero (50), and an in-room hotspot", async () => {
    const { tools, transport } = await started();
    expect((await tools.use(28, 50)).isError).toBe(false); // on self
    expect((await tools.use(28, 105)).isError).toBe(false); // on a hotspot
    expect(transport.sent).toHaveLength(2);
  });

  it("use rejects a target that is neither hotspot, held item, nor hero, and sends nothing", async () => {
    const { tools, transport } = await started();
    const r = await tools.use(28, 777);
    expect(r.isError).toBe(true);
    expect((r.data as { error: string }).error).toMatch(/use target 777/);
    expect(transport.sent).toHaveLength(0);
  });

  it("every target verb rejects an absent number", async () => {
    const { tools, transport } = await started();
    for (const verb of ["look", "take", "open", "close", "talk", "push", "walk"] as const) {
      const r = await tools.targetVerb(verb, 4242);
      expect(r.isError).toBe(true);
    }
    expect(transport.sent).toHaveLength(0);
  });
});
