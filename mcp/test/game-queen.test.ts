// Game 2: the server can drive Flight of the Amazon Queen as well as Drascula.
// Drascula's defaults must not move; Queen is opt-in with GHOSTLIGHT_GAME.
import { describe, expect, it } from "vitest";

import { resolveConfig } from "../src/config.js";
import { Session } from "../src/session.js";
import { Tools } from "../src/tools.js";
import type { Command, CommandResult, RoomState, Transport } from "../src/transport.js";

describe("game selection", () => {
  it("defaults to Drascula with the same paths as before", () => {
    const cfg = resolveConfig([], {});
    expect(cfg.game).toBe("drascula");
    expect(cfg.native.binary).toBe("vendor/scummvm/scummvm");
    expect(cfg.native.gamePath).toBe("vendor/game/drascula");
    expect(cfg.native.extraPath).toBe("vendor/scummvm/dists/engine-data");
  });

  it("reads the Drascula game path from DRASCULA_MCP_GAME in the env it is given", () => {
    const cfg = resolveConfig([], { DRASCULA_MCP_GAME: "/data/drascula" });
    expect(cfg.native.gamePath).toBe("/data/drascula");
  });

  it("still treats --game with a path as the game data path", () => {
    const cfg = resolveConfig(["--game=/data/drascula"], {});
    expect(cfg.game).toBe("drascula");
    expect(cfg.native.gamePath).toBe("/data/drascula");
  });

  it("selects Queen from GHOSTLIGHT_GAME or --game queen, with Queen's paths", () => {
    for (const cfg of [
      resolveConfig([], { GHOSTLIGHT_GAME: "queen" }),
      resolveConfig(["--game", "queen"], {}),
    ]) {
      expect(cfg.game).toBe("queen");
      expect(cfg.native.game).toBe("queen");
      expect(cfg.native.gamePath).toBe("vendor/game/queen");
      expect(cfg.native.extraPath).toBe("");
    }
  });

  it("refuses the native transport for Queen without a binary, naming the setting", () => {
    expect(() =>
      resolveConfig([], { GHOSTLIGHT_GAME: "queen", DRASCULA_MCP_TRANSPORT: "native" }),
    ).toThrow(/GHOSTLIGHT_QUEEN_BINARY/);
  });

  it("rejects an unknown game by name", () => {
    expect(() => resolveConfig([], { GHOSTLIGHT_GAME: "monkey" })).toThrow(/unknown game "monkey"/);
  });
});

const room1: RoomState = {
  chapter: 1,
  room: 1,
  hero: { x: 150, y: 130 },
  objects: [{ num: 6, name: "hatch", rect: [205, 38, 32, 63], walkTo: [206, 111], visible: true, door: false }],
  inventory: [],
  flags: [],
};

class RecordingTransport implements Transport {
  readonly sent: string[] = [];
  async start(): Promise<RoomState> {
    return room1;
  }
  async send(cmd: Command): Promise<CommandResult> {
    this.sent.push(JSON.stringify(cmd));
    return { events: [], diff: { cmd: "x", changed: false } };
  }
  async sendRaw(line: string): Promise<CommandResult> {
    this.sent.push(line);
    return { events: [], diff: { cmd: line, changed: true } };
  }
  async snapshot(): Promise<RoomState | null> {
    return room1;
  }
  async stop(): Promise<void> {}
}

describe("room tool (survey only)", () => {
  it("is refused for Drascula and sends nothing", async () => {
    const transport = new RecordingTransport();
    const tools = new Tools(new Session(), () => transport);
    await tools.start();
    const reply = await tools.room(3);
    expect(JSON.stringify(reply)).toMatch(/Queen only/);
    expect(transport.sent).toEqual([]);
  });

  it("sends `room N` for Queen", async () => {
    const transport = new RecordingTransport();
    const tools = new Tools(new Session(), () => transport, "queen");
    await tools.start();
    await tools.room(3);
    expect(transport.sent).toEqual(["room 3"]);
  });
});
