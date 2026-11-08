// choose settles on its diff, not the re-presented choices (transport-settle).
//
// A non-ending `choose` makes the engine run the option's reply, then on the
// next conversation frame it re-lists the options (A11Y_CHOICES) and emits the
// choose's own A11Y_DIFF — in that order (the live order, and tavern.json's
// recorded order). The diff carries the flags the choice committed. If the
// native transport settled a choose on the A11Y_CHOICES it would drop that diff
// and the caller would have to run `state` to see a committed flag. These tests
// pin that a `choose` instead settles on its diff (collecting the intervening
// choices), so flags reach the caller directly; and that `talk`/`choices` still
// settle on the choices line (a talk's own diff is deferred and out of order).

import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  pid = 4321;
  kill = vi.fn();
  /** Push a whole line on stderr (where A11Y lines appear). */
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
  binary: "vendor/scummvm/scummvm",
  gamePath: "vendor/game/drascula",
  extraPath: "vendor/scummvm/dists/engine-data",
  savePath: "/tmp/ghostlight-mcp-test",
};

const ROOM_LINE =
  'A11Y {"chapter":1,"room":62,"hero":{"x":65,"y":145},"objects":[],"inventory":[],"flags":[0]}';
const CHOICES =
  'A11Y_CHOICES {"choices":[{"n":1,"text":"A","used":false},{"n":2,"text":"B","used":true},{"n":3,"text":"C","used":false},{"n":4,"text":"D","used":false,"ends":true}]}';

async function startedTransport() {
  const t = new NativeTransport(config, () => {});
  const started = t.start();
  fakeChild.err(ROOM_LINE);
  await started;
  return t;
}

describe("NativeTransport conversation settling", () => {
  beforeEach(() => {
    fakeChild = new FakeChild();
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("settles a non-ending choose on its diff, carrying committed flags", async () => {
    const t = await startedTransport();
    const sent = t.send({ verb: "choose", n: 3 });

    // Live/recorded order for a non-ending choose: echo, spoken text, the
    // re-presented choices, THEN the choose's own diff with the committed flag.
    fakeChild.err("A11Y_CMD choose 3");
    fakeChild.err("A11Y_TEXT THIS IS QUITE GROOVY, HUH?");
    fakeChild.err(CHOICES);
    fakeChild.err(
      'A11Y_DIFF {"cmd":"choose 3","flags":{"40":[0,1]},"said":[{"color":"yellow","text":"THIS IS QUITE GROOVY, HUH?"}],"changed":true}',
    );

    const result = await sent;
    // It settled on the diff (not the choices), so the flag is visible without
    // a follow-up `state`.
    expect(result.error).toBeUndefined();
    expect(result.diff?.cmd).toBe("choose 3");
    expect(result.diff?.flags).toEqual({ "40": [0, 1] });
    // The re-presented choices are still carried in events (nothing lost).
    expect(result.events.some((e) => e.type === "choices")).toBe(true);
  });

  it("settles an ending choose (option 4) on its diff", async () => {
    const t = await startedTransport();
    const sent = t.send({ verb: "choose", n: 4 });

    // Ending choose: no re-presented choices (the conversation closed); the
    // diff comes from onConverseEnd().
    fakeChild.err("A11Y_CMD choose 4");
    fakeChild.err("A11Y_TEXT I'D BETTER NOT SAY ANYTHING.");
    fakeChild.err('A11Y_DIFF {"cmd":"choose 4","changed":false}');

    const result = await sent;
    expect(result.error).toBeUndefined();
    expect(result.diff?.cmd).toBe("choose 4");
  });

  it("still settles a talk on the choices line (its diff is deferred)", async () => {
    const t = await startedTransport();
    const sent = t.send({ verb: "talk", target: 53 });

    // A talk opens the conversation and settles on the choices; its own diff is
    // deferred (emitted out of order after a later choose), so waiting for it
    // would deadlock.
    fakeChild.err("A11Y_CMD talk 53");
    fakeChild.err(CHOICES);

    const result = await sent;
    expect(result.error).toBeUndefined();
    expect(result.diff).toBeUndefined();
    expect(result.events.some((e) => e.type === "choices")).toBe(true);
  });

  it("still settles the choices command on the choices line", async () => {
    const t = await startedTransport();
    const sent = t.send({ verb: "choices" });

    fakeChild.err("A11Y_CMD choices");
    fakeChild.err(CHOICES);

    const result = await sent;
    expect(result.error).toBeUndefined();
    expect(result.events.some((e) => e.type === "choices")).toBe(true);
  });
});
