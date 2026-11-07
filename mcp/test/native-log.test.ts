import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A per-command log line, flushed after (and before) every command, so if a
// native command hangs the last line on stderr names the call that blocked.
// These tests drive NativeTransport against a FAKE spawned child (node:
// child_process is mocked) and a captured logger, so no real ScummVM build is
// needed. They pin: start logs a line; a settled command logs send+settled;
// and the "send" line is flushed BEFORE the command settles (the hang case).

// A fake child process: stdout/stderr are EventEmitters we push A11Y lines to;
// kill is a no-op spy. spawn is mocked to return it and record args.
class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  pid = 4321;
  kill = vi.fn();
  /** Push a line as the engine would print it (newline-terminated). */
  emitLine(line: string): void {
    this.stdout.emit("data", Buffer.from(line + "\n", "utf8"));
  }
}

let fakeChild: FakeChild;
const spawnArgs: { binary: string; args: string[] }[] = [];

vi.mock("node:child_process", () => ({
  spawn: (binary: string, args: string[]) => {
    spawnArgs.push({ binary, args });
    return fakeChild;
  },
}));

// Avoid touching the real filesystem: mkdir/write/rm are no-ops here.
vi.mock("node:fs", () => ({
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  rmSync: vi.fn(),
  writeSync: vi.fn(),
}));

// Import AFTER the mocks are registered.
const { NativeTransport } = await import("../src/native.js");
import type { NativeConfig } from "../src/config.js";

const config: NativeConfig = {
  binary: "vendor/scummvm/scummvm",
  gamePath: "vendor/game/drascula",
  extraPath: "vendor/scummvm/dists/engine-data",
  savePath: "/tmp/ghostlight-mcp-test",
};

const ROOM_LINE =
  'A11Y {"chapter":1,"room":62,"hero":{"x":65,"y":145},"objects":[],"inventory":[],"flags":[0]}';

function makeTransport(cfg: NativeConfig = config) {
  const logs: string[] = [];
  const t = new NativeTransport(cfg, (line) => logs.push(line));
  return { t, logs };
}

describe("NativeTransport per-command logging", () => {
  beforeEach(() => {
    fakeChild = new FakeChild();
    spawnArgs.length = 0;
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("logs a start line, with the save slot when one is set", async () => {
    const { t, logs } = makeTransport({ ...config, slot: 7 });
    const started = t.start();
    fakeChild.emitLine(ROOM_LINE);
    await started;
    expect(logs[0]).toBe("start (save-slot 7)");
    // The slot also reaches the engine argv.
    expect(spawnArgs[0].args).toContain("--save-slot=7");
  });

  it("logs send then settled for a command that completes", async () => {
    const { t, logs } = makeTransport();
    const started = t.start();
    fakeChild.emitLine(ROOM_LINE);
    await started;
    logs.length = 0; // drop the start line

    const sent = t.send({ verb: "inventory" });
    // Echo then diff settles the command.
    fakeChild.emitLine("A11Y_CMD inventory");
    fakeChild.emitLine('A11Y_DIFF {"cmd":"inventory","changed":false}');
    await sent;

    expect(logs).toEqual([`send "inventory"`, `settled "inventory": diff`]);
  });

  it("flushes the send line BEFORE the command settles (the hang case)", async () => {
    const { t, logs } = makeTransport();
    const started = t.start();
    fakeChild.emitLine(ROOM_LINE);
    await started;
    logs.length = 0;

    // Issue a command but do not feed any engine lines: it never settles.
    void t.send({ verb: "look", target: 52 });
    // The send line is already on the log, naming the blocked command, even
    // though no settled line has been written.
    expect(logs).toEqual([`send "look 52"`]);
  });
});
