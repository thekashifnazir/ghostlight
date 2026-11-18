// A split word can be part of an item's name. "use scotch on the rocks on
// Drascula" split at the first "on" and read as the scotch used on itself
// (use 21 21), found on a run through the ending, 18 Nov. A later split now
// wins when every word before it is in the item's name and it uses the item
// on something else; otherwise the first split stands, as before.
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

const drascula = hs("Drascula", 56, "npc");
const bartender = hs("bartender", 52, "npc");
const piano = hs("piano", 112);
const scotch: InvItem = { id: 21, name: "scotch on the rocks" };
const crucifix: InvItem = { id: 9, name: "crucifix" };
const room = [bartender, drascula, piano];
const inv = [crucifix, scotch];

const use = (phrase: string) => parsePhrase(phrase, room, inv, CTX);

describe("an item whose name holds a split word", () => {
  it("use scotch on the rocks on Drascula uses it on Drascula", () => {
    const m = use("use scotch on the rocks on Drascula");
    expect(m).toMatchObject({ kind: "use", item: { id: 21 }, target: { num: 56 } });
  });

  it("give scotch on the rocks to the bartender", () => {
    const m = use("give scotch on the rocks to the bartender");
    expect(m).toMatchObject({ kind: "use", item: { id: 21 }, target: { num: 52 } });
  });

  it("the short name still works", () => {
    expect(use("use scotch with Drascula")).toMatchObject({
      kind: "use",
      item: { id: 21 },
      target: { num: 56 },
    });
  });

  it("an item used on another carried item", () => {
    expect(use("use scotch on the rocks on crucifix")).toMatchObject({
      kind: "use",
      item: { id: 21 },
      target: { id: 9 },
    });
  });

  it("use scotch on the rocks on me is a use on the hero", () => {
    expect(use("use scotch on the rocks on me")).toMatchObject({ kind: "useSelf", item: { id: 21 } });
  });

  it("words before a later split that are not in the name keep the first split", () => {
    // "crucifix on Drascula" is not part of any item's name, so this stays
    // the crucifix used on the target after the first "on".
    expect(use("use crucifix on Drascula on piano")).toMatchObject({
      kind: "use",
      item: { id: 9 },
    });
  });

  it("use rope tied to a branch on the tree (chapter 4's item)", () => {
    const rope: InvItem = { id: 21, name: "rope tied to a branch" };
    const tree = hs("tree", 120);
    const m = parsePhrase("use rope tied to a branch on the tree", [tree], [rope], CTX);
    expect(m).toMatchObject({ kind: "use", item: { id: 21 }, target: { num: 120 } });
  });

  it("an ordinary use is unchanged", () => {
    expect(use("use crucifix on Drascula")).toMatchObject({
      kind: "use",
      item: { id: 9 },
      target: { num: 56 },
    });
  });
});
