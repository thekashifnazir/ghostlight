// The always-on "worth a look" nudge (tester request, 14 Nov): the room readout
// ends with the current milestone's NUDGE (never clue or answer), or points to
// another room by name, and H then starts at the clue.
import { describe, expect, it } from "vitest";
import type { Milestone, Pack } from "../packs/tools/src/types.js";
import { nextTier } from "../src/hints/tiers.js";
import { worthALook } from "../src/hints/worth-a-look.js";

function m(partial: Partial<Milestone> & { id: string }): Milestone {
  return {
    chapter: 2,
    title: partial.id,
    recap: "",
    hints: { nudge: "Nudge text", clue: "CLUE TEXT", answer: "ANSWER TEXT" },
    ...partial,
  } as Milestone;
}
const packOf = (milestones: Milestone[]): Pack => ({ milestones }) as unknown as Pack;
const none = { chapter: 2, reached: new Set<string>() };
const names: Record<number, string> = { 14: "Inn bar", 18: "Von Braun's den" };
const roomName = (r: number): string | undefined => names[r];

describe("worthALook", () => {
  it("speaks the nudge when the target milestone is in this room", () => {
    const pack = packOf([m({ id: "a", rooms: [14], hints: { nudge: "It's late", clue: "c", answer: "a" } })]);
    expect(worthALook(pack, none, 14, roomName)).toBe("Worth a look: It's late.");
  });

  it("keeps the nudge's own end punctuation", () => {
    const pack = packOf([m({ id: "a", rooms: [14], hints: { nudge: "Try the piano?", clue: "c", answer: "a" } })]);
    expect(worthALook(pack, none, 14, roomName)).toBe("Worth a look: Try the piano?");
  });

  it("names another room when the target is elsewhere, without the nudge", () => {
    const pack = packOf([m({ id: "a", rooms: [18] })]);
    const line = worthALook(pack, none, 14, roomName);
    expect(line).toBe("Worth a look elsewhere: Von Braun's den.");
  });

  it("never uses the clue or the answer text", () => {
    const pack = packOf([m({ id: "a", rooms: [14] }), m({ id: "b", rooms: [18] })]);
    for (const room of [14, 18, 99]) {
      const line = worthALook(pack, none, room, roomName) ?? "";
      expect(line).not.toContain("CLUE TEXT");
      expect(line).not.toContain("ANSWER TEXT");
    }
  });

  it("says nothing when no milestone is offered", () => {
    const pack = packOf([m({ id: "a", rooms: [14] })]);
    expect(worthALook(pack, { chapter: 2, reached: new Set(["a"]) }, 14, roomName)).toBeUndefined();
  });

  it("says nothing when the other room has no name", () => {
    const pack = packOf([m({ id: "a", rooms: [77] })]);
    expect(worthALook(pack, none, 14, roomName)).toBeUndefined();
  });

  it("says nothing when the milestone has no rooms and isn't here", () => {
    const pack = packOf([m({ id: "a" })]);
    expect(worthALook(pack, none, 14, roomName)).toBeUndefined();
  });
});

describe("H after the nudge was spoken", () => {
  it("a nudge recorded as given makes the next H the clue", () => {
    const tiers = new Map<string, "nudge" | "clue" | "answer">([["a", "nudge"]]);
    expect(nextTier(tiers, "a")).toBe("clue");
  });
});
