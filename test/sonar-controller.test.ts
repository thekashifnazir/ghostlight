import { describe, expect, it } from "vitest";
import type { RoomObject, RoomState } from "../src/engine/adapter.js";
import type { Hotspot } from "../src/model/hotspot-list.js";
import type { LiveRegion } from "../src/ui/live-region.js";
import { Sonar, summaryLine } from "../src/sonar/sonar.js";
import { buildPings } from "../src/sonar/mapping.js";

// Drives the Sonar controller with a fake LiveRegion (records every announced
// line). The audio layer is exercised via a fake AudioContext, or omitted
// entirely to prove the text-only path (R5.5). These tests pin the scan summary
// announced synchronously up front (R2.2, R2.3), the empty-room lines (R2.5,
// R3.5), stepping with wrap and reset (R3.1-R3.6), mute (R5.3, R5.4), that
// stop() cannot swallow the already-announced summary (R5.2) and the no-context
// path (R5.5).

/** A LiveRegion stand-in recording announced lines; `last` is the newest. */
class FakeLive {
  lines: string[] = [];
  announce(text: string): void {
    this.lines.push(text);
  }
  get last(): string | undefined {
    return this.lines[this.lines.length - 1];
  }
}

/** A minimal AudioContext that records how many oscillators were created. */
function makeFakeCtx() {
  let oscillators = 0;
  const node = () => ({
    type: "",
    frequency: { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {} },
    gain: {
      value: 0,
      setValueAtTime() {},
      linearRampToValueAtTime() {},
      exponentialRampToValueAtTime() {},
    },
    pan: { value: 0 },
    connect() {},
    disconnect() {},
    start() {},
    stop() {},
  });
  const ctx = {
    currentTime: 0,
    destination: {},
    createOscillator() {
      oscillators++;
      return node();
    },
    createGain: node,
    createBiquadFilter: node,
    createStereoPanner: node,
  };
  return { ctx: ctx as unknown as AudioContext, oscillatorCount: () => oscillators };
}

const obj = (num: number, kind: Hotspot["kind"], x: number, door = false): {
  o: RoomObject;
  h: Hotspot;
} => {
  const rect: [number, number, number, number] = [x, 100, 10, 10];
  return {
    o: { num, name: `R${num}`, rect, walkTo: [x, 100], visible: true, door },
    h: { num, kind, name: `thing-${num}`, rect, walkTo: [x, 100] },
  };
};

function room(objects: { o: RoomObject; h: Hotspot }[]): {
  state: RoomState;
  list: Hotspot[];
} {
  return {
    state: {
      chapter: 1,
      room: 62,
      hero: { x: 160, y: 140 },
      objects: objects.map((x) => x.o),
      inventory: [],
      flags: new Array(50).fill(0),
    },
    list: objects.map((x) => x.h),
  };
}

// Three things left to right: a person, an object, an exit.
const threeThings = [
  obj(1, "npc", 20),
  obj(2, "object", 150),
  obj(3, "exit", 300, true),
];

describe("summaryLine", () => {
  it("counts total and each kind with correct pluralisation", () => {
    const { state, list } = room(threeThings);
    const pings = buildPings(state, list);
    expect(summaryLine(pings)).toBe(
      "3 things, left to right: 1 person, 1 object, 1 exit.",
    );
  });
});

describe("Sonar scan", () => {
  it("announces the summary line immediately, then plays a ping per thing", () => {
    const live = new FakeLive();
    const { ctx, oscillatorCount } = makeFakeCtx();
    const sonar = new Sonar({ live: live as unknown as LiveRegion, getContext: () => ctx });
    const { state, list } = room(threeThings);
    sonar.setRoom(state, list);

    sonar.scan();
    // The summary is announced synchronously on scan(), before any flush/timer.
    expect(live.last).toBe("3 things, left to right: 1 person, 1 object, 1 exit.");
    // An object(1) + exit(2 notes) + person(1) = at least 3 voices scheduled.
    expect(oscillatorCount()).toBeGreaterThanOrEqual(3);
  });

  it("announces an empty room and plays nothing", () => {
    const live = new FakeLive();
    const { ctx, oscillatorCount } = makeFakeCtx();
    const sonar = new Sonar({ live: live as unknown as LiveRegion, getContext: () => ctx });
    const { state, list } = room([]);
    sonar.setRoom(state, list);
    sonar.scan();
    expect(live.last).toBe("The room is empty.");
    expect(oscillatorCount()).toBe(0);
  });
});

describe("Sonar stepping", () => {
  it("next walks forward and wraps, announcing text and N of M", () => {
    const live = new FakeLive();
    const { ctx } = makeFakeCtx();
    const sonar = new Sonar({ live: live as unknown as LiveRegion, getContext: () => ctx });
    const { state, list } = room(threeThings);
    sonar.setRoom(state, list);

    sonar.next();
    expect(live.last).toBe("thing-1, person, left, mid, 1 of 3");
    sonar.next();
    expect(live.last).toBe("thing-2, object, ahead, near, 2 of 3");
    sonar.next();
    expect(live.last).toBe("thing-3, exit, right, mid, 3 of 3");
    sonar.next(); // wraps to the first.
    expect(live.last).toBe("thing-1, person, left, mid, 1 of 3");
  });

  it("prev walks backward from the reset cursor to the last thing", () => {
    const live = new FakeLive();
    const { ctx } = makeFakeCtx();
    const sonar = new Sonar({ live: live as unknown as LiveRegion, getContext: () => ctx });
    const { state, list } = room(threeThings);
    sonar.setRoom(state, list);
    sonar.prev();
    expect(live.last).toBe("thing-3, exit, right, mid, 3 of 3");
  });

  it("resets the cursor on setRoom so the next step starts at the first", () => {
    const live = new FakeLive();
    const { ctx } = makeFakeCtx();
    const sonar = new Sonar({ live: live as unknown as LiveRegion, getContext: () => ctx });
    const first = room(threeThings);
    sonar.setRoom(first.state, first.list);
    sonar.next();
    sonar.next(); // now on index 1
    // New room: cursor resets, next() lands on index 0 again.
    const second = room(threeThings);
    sonar.setRoom(second.state, second.list);
    sonar.next();
    expect(live.last).toBe("thing-1, person, left, mid, 1 of 3");
  });

  it("announces when there is nothing to step through", () => {
    const live = new FakeLive();
    const { ctx } = makeFakeCtx();
    const sonar = new Sonar({ live: live as unknown as LiveRegion, getContext: () => ctx });
    const { state, list } = room([]);
    sonar.setRoom(state, list);
    sonar.next();
    expect(live.last).toBe("Nothing to step through.");
  });
});

describe("Sonar mute", () => {
  it("announces off then on", () => {
    const live = new FakeLive();
    const { ctx } = makeFakeCtx();
    const sonar = new Sonar({ live: live as unknown as LiveRegion, getContext: () => ctx });
    sonar.toggleMute();
    expect(live.last).toBe("Sonar sound off.");
    sonar.toggleMute();
    expect(live.last).toBe("Sonar sound on.");
  });

  it("while muted, scan/step still announce text but schedule no audio", () => {
    const live = new FakeLive();
    const { ctx, oscillatorCount } = makeFakeCtx();
    const sonar = new Sonar({ live: live as unknown as LiveRegion, getContext: () => ctx });
    const { state, list } = room(threeThings);
    sonar.setRoom(state, list);
    sonar.toggleMute(); // mute

    sonar.scan();
    expect(live.last).toBe("3 things, left to right: 1 person, 1 object, 1 exit.");
    sonar.next();
    expect(live.last).toBe("thing-1, person, left, mid, 1 of 3");
    expect(oscillatorCount()).toBe(0); // no audio while muted.
  });
});

describe("Sonar stop", () => {
  it("leaves the already-announced summary intact when a scan is stopped", () => {
    const live = new FakeLive();
    const { ctx } = makeFakeCtx();
    const sonar = new Sonar({ live: live as unknown as LiveRegion, getContext: () => ctx });
    const { state, list } = room(threeThings);
    sonar.setRoom(state, list);
    sonar.scan();
    // The summary was announced synchronously up front.
    expect(live.last).toBe("3 things, left to right: 1 person, 1 object, 1 exit.");
    // stop() only silences audio; it cannot swallow the summary text.
    sonar.stop();
    expect(live.last).toBe("3 things, left to right: 1 person, 1 object, 1 exit.");
  });
});

describe("Sonar without an audio context", () => {
  it("still announces scan and step as text (R5.5)", () => {
    const live = new FakeLive();
    const sonar = new Sonar({ live: live as unknown as LiveRegion, getContext: () => undefined });
    const { state, list } = room(threeThings);
    sonar.setRoom(state, list);
    sonar.scan();
    expect(live.last).toBe("3 things, left to right: 1 person, 1 object, 1 exit.");
    sonar.next();
    expect(live.last).toBe("thing-1, person, left, mid, 1 of 3");
  });
});

describe("Sonar scan with the worth-a-look nudge", () => {
  it("speaks the nudge straight after the short summary line", () => {
    const live = new FakeLive();
    const { ctx } = makeFakeCtx();
    const sonar = new Sonar({
      live: live as unknown as LiveRegion,
      getContext: () => ctx,
      nudge: () => "Worth a look: It's late, and you'll need somewhere to sleep.",
    });
    const { state, list } = room(threeThings);
    sonar.setRoom(state, list);
    sonar.scan();
    expect(live.last).toBe(
      "3 things, left to right: 1 person, 1 object, 1 exit. Worth a look: It's late, and you'll need somewhere to sleep.",
    );
  });

  it("keeps the plain summary when there is no nudge", () => {
    const live = new FakeLive();
    const { ctx } = makeFakeCtx();
    const sonar = new Sonar({ live: live as unknown as LiveRegion, getContext: () => ctx, nudge: () => undefined });
    const { state, list } = room(threeThings);
    sonar.setRoom(state, list);
    sonar.scan();
    expect(live.last).toBe("3 things, left to right: 1 person, 1 object, 1 exit.");
  });
});
