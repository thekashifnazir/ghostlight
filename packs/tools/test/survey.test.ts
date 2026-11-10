// Unit tests for the pure parts of the survey (pack-coverage spec, tasks 2 and 3):
// the exit-graph walk order, route finding and the verdict bookkeeping. The
// engine is a fake with invented rooms; there is no game data and no native
// build here.
import { describe, expect, it } from "vitest";
import {
  bfsOrder,
  chapterRooms,
  findRoute,
  Ledger,
  observeDoors,
  runSurvey,
  verdictLine,
  type CensusSlice,
  type DoorMap,
  type EngineDriver,
  type RoomFiles,
  type SurveySink,
  type ToolResult,
} from "../../survey/survey-core.js";

interface FakeDoor {
  num: number;
  to: number;
  /** The walk is accepted but the room does not change. */
  locked?: boolean;
  /** The call never settles. */
  stall?: boolean;
}

/** Invented rooms: room -> doors. Door hotspot numbers are room*10 + index. */
function fakeEngine(rooms: Record<number, FakeDoor[]>, startRoom: number) {
  let at = startRoom;
  const calls: string[] = [];
  const stateOf = (room: number) => ({
    chapter: 3,
    room,
    hero: { x: 10, y: 20 },
    objects: [
      ...(rooms[room] ?? []).map((d) => ({
        num: d.num,
        name: "DOOR",
        rect: [0, 0, 5, 5],
        walkTo: [1, 1],
        visible: true,
        door: true,
        toRoom: d.to,
      })),
      {
        num: room * 10 + 9,
        name: "THING",
        rect: [1, 1, 2, 2],
        walkTo: [1, 1],
        visible: true,
        door: false,
      },
    ],
    inventory: [],
    flags: new Array(50).fill(0),
  });
  const driver: EngineDriver = {
    async call(tool, args): Promise<ToolResult> {
      calls.push(args ? `${tool} ${JSON.stringify(args)}` : tool);
      if (tool === "start") return { data: stateOf(at), isError: false };
      if (tool === "state") return { data: stateOf(at), isError: false };
      if (tool === "stop") return { data: { stopped: true }, isError: false };
      if (tool === "walk") {
        const d = (rooms[at] ?? []).find((x) => x.num === args?.target);
        if (!d) return { data: { error: "bad target" }, isError: true };
        if (d.stall) {
          return { data: { error: "walk did not settle" }, isError: true, timedOut: true };
        }
        if (!d.locked) at = d.to;
        return { data: { diff: { cmd: "walk", changed: !d.locked } }, isError: false };
      }
      if (tool === "look") {
        return {
          data: { diff: { cmd: "look", changed: false, said: [{ color: "x", text: `look ${args?.target}` }] } },
          isError: false,
        };
      }
      return { data: { error: `unexpected ${tool}` }, isError: true };
    },
  };
  return { driver, calls };
}

function memorySink() {
  const written = new Map<number, RoomFiles>();
  const sink: SurveySink = {
    writeRoom: (room, files) => void written.set(room, files),
    log: () => undefined,
  };
  return { sink, written };
}

const census: CensusSlice = {
  exitGraph: { "1": [2, 3], "2": [1, 4], "3": [1], "4": [2], "5": [4] },
  roomChapters: { "1": [3], "2": [3], "3": [3], "4": [3], "5": [3], "6": [2], "56": [3] },
};

const fullMap: Record<number, FakeDoor[]> = {
  1: [{ num: 11, to: 2 }, { num: 12, to: 3 }],
  2: [{ num: 21, to: 1 }, { num: 22, to: 4 }],
  3: [{ num: 31, to: 1 }],
  4: [{ num: 41, to: 2 }],
};

describe("walk order", () => {
  it("lists a chapter's census rooms", () => {
    expect(chapterRooms(census, 3)).toEqual([1, 2, 3, 4, 5, 56]);
    expect(chapterRooms(census, 2)).toEqual([6]);
  });

  it("is breadth first in census order", () => {
    expect(bfsOrder(census.exitGraph, 1, new Set([1, 2, 3, 4, 5]))).toEqual([1, 2, 3, 4]);
  });

  it("ignores rooms outside the allowed set", () => {
    expect(bfsOrder(census.exitGraph, 1, new Set([1, 3]))).toEqual([1, 3]);
  });

  it("finds the shortest known route over seen doors", () => {
    const doors: DoorMap = new Map([
      [1, new Map([[2, 11], [3, 12]])],
      [2, new Map([[1, 21], [4, 22]])],
      [4, new Map([[2, 41]])],
    ]);
    expect(findRoute(doors, 1, 4)).toEqual([{ door: 11, to: 2 }, { door: 22, to: 4 }]);
    expect(findRoute(doors, 3, 4)).toBeNull();
    expect(findRoute(doors, 2, 2)).toEqual([]);
  });

  it("records the first visible door per destination", () => {
    const doors: DoorMap = new Map();
    const obj = (num: number, visible: boolean) => ({
      num, name: "D", rect: [0, 0, 1, 1] as [number, number, number, number],
      walkTo: [0, 0] as [number, number], visible, door: true, toRoom: 9,
    });
    observeDoors(doors, {
      chapter: 3, room: 1, hero: { x: 0, y: 0 }, inventory: [], flags: [],
      objects: [obj(5, false), obj(6, true), obj(7, true)],
    });
    expect(doors.get(1)?.get(9)).toBe(6);
  });
});

describe("runSurvey with a mocked engine", () => {
  it("reaches rooms in breadth first order and dumps each one", async () => {
    const { driver } = fakeEngine(fullMap, 1);
    const { sink, written } = memorySink();
    const summary = await runSurvey(driver, { chapter: 3, slot: 30, census, sink, now: () => "2026-11-10" });

    expect([...written.keys()]).toEqual([1, 2, 3, 4]);
    expect(summary.rooms.map(verdictLine)).toEqual([
      "room 1: reached",
      "room 2: reached",
      "room 3: reached",
      "room 4: reached",
      "room 5: unreached (no route found from the start room (no door seen leading to it))",
      "room 56: unreached (cutscene-only room; needs a checkpoint saved inside it)",
    ]);
    expect(summary.slot).toBe(30);
  });

  it("writes the shape draft.ts reads", async () => {
    const { driver } = fakeEngine(fullMap, 1);
    const { sink, written } = memorySink();
    await runSurvey(driver, { chapter: 3, slot: 30, census, sink, now: () => "2026-11-10", engineBuild: "test" });

    const room2 = written.get(2)!;
    expect(room2.state.room).toBe(2);
    expect(room2.state.flags).toHaveLength(50);
    expect(room2.state.hotspots.find((h) => h.num === 22)).toMatchObject({ door: 1, toRoom: 4 });
    expect(room2.meta).toMatchObject({
      room: 2, checkpointSlot: 30, date: "2026-11-10", engineBuild: "test", screenshot: false,
    });
    expect(room2.meta.hotspots).toContainEqual({ num: 29, door: 0 });
    const thing = room2.verbs.probes.find((p) => p.num === 29)!;
    expect(thing.answered).toEqual(["look"]);
    expect(thing.lookText).toBe("look 29");
  });

  it("records a locked door as unreached and carries on", async () => {
    const map = { ...fullMap, 1: [{ num: 11, to: 2, locked: true }, { num: 12, to: 3 }] };
    const { driver } = fakeEngine(map, 1);
    const { sink, written } = memorySink();
    const summary = await runSurvey(driver, { chapter: 3, slot: 30, census, sink });

    expect([...written.keys()]).toEqual([1, 3]);
    const two = summary.rooms.find((r) => r.room === 2)!;
    expect(two.verdict).toBe("unreached");
    expect(two.reason).toContain("did not change room");
    expect(summary.blockedEdges.some((b) => b.from === 1 && b.to === 2)).toBe(true);
  });

  it("treats a stalled step as a failed step and continues", async () => {
    const map = { ...fullMap, 1: [{ num: 11, to: 2, stall: true }, { num: 12, to: 3 }] };
    const { driver } = fakeEngine(map, 1);
    const { sink, written } = memorySink();
    const summary = await runSurvey(driver, { chapter: 3, slot: 30, census, sink });

    expect(written.has(3)).toBe(true);
    expect(summary.failedSteps.some((f) => f.stalled && f.step === "walk 11")).toBe(true);
    expect(summary.rooms.find((r) => r.room === 2)?.reason).toContain("stalled");
  });

  it("gives every room an unreached verdict when start fails", async () => {
    const driver: EngineDriver = {
      call: async (tool) =>
        tool === "start"
          ? { data: { error: "start failed: boom" }, isError: true }
          : { data: {}, isError: false },
    };
    const { sink, written } = memorySink();
    const summary = await runSurvey(driver, { chapter: 3, slot: 30, census, sink });
    expect(written.size).toBe(0);
    expect(summary.rooms.every((r) => r.verdict === "unreached")).toBe(true);
    expect(summary.rooms[0]?.reason).toContain("start failed");
  });

  it("stops probing once the engine stops answering, without throwing", async () => {
    const calls = { n: 0 };
    const driver: EngineDriver = {
      async call(tool) {
        if (tool === "start") {
          return fakeEngine(fullMap, 1).driver.call("start");
        }
        calls.n++;
        return { data: { error: "no reply" }, isError: true, timedOut: true };
      },
    };
    const { sink } = memorySink();
    const summary = await runSurvey(driver, {
      chapter: 3, slot: 30, census, sink, maxConsecutiveStalls: 3,
    });
    expect(summary.rooms.find((r) => r.room === 1)?.verdict).toBe("reached");
    expect(summary.rooms.find((r) => r.room === 4)?.verdict).toBe("unreached");
    expect(summary.failedSteps.length).toBeGreaterThan(0);
  });
});

describe("Ledger", () => {
  it("reports reached, blocked and cutscene rooms", () => {
    const ledger = new Ledger();
    ledger.markReached(1);
    ledger.blockEdge(1, 2, "locked");
    const v = ledger.verdicts([56, 2, 1, 3], new Set([56]));
    expect(v.map((x) => x.room)).toEqual([1, 2, 3, 56]);
    expect(v[0]).toEqual({ room: 1, verdict: "reached" });
    expect(v[1]?.reason).toBe("from room 1: locked");
    expect(v[2]?.reason).toContain("no route");
    expect(v[3]?.reason).toContain("cutscene-only");
  });
});
