import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { cacheFileName, cacheKey } from "../src/hints/cache.js";

const VOICE = "nbk2esDn4RRk4cVDdoiE";
const MODEL = "eleven_v4";

// The ghost's mp3 files are named by this key, so it must stay the plain
// SHA-256 of the canonical join, whichever runtime computes it.
function expected(text: string, voice: string, model: string): string {
  return createHash("sha256").update([text, voice, model].join("\u0000"), "utf8").digest("hex");
}

describe("cacheKey is the SHA-256 of the canonical join", () => {
  it("matches a direct node:crypto hash", async () => {
    const text = "There are three people in the bar you can talk to.";
    const key = await cacheKey(text, VOICE, MODEL);
    expect(key).toBe(expected(text, VOICE, MODEL));
    expect(key).toMatch(/^[0-9a-f]{64}$/); // 32-byte SHA-256 hex
  });

  it("matches across a range of hint-like strings", async () => {
    const samples = [
      "You've just arrived. Have a look around the bar.",
      "Talk to the bartender, the drunk and the pianist.",
      "", // empty text
      "unicode: café, señor, naïve",
    ];
    for (const text of samples) {
      expect(await cacheKey(text, VOICE, MODEL)).toBe(expected(text, VOICE, MODEL));
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
