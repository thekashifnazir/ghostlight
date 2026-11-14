import { describe, expect, it } from "vitest";
import { GUIDE_SEEN_KEY, guidePages, guideSeen, markGuideSeen } from "../src/ui/guide.js";

describe("How to play guide", () => {
  it("has 5 short pages and ends with the screen-reader tip", () => {
    const pages = guidePages("TIP");
    expect(pages.map((p) => p.title)).toEqual([
      "Moving around",
      "Using things",
      "Talking",
      "Getting help",
      "Saving and more",
    ]);
    for (const p of pages) expect(p.lines.length).toBeLessThanOrEqual(4);
    expect(pages[4].lines.at(-1)).toBe("TIP");
  });

  it("remembers being seen, and survives storage that throws or is missing", () => {
    const map = new Map<string, string>();
    const storage = {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
    } as unknown as Storage;
    expect(guideSeen(storage)).toBe(false);
    markGuideSeen(storage);
    expect(map.get(GUIDE_SEEN_KEY)).toBe("1");
    expect(guideSeen(storage)).toBe(true);

    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    } as unknown as Storage;
    expect(guideSeen(broken)).toBe(false);
    expect(() => markGuideSeen(broken)).not.toThrow();
    expect(guideSeen(undefined)).toBe(false);
  });
});
