// Stream-split regression (transport-settle bugfix).
//
// The native transport reads A11Y lines off the engine's output. The engine
// prints A11Y lines on stderr (g_system->logMessage(kError)), but the child
// ALSO writes unrelated chatter on stdout (startup banner, "User picked
// target…") and on stderr (ScummVM "WARNING:" lines). A chunk boundary can
// land mid-line, and stdout and stderr are independent event sources.
//
// The bug: a single shared line buffer fed from BOTH streams splices a partial
// line on one stream into the next line on the other. A partial stdout chunk
// with no trailing newline, arriving just before a stderr A11Y line, corrupts
// that A11Y line ("<stdout-partial>A11Y_CMD look 52"), so parseA11yLine drops
// it and the command never settles — the 60s timeout the surveyor saw.
//
// The fix: one line buffer PER stream, so a partial line on stdout can never
// corrupt a line on stderr (and vice versa). These tests pin that: an A11Y
// line on stderr settles its command even when stdout has an outstanding
// partial line, and a line split across two chunks on the SAME stream still
// reassembles.

import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  pid = 4321;
  kill = vi.fn();
  /** Push a whole line on stderr (where the engine prints A11Y lines). */
  err(line: string): void {
    this.stderr.emit("data", Buffer.from(line + "\n", "utf8"));
  }
  /** Push a whole line on stdout. */
  out(line: string): void {
    this.stdout.emit("data", Buffer.from(line + "\n", "utf8"));
  }
  /** Push a raw chunk (no added newline) on a given stream. */
  raw(stream: "stdout" | "stderr", chunk: string): void {
    this[stream].emit("data", Buffer.from(chunk, "utf8"));
  }
}

let fakeChild: FakeChild;

vi.mock("node:child_process", () => ({
  spawn: () => fakeChild,
}));
vi.mock("node:fs", () => ({
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  rmSync: vi.fn(),
  writeSync: vi.fn(),
}));

const { NativeTransport } = await import("../src/native.js");
import type { NativeConfig } from "../src/config.js";

const config: NativeConfig = {
  binary: "vendor/scummvm/scummvm",
  gamePath: "vendor/game/drascula",
  extraPath: "vendor/scummvm/dists/engine-data",
  savePath: "/tmp/ghostlight-mcp-test",
};

const ROOM_LINE =
  'A11Y {"chapter":1,"room":62,"hero":{"x":65,"y":145},"objects":[{"num":52,"name":"X","rect":[0,0,1,1],"walkTo":[0,0],"visible":true,"door":false}],"inventory":[],"flags":[0]}';

async function startedTransport() {
  const t = new NativeTransport(config, () => {});
  const started = t.start();
  fakeChild.err(ROOM_LINE);
  await started;
  return t;
}

/**
 * Resolve to the command result, or reject after `ms` so a command that never
 * settles (the bug) fails the test fast instead of hanging until the transport's
 * 60s hard cap. On the fixed code the command settles synchronously-fast, well
 * under this bound.
 */
function within<T>(p: Promise<T>, ms = 1000): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("command did not settle (stream-split hang)")), ms),
    ),
  ]);
}

describe("NativeTransport stream handling", () => {
  beforeEach(() => {
    fakeChild = new FakeChild();
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("settles on a stderr A11Y line even when stdout has an outstanding partial line", async () => {
    const t = await startedTransport();

    const sent = t.send({ verb: "look", target: 52 });

    // ScummVM writes a startup/debug fragment on stdout with NO trailing
    // newline (a chunk boundary mid-line). With a single shared buffer this
    // fragment would prefix the next stderr line and corrupt it.
    fakeChild.raw("stdout", "User picked target 'drascula'");

    // The engine now emits the command's echo and diff on stderr.
    fakeChild.err("A11Y_CMD look 52");
    fakeChild.err('A11Y_DIFF {"cmd":"look 52","changed":false}');

    const result = await within(sent);
    expect(result.error).toBeUndefined();
    expect(result.diff).toBeDefined();
    expect(result.diff?.cmd).toBe("look 52");
  });

  it("reassembles an A11Y line split across two chunks on the same stream", async () => {
    const t = await startedTransport();

    const sent = t.send({ verb: "look", target: 52 });
    fakeChild.err("A11Y_CMD look 52");
    // The diff line arrives split across two stderr chunks.
    fakeChild.raw("stderr", 'A11Y_DIFF {"cmd":"look 52",');
    fakeChild.raw("stderr", '"changed":false}\n');

    const result = await within(sent);
    expect(result.error).toBeUndefined();
    expect(result.diff?.cmd).toBe("look 52");
  });

  it("does not splice a trailing stderr partial into a stdout line", async () => {
    const t = await startedTransport();

    const sent = t.send({ verb: "look", target: 52 });
    // A partial on stderr (the echo, not yet newline-terminated)…
    fakeChild.raw("stderr", "A11Y_CMD look 52");
    // …then unrelated stdout chatter arrives whole.
    fakeChild.out("packet.001: c6a8…, 32847563 bytes.");
    // …then the rest of the echo completes and the diff lands.
    fakeChild.raw("stderr", "\n");
    fakeChild.err('A11Y_DIFF {"cmd":"look 52","changed":false}');

    const result = await within(sent);
    expect(result.error).toBeUndefined();
    expect(result.diff?.cmd).toBe("look 52");
  });
});
