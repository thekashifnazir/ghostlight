import { describe, expect, it } from "vitest";
import type { RoomObject, RoomState } from "../src/engine/adapter.js";
import type { Hotspot } from "../src/model/hotspot-list.js";
import type { LiveRegion } from "../src/ui/live-region.js";
import { Sonar, summaryLine } from "../src/sonar/sonar.js";
import { buildPings } from "../src/sonar/mapping.js";

// Drives the Sonar controller with a fake LiveRegion (records every announced
// line). Sonar is text only (the tones were removed on 17 Nov 2026). These
// tests pin the scan summary (R2.2), the empty-room lines (R2.5, R3.5),
// stepping with wrap and reset (R3.1-R3.6) and the worth-a-look nudge.

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
  it("announces the summary line, counting the room left to right", () => {
    const live = new FakeLive();
    const sonar = new Sonar({ live: live as unknown as LiveRegion });
    const { state, list } = room(threeThings);
    sonar.setRoom(state, list);

    sonar.scan();
    expect(live.last).toBe("3 things, left to right: 1 person, 1 object, 1 exit.");
  });

  it("announces an empty room", () => {
    const live = new FakeLive();
    const sonar = new Sonar({ live: live as unknown as LiveRegion });
    const { state, list } = room([]);
    sonar.setRoom(state, list);
    sonar.scan();
    expect(live.last).toBe("The room is empty.");
  });
});

describe("Sonar stepping", () => {
  it("next walks forward and wraps, announcing text and N of M", () => {
    const live = new FakeLive();
    const sonar = new Sonar({ live: live as unknown as LiveRegion });
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
    const sonar = new Sonar({ live: live as unknown as LiveRegion });
    const { state, list } = room(threeThings);
    sonar.setRoom(state, list);
    sonar.prev();
    expect(live.last).toBe("thing-3, exit, right, mid, 3 of 3");
  });

  it("resets the cursor on setRoom so the next step starts at the first", () => {
    const live = new FakeLive();
    const sonar = new Sonar({ live: live as unknown as LiveRegion });
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
    const sonar = new Sonar({ live: live as unknown as LiveRegion });
    const { state, list } = room([]);
    sonar.setRoom(state, list);
    sonar.next();
    expect(live.last).toBe("Nothing to step through.");
  });
});

describe("Sonar scan with the worth-a-look nudge", () => {
  it("speaks the nudge straight after the short summary line", () => {
    const live = new FakeLive();
    const sonar = new Sonar({
      live: live as unknown as LiveRegion,
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
    const sonar = new Sonar({ live: live as unknown as LiveRegion, nudge: () => undefined });
    const { state, list } = room(threeThings);
    sonar.setRoom(state, list);
    sonar.scan();
    expect(live.last).toBe("3 things, left to right: 1 person, 1 object, 1 exit.");
  });
});
