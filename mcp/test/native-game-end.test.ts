// The last chapter ends: `use 9 56` settles on A11Y_GAME_END (no diff comes),
// and the engine exiting afterwards is expected, not an error.
import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  pid = 4321;
  kill = vi.fn();
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
import type { NativeConfig } from "../src/config.js";
const config: NativeConfig = {
  binary: "b",
  gamePath: "g",
  extraPath: "e",
  savePath: "/tmp/ghostlight-mcp-test",
};
const ROOM =
  'A11Y {"chapter":6,"room":60,"hero":{"x":1,"y":1},"objects":[],"inventory":[9],"flags":[0]}';
const END =
  'A11Y_GAME_END {"cmd":"use 9 56","said":[{"color":"white","text":"THE END."}]}';
describe("NativeTransport game end", () => {
  beforeEach(() => {
    fakeChild = new FakeChild();
  });
  it("settles use 9 56 on the game end, and the later exit is not an error", async () => {
    const t = new NativeTransport(config, () => {});
    const started = t.start();
    fakeChild.err(ROOM);
    await started;
    const sent = t.send({ verb: "use", item: 9, target: 56 });
    fakeChild.err("A11Y_CMD use 9 56");
    fakeChild.err(END);
    const result = await sent;
    expect(result.error).toBeUndefined();
    expect(result.ended?.said).toEqual([{ color: "white", text: "THE END." }]);
    // The engine exits by itself after the credits.
    fakeChild.emit("exit", 0);
    // Any later command gets a clear "game ended" answer, not a hang or busy-skip.
    const after = await t.send({ verb: "look", target: 56 });
    expect(after.error).toMatch(/game has ended/);
    await expect(t.snapshot()).rejects.toThrow(/game has ended/);
  });
  it("fails a pending command at once if the engine exits without ending", async () => {
    const t = new NativeTransport(config, () => {});
    const started = t.start();
    fakeChild.err(ROOM);
    await started;
    const sent = t.send({ verb: "look", target: 56 });
    fakeChild.err("A11Y_CMD look 56");
    fakeChild.emit("exit", 1);
    const result = await sent;
    expect(result.error).toMatch(/exited/);
  });
});
