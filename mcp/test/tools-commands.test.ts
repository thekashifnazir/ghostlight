import { describe, expect, it } from "vitest";

import { ReplayTransport } from "../src/replay.js";
import { Session } from "../src/session.js";
import { Tools } from "../src/tools.js";
import type { Choice } from "../src/transport.js";

// Drive the real tavern fixture through the tool layer over the replay
// transport in its full recorded order. The tavern fixture records the
// inventory step as `inventory` (engine-a11y-layer task 28) — the same spelling
// the shared serialiser emits — so the whole fixture replays with no omission.
function tavernTools(): Tools {
  return new Tools(new Session(), () => new ReplayTransport("tavern"));
}

describe("Tools command wiring over replay (task 8)", () => {
  it("talk 53 returns the four conversation choices", async () => {
    const tools = tavernTools();
    await tools.start();
    // Fixture order: inventory, look 102, then talk 53.
    await tools.inventory();
    await tools.targetVerb("look", 102);
    const talk = await tools.targetVerb("talk", 53);
    expect(talk.isError).toBe(false);
    const choices = (talk.data as { events: { type: string }[] }).events.find(
      (e) => e.type === "choices",
    ) as { type: "choices"; choices: Choice[] } | undefined;
    expect(choices?.choices).toHaveLength(4);
    expect(choices?.choices[3].ends).toBe(true);
  });

  it("look 999 is rejected (error-flagged) before it reaches the transport", async () => {
    const tools = tavernTools();
    await tools.start();
    const r = await tools.targetVerb("look", 999);
    expect(r.isError).toBe(true);
    expect((r.data as { error: string }).error).toMatch(/not a hotspot/);
  });

  it("look 102 returns a diff with the spoken line and changed:false", async () => {
    const tools = tavernTools();
    await tools.start();
    // The inventory step is the first recorded command; consume it first so
    // look 102 matches the next recorded command.
    await tools.inventory();
    const r = await tools.targetVerb("look", 102);
    expect(r.isError).toBe(false);
    const data = r.data as { diff?: { changed: boolean; said?: { text: string }[] } };
    expect(data.diff?.changed).toBe(false);
    expect(data.diff?.said?.[0]?.text).toMatch(/BURGERS/);
  });
});
