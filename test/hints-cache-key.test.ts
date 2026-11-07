import { describe, expect, it } from "vitest";
import {
  cacheFileName,
  cacheKey,
  cacheKeyNode,
  cacheKeyWeb,
} from "../src/hints/cache.js";

const VOICE = "nbk2esDn4RRk4cVDdoiE";
const MODEL = "eleven_v4";

describe("cacheKeyNode and cacheKeyWeb agree, and cacheKey matches both", () => {
  it("produce identical keys for the same inputs", async () => {
    const text = "There are three people in the bar you can talk to.";
    const node = await cacheKeyNode(text, VOICE, MODEL);
    const web = await cacheKeyWeb(text, VOICE, MODEL);
    const auto = await cacheKey(text, VOICE, MODEL);
    expect(node).toBe(web);
    expect(auto).toBe(node); // the runtime-agnostic entry agrees with both
    expect(node).toMatch(/^[0-9a-f]{64}$/); // 32-byte SHA-256 hex
  });

  it("agree across a range of hint-like strings", async () => {
    const samples = [
      "You've just arrived. Have a look around the bar.",
      "Talk to the bartender, the drunk and the pianist.",
      "", // empty text
      "unicode: café, señor, naïve",
    ];
    for (const text of samples) {
      expect(await cacheKeyNode(text, VOICE, MODEL)).toBe(
        await cacheKeyWeb(text, VOICE, MODEL),
      );
    }
  });

  it("changes when the text changes", async () => {
    const a = await cacheKey("alpha", VOICE, MODEL);
    const b = await cacheKey("beta", VOICE, MODEL);
    expect(a).not.toBe(b);
  });

  it("changes when the voice changes", async () => {
    const a = await cacheKey("same text", VOICE, MODEL);
    const b = await cacheKey("same text", "other-voice-id", MODEL);
    expect(a).not.toBe(b);
  });

  it("changes when the model changes", async () => {
    const a = await cacheKey("same text", VOICE, MODEL);
    const b = await cacheKey("same text", VOICE, "eleven_v3");
    expect(a).not.toBe(b);
  });

  it("cacheFileName appends .mp3", () => {
    expect(cacheFileName("abc123")).toBe("abc123.mp3");
  });
});
