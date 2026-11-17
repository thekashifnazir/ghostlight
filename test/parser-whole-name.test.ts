// A tester (16 Nov) couldn't type "push torch" in chapter 6: the exit is named
// "secret door to B.J.'s bedroom that opens after the torch", so the two tied and
// the parser asked "Did you mean ...". A tie now goes to the one name the query
// covers completely; real ties still ask.
import { describe, expect, it } from "vitest";
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

describe("ties go to the whole name", () => {
  const torch = hs("torch", 103);
  const door = hs("secret door to B.J.'s bedroom that opens after the torch", 104, "exit");

  it("push torch pushes the torch", () => {
    const m = parsePhrase("push torch", [door, torch], [], CTX);
    expect(m.kind).toBe("hotspot");
    if (m.kind === "hotspot") {
      expect(m.hotspot.num).toBe(103);
      expect(m.verb).toBe("push");
    }
  });

  it("the door is still reachable by its own words", () => {
    const m = parsePhrase("open secret door", [door, torch], [], CTX);
    expect(m.kind).toBe("hotspot");
    if (m.kind === "hotspot") expect(m.hotspot.num).toBe(104);
  });

  it("a real tie still asks", () => {
    const m = parsePhrase("look at door", [hs("left door", 1), hs("right door", 2)], [], CTX);
    expect(m.kind).toBe("ambiguous");
  });
});
