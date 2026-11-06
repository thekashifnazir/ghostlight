// Task 21: replay transcripts as regression fixtures.
//
// The four spike-04 command scripts (tavern, leave-tavern, ch2 handbag, ch2
// vending machine) are replayed through the EngineHarness and the A11Y_DIFF
// sequence is asserted. Today the harness is fixture-backed; the spec says
// replay runs use the native build in a real window, so when NativeHarness is
// wired these same assertions run against the real engine and the fixtures
// become the golden transcript.

import { describe, expect, it } from "vitest";
import { FIXTURE_NAMES, FixtureHarness, loadFixture } from "./src/fixture.js";
import type { FixtureName } from "./src/fixture.js";
import { diffOf, erredOf, roomStateOf } from "./src/harness.js";
import type { A11yLine, Diff } from "./src/lines.js";

/** Drive a fixture end to end; return every line, grouped by command. */
async function replay(
  name: FixtureName,
): Promise<{ cmd: string; lines: A11yLine[] }[]> {
  const harness = FixtureHarness.load(name);
  await harness.start();
  const out: { cmd: string; lines: A11yLine[] }[] = [];
  for (const cmd of harness.commands()) {
    out.push({ cmd, lines: await harness.send(cmd) });
  }
  await harness.stop();
  return out;
}

/** The ordered diff lines a replay produced (skipping commands that erred). */
function diffSequence(steps: { cmd: string; lines: A11yLine[] }[]): Diff[] {
  const diffs: Diff[] = [];
  for (const step of steps) {
    const d = diffOf(step.lines);
    if (d) diffs.push(d);
  }
  return diffs;
}

describe("replay fixtures: structure every command obeys", () => {
  for (const name of FIXTURE_NAMES) {
    it(`${name}: every command echoes A11Y_CMD then one diff or one err`, async () => {
      const steps = await replay(name);
      for (const { cmd, lines } of steps) {
        // The command's own echo is always present. A settling command may also
        // echo a queued command it consumed (e.g. a `skip` honoured during the
        // cutscene that a chapter-crossing walk triggers), so allow more than
        // one A11Y_CMD as long as this command's echo is among them (R2.4).
        const cmds = lines.filter((l) => l.kind === "cmd");
        expect(cmds.length, `A11Y_CMD echo for "${cmd}"`).toBeGreaterThanOrEqual(
          1,
        );
        expect(cmds[0]).toMatchObject({ text: cmd });

        const diffs = lines.filter((l) => l.kind === "diff").length;
        const errs = lines.filter((l) => l.kind === "err").length;
        // Exactly one diff, or at least one err and no diff. Never both,
        // never neither (Requirement 4.1, 2.5).
        const ok = (diffs === 1 && errs === 0) || (diffs === 0 && errs >= 1);
        expect(
          ok,
          `"${cmd}" must yield one A11Y_DIFF or one A11Y_ERR, got ${diffs} diff / ${errs} err`,
        ).toBe(true);
      }
    });

    it(`${name}: each diff names the command that produced it`, async () => {
      const steps = await replay(name);
      for (const { cmd, lines } of steps) {
        const d = diffOf(lines);
        if (d) expect(d.cmd).toBe(cmd);
      }
    });
  }
});

describe("replay fixtures: the recorded A11Y_DIFF sequence", () => {
  it("tavern: room entry, verb, conversation, flag, locked door, chapter crossing", async () => {
    const steps = await replay("tavern");
    const start = loadFixture("tavern").start;

    // Room entry (Requirement 1): first playable room is chapter 1, room 62.
    expect(start.chapter).toBe(1);
    expect(start.room).toBe(62);
    // Hero point is curX + curWidth/2, curY + curHeight in object space (R5).
    expect(start.hero).toEqual({ x: 171, y: 158 });

    const seq = diffSequence(steps).map((d) => d.cmd);
    expect(seq).toEqual([
      "inv",
      "look 102",
      "talk 53",
      "choose 2",
      "choose 4",
      "walk 105",
      "talk 52",
      "walk 105",
      "skip",
    ]);

    // Conversation: talk 53 opens choices, choose 2 marks it used and speaks
    // the exchange, choose 4 ends it (R6.3, R7).
    const talk = steps.find((s) => s.cmd === "talk 53")!;
    const choices = talk.lines.find((l) => l.kind === "choices");
    expect(choices?.kind === "choices" && choices.choices).toHaveLength(4);
    expect(choices?.kind === "choices" && choices.choices[3]?.ends).toBe(true);

    const choose2 = diffOf(steps.find((s) => s.cmd === "choose 2")!.lines)!;
    expect(choose2.said?.map((s) => s.color)).toEqual(["yellow", "darkgreen"]);
    expect(choose2.changed).toBe(false);

    // Flag change: talking to the bartender sets flag 0 (R4.6).
    const talk52 = diffOf(steps.find((s) => s.cmd === "talk 52")!.lines)!;
    expect(talk52.flags).toEqual({ "0": [0, 1] });
    expect(talk52.changed).toBe(true);

    // Locked door text before flag 0: the first walk 105 says the room line
    // and does not change room (R3.8, "I DON'T HAVE A ROOM YET").
    const firstWalk = diffOf(
      steps.filter((s) => s.cmd === "walk 105")[0]!.lines,
    )!;
    expect(firstWalk.room).toBeUndefined();
    expect(firstWalk.said?.[0]?.text).toContain("I DON'T HAVE A ROOM YET");

    // Chapter crossing: the second walk 105 is one coherent diff carrying
    // chapter [1,2], room [62,14] and the new room's objects (R4.3, gotcha 8).
    const crossing = diffOf(
      steps.filter((s) => s.cmd === "walk 105")[1]!.lines,
    )!;
    expect(crossing.chapter).toEqual([1, 2]);
    expect(crossing.room).toEqual([62, 14]);
    const doorToRoom = crossing.objects?.find((o) => o.num === 171);
    expect(doorToRoom?.toRoom).toBe(15);
  });

  it("leave-tavern: the door/cutscene/chapter crossing in one diff", async () => {
    const steps = await replay("leave-tavern");
    expect(steps).toHaveLength(1);
    const d = diffOf(steps[0]!.lines)!;
    expect(d.cmd).toBe("walk 105");
    expect(d.chapter).toEqual([1, 2]);
    expect(d.room).toEqual([62, 14]);
    // Doors in the new room carry their destination (R4.3).
    for (const o of d.objects ?? []) {
      if (o.door) expect(typeof o.toRoom).toBe("number");
    }
  });

  it("ch2-handbag: door walk, open trunk, open handbag on inventory screen", async () => {
    const steps = await replay("ch2-handbag");
    const seq = diffSequence(steps).map((d) => d.cmd);
    expect(seq).toEqual(["walk 162", "open 183", "open 22"]);

    // Door walk changes room 14 -> 16 (R3.8, R4.3).
    const walk = diffOf(steps.find((s) => s.cmd === "walk 162")!.lines)!;
    expect(walk.room).toEqual([14, 16]);

    // Open the trunk: handbag gained, flags 19/20 set (R4.5, R4.6).
    const trunk = diffOf(steps.find((s) => s.cmd === "open 183")!.lines)!;
    expect(trunk.invAdded).toEqual([{ id: 22, name: "handbag" }]);
    expect(trunk.flags).toEqual({ "19": [0, 1], "20": [0, 1] });

    // Open the handbag on the inventory screen: money and two coins gained.
    const handbag = diffOf(steps.find((s) => s.cmd === "open 22")!.lines)!;
    expect(handbag.invAdded).toEqual([
      { id: 7, name: "money" },
      { id: 18, name: "two coins" },
    ]);
  });

  it("ch2-vending-machine: use-item-on-object, item return, error case, push", async () => {
    const steps = await replay("ch2-vending-machine");

    // use 18 188: two coins go in, one coin comes back; the net diff shows the
    // swap, not the transient pickup (R3.4, R3.5, R4.5).
    const use = diffOf(steps.find((s) => s.cmd === "use 18 188")!.lines)!;
    expect(use.invRemoved).toEqual([{ id: 18, name: "two coins" }]);
    expect(use.invAdded).toEqual([{ id: 19, name: "one coin" }]);
    expect(use.flags).toEqual({ "27": [1, 0] });

    // The error case: a verb on an object not in the room yields an A11Y_ERR
    // and no diff, and the run keeps going (R2.5).
    const bad = steps.find((s) => s.cmd === "take 999")!;
    expect(erredOf(bad.lines)).toBe(true);
    expect(diffOf(bad.lines)).toBeNull();

    // push 188: the cigarettes come out, flags 26/27 set (R4.5, R4.6).
    const push = diffOf(steps.find((s) => s.cmd === "push 188")!.lines)!;
    expect(push.invAdded).toEqual([{ id: 16, name: "cigarettes" }]);
    expect(push.flags).toEqual({ "26": [0, 1], "27": [0, 1] });
  });
});

describe("replay fixtures: room-change diffs agree with the next room state", () => {
  // Requirement 4.3 / the property in task 22: when a diff changes room, the
  // target room matches the objects it carries. Here we check the diff's own
  // room target is consistent with a door that led there.
  for (const name of FIXTURE_NAMES) {
    it(`${name}: a room-change diff carries the new room's objects`, async () => {
      const steps = await replay(name);
      for (const { lines } of steps) {
        const d = diffOf(lines);
        if (d?.room) {
          expect(d.objects, "room change must carry objects").toBeDefined();
          expect((d.objects ?? []).length).toBeGreaterThan(0);
        }
        // A room-state line emitted alongside (dump, or future room entry)
        // must match the diff's target room when both are present.
        const rs = roomStateOf(lines);
        if (d?.room && rs) expect(rs.room).toBe(d.room[1]);
      }
    });
  }
});
