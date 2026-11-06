import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { EngineEvent } from "../src/engine/adapter.js";
import { ReplayAdapter } from "../src/engine/replay-adapter.js";

function fixture(name: string): string {
  const url = new URL(`../src/fixtures/${name}`, import.meta.url);
  return readFileSync(fileURLToPath(url), "utf8");
}

/** Collect events from an adapter into an array for assertions. */
function recorder() {
  const events: EngineEvent[] = [];
  return {
    events,
    listen: (e: EngineEvent) => {
      events.push(e);
    },
  };
}

describe("ReplayAdapter", () => {
  it("start() emits up to and including the first room state", async () => {
    const adapter = new ReplayAdapter(fixture("tavern.a11y.log"));
    const rec = recorder();
    adapter.onEvent(rec.listen);
    await adapter.start();

    expect(rec.events).toHaveLength(1);
    expect(rec.events[0].type).toBe("room");
    if (rec.events[0].type !== "room") throw new Error("type");
    expect(rec.events[0].state.room).toBe(62);
    expect(rec.events[0].state.objects).toHaveLength(10);
  });

  it("a matching command emits its interleaved text and diff", async () => {
    const adapter = new ReplayAdapter(fixture("tavern.a11y.log"));
    const rec = recorder();
    adapter.onEvent(rec.listen);
    await adapter.start();
    rec.events.length = 0; // drop the boot room state

    adapter.send({ verb: "look", target: 52 });

    // The recording for `look 52` is a text line then a diff.
    const types = rec.events.map((e) => e.type);
    expect(types).toEqual(["text", "diff"]);
    const diff = rec.events.find((e) => e.type === "diff");
    if (diff?.type !== "diff") throw new Error("no diff");
    expect(diff.diff.cmd).toBe("look 52");
    expect(diff.diff.changed).toBe(false);
  });

  it("advances across several commands in recorded order", async () => {
    const adapter = new ReplayAdapter(fixture("tavern.a11y.log"));
    const rec = recorder();
    adapter.onEvent(rec.listen);
    await adapter.start();
    rec.events.length = 0;

    adapter.send({ verb: "look", target: 52 });
    adapter.send({ verb: "look", target: 100 });
    adapter.send({ verb: "talk", target: 52 });

    const diffs = rec.events.filter((e) => e.type === "diff");
    expect(diffs.map((d) => (d.type === "diff" ? d.diff.cmd : ""))).toEqual([
      "look 52",
      "look 100",
      "talk 52",
    ]);
    // talk 52 gives the room key and sets flag 0.
    const talk = diffs[2];
    if (talk.type !== "diff") throw new Error("type");
    expect(talk.diff.invAdded).toEqual([{ id: 7, name: "room key" }]);
  });

  it("a mismatching command surfaces a clear error and does not advance", async () => {
    const adapter = new ReplayAdapter(fixture("tavern.a11y.log"));
    const rec = recorder();
    adapter.onEvent(rec.listen);
    await adapter.start();
    rec.events.length = 0;

    // The recording's next command is `look 52`; send something else.
    adapter.send({ verb: "take", target: 999 });

    expect(rec.events).toHaveLength(1);
    const ev = rec.events[0];
    expect(ev.type).toBe("error");
    if (ev.type !== "error") throw new Error("type");
    expect(ev.message).toContain("replay mismatch");
    expect(ev.message).toContain("take 999");
    expect(ev.message).toContain("look 52");

    // The cursor did not move: the correct command still works next.
    rec.events.length = 0;
    adapter.send({ verb: "look", target: 52 });
    expect(rec.events.some((e) => e.type === "diff")).toBe(true);
  });

  it("replays a chapter-crossing diff as one settled response", async () => {
    const adapter = new ReplayAdapter(fixture("leave-tavern.a11y.log"));
    const rec = recorder();
    adapter.onEvent(rec.listen);
    await adapter.start();
    rec.events.length = 0;

    adapter.send({ verb: "walk", target: 105 });

    const diff = rec.events.find((e) => e.type === "diff");
    if (diff?.type !== "diff") throw new Error("no diff");
    expect(diff.diff.chapter).toEqual([1, 2]);
    expect(diff.diff.room).toEqual([62, 14]);
    expect(diff.diff.objects?.length).toBeGreaterThan(0);
  });

  it("replays use-item-on-hotspot with item spent and gained", async () => {
    const adapter = new ReplayAdapter(fixture("ch2-vending.a11y.log"));
    const rec = recorder();
    adapter.onEvent(rec.listen);
    await adapter.start();
    rec.events.length = 0;

    adapter.send({ verb: "look", target: 188 });
    adapter.send({ verb: "use", item: 13, target: 188 });

    const diff = rec.events.at(-1);
    if (diff?.type !== "diff") throw new Error("no diff");
    expect(diff.diff.cmd).toBe("use 13 188");
    expect(diff.diff.invRemoved).toEqual([{ id: 13, name: "coins" }]);
    expect(diff.diff.invAdded).toEqual([{ id: 14, name: "cigarettes" }]);
  });
});
