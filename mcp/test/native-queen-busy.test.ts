// Queen automation fixes: --talkspeed=255 for Queen only, and an
// `A11Y_ERR busy` (no A11Y_CMD echo) settles the in-flight command at once.
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
const spawnMock = vi.fn((..._a: unknown[]) => fakeChild);
vi.mock("node:child_process", () => ({ spawn: (...a: unknown[]) => spawnMock(...a) }));
vi.mock("node:fs", () => ({
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  rmSync: vi.fn(),
  writeSync: vi.fn(),
}));

const { NativeTransport } = await import("../src/native.js");
import type { NativeConfig } from "../src/config.js";

const ROOM =
  'A11Y {"chapter":1,"room":70,"hero":{"x":1,"y":1},"objects":[],"inventory":[],"flags":[0]}';

const base: NativeConfig = {
  binary: "b",
  gamePath: "g",
  extraPath: "e",
  savePath: "/tmp/ghostlight-mcp-test",
};

async function startedArgs(config: NativeConfig): Promise<string[]> {
  const t = new NativeTransport(config, () => {});
  const started = t.start();
  fakeChild.err(ROOM);
  await started;
  return spawnMock.mock.calls[0]![1] as string[];
}

describe("NativeTransport Queen automation", () => {
  beforeEach(() => {
    fakeChild = new FakeChild();
    spawnMock.mockClear();
  });

  it("passes --talkspeed=255 for queen and not for drascula", async () => {
    const queen = await startedArgs({ ...base, game: "queen", extraPath: "" });
    expect(queen).toContain("--talkspeed=255");

    fakeChild = new FakeChild();
    spawnMock.mockClear();
    const drascula = await startedArgs({ ...base, game: "drascula" });
    expect(drascula.some((a) => a.startsWith("--talkspeed"))).toBe(false);
  });

  it("settles an in-flight command as an error on A11Y_ERR busy, well under the cap", async () => {
    const t = new NativeTransport({ ...base, game: "queen", extraPath: "" }, () => {});
    const started = t.start();
    fakeChild.err(ROOM);
    await started;

    const began = Date.now();
    const sent = t.send({ verb: "look", target: 3 });
    fakeChild.err("A11Y_ERR busy: commands dropped");
    const result = await sent;

    expect(result.error).toMatch(/^busy/);
    expect(Date.now() - began).toBeLessThan(1000);
    // The slot is free: the next command is accepted, not "already in flight".
    const next = t.send({ verb: "look", target: 4 });
    fakeChild.err("A11Y_CMD look 4");
    fakeChild.err('A11Y_DIFF {"cmd":"look 4","changed":false}');
    expect((await next).error).toBeUndefined();
  });

  it("rejects a snapshot at once on A11Y_ERR busy, with the engine's message", async () => {
    const t = new NativeTransport({ ...base, game: "queen", extraPath: "" }, () => {});
    const started = t.start();
    fakeChild.err(ROOM);
    await started;

    const began = Date.now();
    const snap = t.snapshot();
    const outcome = expect(snap).rejects.toThrow("busy: commands dropped");
    fakeChild.err("A11Y_ERR busy: commands dropped");
    await outcome;
    expect(Date.now() - began).toBeLessThan(1000);

    // The slot is free again.
    const next = t.snapshot();
    fakeChild.err("A11Y_CMD state");
    fakeChild.err(ROOM);
    expect((await next).room).toBe(70);
  });
});

describe("NativeTransport quiet cap", () => {
  beforeEach(() => {
    fakeChild = new FakeChild();
    spawnMock.mockClear();
  });

  async function timesOutAfter(game: "queen" | "drascula", ms: number) {
    const t = new NativeTransport(
      game === "queen" ? { ...base, game, extraPath: "" } : { ...base, game },
      () => {},
    );
    const started = t.start();
    fakeChild.err(ROOM);
    await started;

    vi.useFakeTimers();
    try {
      let result: { error?: string } | undefined;
      const sent = t.send({ verb: "look", target: 3 });
      void sent.then((r) => (result = r));
      fakeChild.err("A11Y_CMD look 3");
      await vi.advanceTimersByTimeAsync(ms - 1);
      const before = result;
      await vi.advanceTimersByTimeAsync(1);
      return { before, after: result };
    } finally {
      vi.useRealTimers();
    }
  }

  it("gives queen a 30 s quiet cap", async () => {
    const r = await timesOutAfter("queen", 30_000);
    expect(r.before).toBeUndefined();
    expect(r.after?.error).toMatch(/did not settle within 30s/);
  });

  it("keeps drascula at the 10 s quiet cap", async () => {
    const r = await timesOutAfter("drascula", 10_000);
    expect(r.before).toBeUndefined();
    expect(r.after?.error).toMatch(/did not settle within 10s/);
  });
});
