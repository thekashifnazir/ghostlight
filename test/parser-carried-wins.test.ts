// A carried item wins a name tie with a room thing. Behind the castle tree
// (chapter 4, room 22) the branch you cut is still listed in the room, so
// typed "use rope on branch" went to the room's branch (use 19 140) and said
// "Nothing happened." instead of tying the rope to the branch you carry
// (use 19 18). A blind tester, 20 Nov; found by the QuestAloud session. "give"
// and "throw" now count as use verbs too.
import { describe, expect, it } from "vitest";
import type { InvItem } from "../src/engine/adapter.js";
import type { Hotspot } from "../src/model/hotspot-list.js";
import { parsePhrase } from "../src/model/parser.js";

const CTX = { inConversation: false, pendingChoice: false };
const hs = (name: string, num: number, kind: Hotspot["kind"] = "object"): Hotspot => ({
  num,
  kind,
  name,
  rect: [num, 0, 5, 5],
  walkTo: [0, 0],
});

const roomBranch = hs("branch", 140);
const magpie = hs("magpie", 52, "npc");
const rope: InvItem = { id: 19, name: "rope" };
const branch: InvItem = { id: 18, name: "branch" };

describe("a carried item wins a name tie with a room thing", () => {
  it("use rope on branch behind the tree ties it to the carried branch", () => {
    const m = parsePhrase("use rope on branch", [roomBranch, magpie], [rope, branch], CTX);
    expect(m).toMatchObject({ kind: "use", item: { id: 19 }, target: { id: 18 } });
  });

  it("the other way round too", () => {
    const m = parsePhrase("use branch with rope", [roomBranch, magpie], [rope, branch], CTX);
    expect(m).toMatchObject({ kind: "use", item: { id: 18 }, target: { id: 19 } });
  });

  it("with no carried branch, the room's branch is the target", () => {
    const m = parsePhrase("use rope on branch", [roomBranch, magpie], [rope], CTX);
    expect(m).toMatchObject({ kind: "use", item: { id: 19 }, target: { num: 140 } });
  });

  it("a better room match still beats a weaker carried one", () => {
    const m = parsePhrase("use rope on magpie", [roomBranch, magpie], [rope, branch], CTX);
    expect(m).toMatchObject({ kind: "use", item: { id: 19 }, target: { num: 52 } });
  });

  it("throw is a use: throw bone at window (the tester's own words)", () => {
    const bone: InvItem = { id: 8, name: "bone" };
    const window = hs("window", 51);
    expect(parsePhrase("throw bone at window", [window], [bone], CTX)).toMatchObject({
      kind: "use",
      item: { id: 8 },
      target: { num: 51 },
    });
  });
});
