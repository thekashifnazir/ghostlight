// Reading pause: the player asks the engine to hold after each voiced line
// (`readpause on|off`, sent when D is on) so the screen reader can finish it.
import { describe, expect, it } from "vitest";
import { serializeCommand, type Command, type EngineEvent } from "../src/engine/adapter.js";
import { ReplayAdapter } from "../src/engine/replay-adapter.js";
import { Narrator, type NarratorLive } from "../src/ui/narrator.js";

describe("serializeCommand readpause", () => {
  it("serialises on and off", () => {
    expect(serializeCommand({ verb: "readpause", on: true })).toBe("readpause on");
    expect(serializeCommand({ verb: "readpause", on: false })).toBe("readpause off");
  });
});

describe("readpause on the replay adapter", () => {
  it("is ignored: no error, nothing consumed from the recording", async () => {
    const log = [
      'A11Y {"chapter":1,"room":62,"hero":{"x":1,"y":1},"objects":[],"inventory":[],"flags":[]}',
      "A11Y_CMD state",
    ].join("\n");
    const adapter = new ReplayAdapter(log);
    const events: EngineEvent[] = [];
    adapter.onEvent((e) => events.push(e));
    await adapter.start();
    const before = events.length;
    const cmd: Command = { verb: "readpause", on: true };
    adapter.send(cmd);
    expect(events.length).toBe(before);
    expect(events.some((e) => e.type === "error")).toBe(false);
  });
});

describe("a readpause settle diff", () => {
  it("never says 'Nothing happened.'", () => {
    const lines: string[] = [];
    const live: NarratorLive = { announce: (t) => void lines.push(t) };
    const narrator = new Narrator(live);
    for (const cmd of ["readpause on", "readpause off"]) {
      const diff = { cmd, changed: false };
      narrator.maybeNothingHappened(diff, narrator.said(diff));
    }
    expect(lines).toEqual([]);
  });
});
