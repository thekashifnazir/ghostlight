import { describe, expect, it } from "vitest";
import { Session } from "../src/session.js";
import { Tools } from "../src/tools.js";
import type { CommandResult, Transport } from "../src/transport.js";
import type { RoomState } from "../src/transport.js";

const ROOM = {
  chapter: 6,
  room: 60,
  hero: { x: 1, y: 1 },
  objects: [
    { num: 56, name: "DRACULA", rect: [0, 0, 1, 1], walkTo: [0, 0], visible: true, door: false },
  ],
  inventory: [9],
  flags: [0],
} as unknown as RoomState;

class EndingTransport implements Transport {
  async start() {
    return ROOM;
  }
  async send(): Promise<CommandResult> {
    return { events: [], ended: { said: [{ color: "white", text: "THE END." }] } };
  }
  async snapshot() {
    return null;
  }
  async stop() {}
}

describe("Tools: the game ending", () => {
  it("use 9 56 returns a settled, non-error result that says the game ended", async () => {
    const tools = new Tools(new Session(), () => new EndingTransport());
    await tools.start();
    const r = await tools.use(9, 56);
    expect(r.isError).toBe(false);
    const data = r.data as { ended: boolean; message: string; said: { text: string }[] };
    expect(data.ended).toBe(true);
    expect(data.message).toMatch(/expected, not an error/);
    expect(data.said[0].text).toBe("THE END.");
  });
});
