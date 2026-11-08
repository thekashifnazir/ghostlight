import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Command, EngineEvent } from "../src/engine/adapter.js";
import { ReplayAdapter } from "../src/engine/replay-adapter.js";
import { StatusTracker, type Phase } from "../src/engine/status.js";

// Phase-transition unit tests for the readiness signal (src/engine/status.ts),
// driven with the REAL ReplayAdapter against the committed A11Y fixtures. The
// tracker is wired exactly as main.ts wires it: status.onSend(...) before each
// adapter.send(), and status.onEvent(e) for every event the adapter emits, so
// these pin the same state machine a test/harness waits on through
// window.__ghostlight.
//
// Time is injected: a manual timer queue lets the quiet-period settle fire on
// demand, so the tests are synchronous and never sleep. Each pending timer is a
// { fn, ms }; `flush()` runs the ones due at the current virtual clock.

function fixture(name: string): string {
  const url = new URL(`../src/fixtures/${name}`, import.meta.url);
  return readFileSync(fileURLToPath(url), "utf8");
}

/** A manual clock + timer queue so the settle quiet-period is deterministic. */
function clock() {
  let nowMs = 0;
  interface Pending {
    id: number;
    due: number;
    fn: () => void;
  }
  const pending = new Map<number, Pending>();
  let nextId = 1;
  return {
    now: () => nowMs,
    setTimeout: (fn: () => void, ms: number): number => {
      const id = nextId++;
      pending.set(id, { id, due: nowMs + ms, fn });
      return id;
    },
    clearTimeout: (handle: unknown): void => {
      pending.delete(handle as number);
    },
    /** Advance virtual time by `ms`, firing any timers that come due. */
    advance: (ms: number): void => {
      nowMs += ms;
      for (const p of [...pending.values()].sort((a, b) => a.due - b.due)) {
        if (p.due <= nowMs && pending.has(p.id)) {
          pending.delete(p.id);
          p.fn();
        }
      }
    },
  };
}

/** The quiet period used by these tests (short; real default is 400 ms). */
const QUIET_MS = 50;

/**
 * Build a tracker wired to a replay of `fixtureName`, with injected time. `send`
 * drives one command through the adapter exactly as main.ts's sendCommand does:
 * status.onSend(isCutscene) then adapter.send(cmd); the adapter's events reach
 * status.onEvent via the subscription. Returns the tracker, the clock, and the
 * send helper, plus a started() that boots the adapter and the first room.
 */
function harness(fixtureName: string) {
  const c = clock();
  const status = new StatusTracker({
    settleQuietMs: QUIET_MS,
    now: c.now,
    setTimeout: c.setTimeout,
    clearTimeout: c.clearTimeout,
  });
  const adapter = new ReplayAdapter(fixture(fixtureName));
  const events: EngineEvent[] = [];
  adapter.onEvent((e) => {
    events.push(e);
    status.onEvent(e);
  });
  const start = async (intoSlot = false): Promise<void> => {
    status.onStart(intoSlot);
    await adapter.start();
  };
  const send = (cmd: Command, isCutscene = false): void => {
    status.onSend(isCutscene);
    adapter.send(cmd);
  };
  return { status, clock: c, adapter, events, start, send };
}

describe("StatusTracker phase transitions (replay adapter)", () => {
  it("starts at 'gate', boots to 'booting', then 'ready' on the first room", async () => {
    const h = harness("tavern.a11y.log");
    expect(h.status.phase).toBe("gate");

    h.status.onStart(false);
    expect(h.status.phase).toBe("booting");

    await h.adapter.start(); // emits the room event into status via onEvent
    expect(h.status.phase).toBe("ready");
    expect(h.status.status.room).toBe(62);
    expect(h.status.status.chapter).toBe(1);
  });

  it("a Continue/load boot reports 'loading' until the first room", async () => {
    const h = harness("tavern.a11y.log");
    h.status.onStart(true);
    expect(h.status.phase).toBe("loading");
    await h.adapter.start();
    expect(h.status.phase).toBe("ready");
  });

  it("a plain command goes 'busy' then settles to 'ready' on its diff", async () => {
    const h = harness("tavern.a11y.log");
    await h.start();

    h.send({ verb: "look", target: 52 }); // look 52: a text line then a diff
    // The diff is the engine's settled response and resolves to ready at once,
    // without needing the quiet period at all.
    expect(h.status.phase).toBe("ready");
  });

  it("a talk runs through 'conversation' while dialogue arrives, then 'ready'", async () => {
    // The ReplayAdapter emits all of a command's events (text lines then the
    // diff) synchronously inside send(), so to observe the intermediate
    // 'conversation' phase we feed the talk's events one at a time, as the live
    // adapter delivers them over time.
    const h = harness("tavern.a11y.log");
    await h.start();

    const talk: EngineEvent[] = [
      { type: "cmd", cmd: "talk 52" },
      { type: "text", line: "HELLO. HAVE YOU GOT A ROOM FOR THE NIGHT?" },
      { type: "text", line: "OF COURSE. TAKE THE KEY." },
    ];
    h.status.onSend(false);
    expect(h.status.phase).toBe("busy");

    h.status.onEvent(talk[0]); // cmd echo: still busy
    expect(h.status.phase).toBe("busy");

    h.status.onEvent(talk[1]); // first dialogue line: conversation
    expect(h.status.phase).toBe("conversation");
    h.status.onEvent(talk[2]); // more dialogue: still conversation
    expect(h.status.phase).toBe("conversation");

    // The settling diff ends the conversation at once (no quiet period needed).
    h.status.onEvent({
      type: "diff",
      diff: { cmd: "talk 52", changed: true },
    });
    expect(h.status.phase).toBe("ready");
  });

  it("a conversation that goes quiet settles via the quiet period, not forever", () => {
    const h = harness("tavern.a11y.log");
    h.status.onStart(false);
    // Seed a ready baseline without the adapter (we only exercise the timer).
    h.status.onEvent({
      type: "room",
      state: {
        chapter: 1,
        room: 62,
        hero: { x: 0, y: 0 },
        objects: [],
        inventory: [],
        flags: [],
      },
    });
    expect(h.status.phase).toBe("ready");

    h.status.onSend(false);
    h.status.onEvent({ type: "text", line: "A LINE OF DIALOGUE." });
    expect(h.status.phase).toBe("conversation");

    // Not yet quiet long enough.
    h.clock.advance(QUIET_MS - 1);
    expect(h.status.phase).toBe("conversation");
    // Another line resets the quiet period (bump), so it still is not settled.
    h.status.onEvent({ type: "text", line: "ANOTHER LINE." });
    h.clock.advance(QUIET_MS - 1);
    expect(h.status.phase).toBe("conversation");
    // Now let the full quiet period elapse with no further output: settles.
    h.clock.advance(1);
    expect(h.status.phase).toBe("ready");
  });

  it("a 'choices' event opens the 'choice' phase and stays until resolved", () => {
    const h = harness("tavern.a11y.log");
    h.status.onStart(false);
    h.status.onEvent({
      type: "room",
      state: {
        chapter: 1,
        room: 62,
        hero: { x: 0, y: 0 },
        objects: [],
        inventory: [],
        flags: [],
      },
    });

    h.status.onSend(false); // talk 53
    h.status.onEvent({ type: "text", line: "WHERE CAN I FIND VON BRAUN?" });
    expect(h.status.phase).toBe("conversation");

    h.status.onEvent({
      type: "choices",
      choices: [
        { n: 1, text: "Ask about the castle" },
        { n: 2, text: "Ask about Von Braun" },
      ],
    });
    expect(h.status.phase).toBe("choice");

    // The choice phase is NOT quiet-period driven: time passing never settles
    // it, only the player choosing (a 'choose' command + its diff) does.
    h.clock.advance(QUIET_MS * 10);
    expect(h.status.phase).toBe("choice");

    // Choosing: a command goes out, its diff settles the conversation.
    h.status.onSend(false); // choose n
    h.status.onEvent({ type: "diff", diff: { cmd: "choose 2", changed: true } });
    expect(h.status.phase).toBe("ready");
  });

  it("a scripted-exit crossing walk runs 'cutscene' then 'ready' on the chapter diff", async () => {
    const h = harness("leave-tavern.a11y.log");
    await h.start();
    expect(h.status.phase).toBe("ready");

    // main.ts marks the crossing walk as a cutscene trigger.
    h.send({ verb: "walk", target: 105 }, true);
    // The replay emits the chapter-crossing diff synchronously, which settles
    // the cutscene to ready and advances room + chapter.
    expect(h.status.phase).toBe("ready");
    expect(h.status.status.chapter).toBe(2);
    expect(h.status.status.room).toBe(14);
  });

  it("a cutscene with no immediate diff stays 'cutscene' until the quiet period", () => {
    const h = harness("leave-tavern.a11y.log");
    h.status.onStart(false);
    h.status.onEvent({
      type: "room",
      state: {
        chapter: 1,
        room: 62,
        hero: { x: 0, y: 0 },
        objects: [],
        inventory: [],
        flags: [],
      },
    });

    h.status.onSend(true); // cutscene trigger, no events yet
    expect(h.status.phase).toBe("cutscene");
    h.clock.advance(QUIET_MS - 1);
    expect(h.status.phase).toBe("cutscene");
    h.clock.advance(1); // quiet period elapses: settles
    expect(h.status.phase).toBe("ready");
  });

  it("an error event moves to the 'error' phase", async () => {
    const h = harness("tavern.a11y.log");
    await h.start();
    h.status.onSend(false);
    h.status.onEvent({ type: "error", message: "object 999 is not in this room" });
    expect(h.status.phase).toBe("error");
  });

  it("records lines into the ring buffer with seq, and caps at 200", () => {
    const h = harness("tavern.a11y.log");
    h.status.recordLine("first");
    h.status.recordLine("second");
    expect(h.status.status.lineSeq).toBe(2);
    expect(h.status.status.lastLine).toBe("second");
    expect(h.status.status.lines.map((l) => l.text)).toEqual(["first", "second"]);
    expect(h.status.status.lines.map((l) => l.seq)).toEqual([1, 2]);

    for (let i = 0; i < 250; i++) h.status.recordLine(`line ${i}`);
    expect(h.status.status.lines.length).toBe(200);
    // The newest is kept; the oldest is dropped (ring buffer).
    expect(h.status.status.lastLine).toBe("line 249");
    expect(h.status.status.lineSeq).toBe(252);
    expect(h.status.status.lines[0].text).not.toBe("first");
  });

  it("waitFor resolves immediately when already in the phase", async () => {
    const h = harness("tavern.a11y.log");
    await h.start();
    expect(h.status.phase).toBe("ready");
    await expect(h.status.status.waitFor("ready", 1000)).resolves.toBeUndefined();
  });

  it("waitFor resolves when the phase is later reached", async () => {
    const h = harness("tavern.a11y.log");
    h.status.onStart(false);
    const pending = h.status.status.waitFor("ready", 1000);
    await h.adapter.start(); // room event -> ready
    await expect(pending).resolves.toBeUndefined();
  });

  it("waitFor rejects after the timeout if the phase is never reached", async () => {
    const h = harness("tavern.a11y.log");
    h.status.onStart(false); // 'booting', never advanced
    const pending = h.status.status.waitFor("ready", 1000);
    h.clock.advance(1000); // fire the timeout timer
    await expect(pending).rejects.toThrow(/waitFor timed out/);
  });

  it("waitWhile resolves when the phase leaves the predicate (e.g. conversation)", async () => {
    const h = harness("tavern.a11y.log");
    h.status.onStart(false);
    h.status.onEvent({
      type: "room",
      state: {
        chapter: 1,
        room: 62,
        hero: { x: 0, y: 0 },
        objects: [],
        inventory: [],
        flags: [],
      },
    });
    h.status.onSend(false);
    h.status.onEvent({ type: "text", line: "DIALOGUE." });
    expect(h.status.phase).toBe("conversation");

    const left = h.status.status.waitWhile((p: Phase) => p === "conversation", 1000);
    h.status.onEvent({ type: "diff", diff: { cmd: "talk 52", changed: true } });
    await expect(left).resolves.toBeUndefined();
  });
});
