import { describe, expect, it } from "vitest";

import { ReplayTransport } from "../src/replay.js";
import { Session } from "../src/session.js";
import { Tools } from "../src/tools.js";
import type { Choice, Diff } from "../src/transport.js";

// Replay regression (Req 7.3, 3.1, 3.2, 5.3): drive the real tavern fixture
// through the MCP tool layer over the replay transport, and assert each tool
// returns the recorded parsed diff/events. The fixture is replayed in its full
// recorded order — the tavern fixture now records the inventory step as
// `inventory` (engine-a11y-layer task 28), the same spelling the shared
// serialiser emits, so no step needs omitting. This is the contract the native
// engine must also meet (same JSON shape, Req 5.3).

function tavern(): Tools {
  return new Tools(new Session(), () => new ReplayTransport("tavern"));
}

function handbag(): Tools {
  return new Tools(new Session(), () => new ReplayTransport("ch2-handbag"));
}

/** Pull the diff out of a command tool reply's shaped data. */
function diffOf(reply: { data: unknown }): Diff | undefined {
  return (reply.data as { diff?: Diff }).diff;
}

describe("tavern replay regression", () => {
  it("replays the recorded tavern run step by step", async () => {
    const tools = tavern();

    const start = await tools.start();
    expect((start.data as { room: number }).room).toBe(62);

    // 0. inventory: the first recorded step. The serialiser emits `inventory`
    //    and the fixture now records `inventory` (engine task 28), so the
    //    inventory tool replays against the real recorded A11Y_INV step.
    const inv = await tools.inventory();
    expect(inv.isError).toBe(false);
    expect(
      (inv.data as { items: { id: number; name: string; look?: string }[] }).items,
    ).toEqual([
      { id: 28, name: "phone", look: "THIS IS THE MOBILE PHONE I GOT LAST CHRISTMAS" },
    ]);

    // 1. look 102 (POSTER): speaks a line, nothing moves.
    const look = await tools.targetVerb("look", 102);
    expect(look.isError).toBe(false);
    expect(diffOf(look)?.changed).toBe(false);
    expect(diffOf(look)?.said?.[0]?.text).toMatch(/BEST BURGERS/);

    // 2. talk 53 (DRUNKARD): opens the four choices, option 4 ends it.
    const talk53 = await tools.targetVerb("talk", 53);
    const choices = (talk53.data as { events: { type: string }[] }).events.find(
      (e) => e.type === "choices",
    ) as { choices: Choice[] } | undefined;
    expect(choices?.choices).toHaveLength(4);
    expect(choices?.choices[3].ends).toBe(true);

    // 3. choose 2: speaks the player line and the drunkard reply.
    const choose2 = await tools.choose(2);
    const said2 = diffOf(choose2)?.said ?? [];
    expect(said2).toHaveLength(2);
    expect(said2[0].text).toMatch(/AND HOW IS THE FAMILY/);

    // 4. choose 4: the goodbye line, ends the conversation.
    const choose4 = await tools.choose(4);
    expect(diffOf(choose4)?.said?.[0]?.text).toMatch(/BETTER NOT SAY/);

    // 5. walk 105 before the bartender talk: the locked-room line, no change.
    const lockedDoor = await tools.targetVerb("walk", 105);
    expect(diffOf(lockedDoor)?.changed).toBe(false);
    expect(diffOf(lockedDoor)?.said?.[0]?.text).toMatch(/DON'T HAVE A ROOM/);

    // 6. talk 52 (BARTENDER): the chapter-1 progression, sets flag 0.
    const talk52 = await tools.targetVerb("talk", 52);
    expect(diffOf(talk52)?.changed).toBe(true);
    expect(diffOf(talk52)?.flags?.["0"]).toEqual([0, 1]);

    // 7. walk 105 again: now flag 0 is set, this is the chapter 1->2 crossing,
    //    one coherent diff carrying the new room's objects (skip consumed within).
    const crossing = await tools.targetVerb("walk", 105);
    const cd = diffOf(crossing);
    expect(cd?.chapter).toEqual([1, 2]);
    expect(cd?.room).toEqual([62, 14]);
    expect(cd?.changed).toBe(true);
    expect(cd?.objects?.some((o) => o.num === 162 && o.toRoom === 16)).toBe(true);

    // The session's tracked room followed the crossing into chapter 2 / room 14.
    // On the replay transport `state` falls back to the tracked room (no live
    // snapshot step), so this is the folded room the crossing diff produced.
    const state = await tools.state();
    expect((state.data as { chapter: number; room: number }).chapter).toBe(2);
    expect((state.data as { room: number }).room).toBe(14);
  });
});

describe("inventory folded from diffs (open 183 then open 22)", () => {
  // Regression (Crew surveyor): open 183 adds the handbag (22) via the diff's
  // invAdded, so open 22 must then be accepted as a held item. Before the fix,
  // heldItemIds() only reflected a room/state snapshot's inventory, never the
  // diff deltas, so open 22 was wrongly rejected as not held.
  it("accepts open 22 after open 183 adds the handbag to the tracked inventory", async () => {
    const tools = handbag();

    const start = await tools.start();
    expect((start.data as { room: number }).room).toBe(14);
    // Only the phone (28) is held at the start; the handbag (22) is not yet.
    expect((start.data as { inventory: number[] }).inventory).toEqual([28]);

    // Walk into room 16, where the trunk (183) lives.
    const walk = await tools.targetVerb("walk", 162);
    expect(walk.isError).toBe(false);
    expect(((await tools.state()).data as { room: number }).room).toBe(16);

    // Open the trunk: the diff's invAdded gains the handbag (22).
    const openTrunk = await tools.targetVerb("open", 183);
    expect(openTrunk.isError).toBe(false);
    expect(diffOf(openTrunk)?.invAdded).toEqual([{ id: 22, name: "handbag" }]);
    // The handbag is now tracked as held.
    expect(
      ((await tools.state()).data as { inventory: number[] }).inventory,
    ).toContain(22);

    // Open the now-held handbag (22): this is the bug. It must be ACCEPTED
    // (reach the transport and return the recorded diff), not rejected.
    const openHandbag = await tools.targetVerb("open", 22);
    expect(openHandbag.isError).toBe(false);
    expect(diffOf(openHandbag)?.said?.[0]?.text).toMatch(/ONE THOUSAND BILL/);
    // Its contents (money 7, two coins 18) fold into the tracked inventory too.
    const held = ((await tools.state()).data as { inventory: number[] }).inventory;
    expect(held).toContain(7);
    expect(held).toContain(18);
  });
});
