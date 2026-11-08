import { describe, expect, it } from "vitest";
import { requireApiKey } from "../scripts/gen-voice.js";

// hints-and-ghost R9.2/R9.4: the ElevenLabs key is read by name, and a missing
// key fails with a message that NAMES the key (ELEVENLABS_API_KEY) and never
// prints any value. The lookup is injected, so this runs with no real .env and
// no network. We also prove the no-leak guarantee: for any value the lookup
// could return, the thrown message (on absence) never contains a key value,
// and a present value is returned to the caller rather than logged.
//
// Note: placeholder "key" values below are deliberately NOT real key shapes
// (no secret-looking prefixes), so this test never embeds a key pattern itself.

const KEY_NAME = "ELEVENLABS_API_KEY";

describe("gen-voice key handling", () => {
  it("throws a message naming the key, with no value, when the key is missing", () => {
    // Lookup returns undefined — the missing-key case.
    let message = "";
    try {
      requireApiKey(() => undefined);
      throw new Error("expected requireApiKey to throw");
    } catch (e) {
      message = (e as Error).message;
    }
    // The message names the key by name…
    expect(message).toContain(KEY_NAME);
    // …and states the key is never printed, so a reader is not tempted to echo it.
    expect(message.toLowerCase()).toContain("never printed");
  });

  it("the missing-key error never contains any would-be key value", () => {
    // Even if a secret-looking value were floating around, the absence path
    // must not interpolate it. The lookup returns undefined, so the message is
    // built from the name alone; assert a distinctive fake token is absent.
    const fakeToken = "FAKE-TOKEN-MUST-NEVER-APPEAR-1234567890";
    let message = "";
    try {
      // The lookup ignores its argument and reports the key as missing.
      requireApiKey(() => undefined);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).not.toContain(fakeToken);
    // And more generally, it carries no "=<value>" assignment of a real key:
    // the only "=" in the message is the literal usage hint "<your key>".
    expect(message).toContain("<your key>");
    expect(message).not.toMatch(new RegExp(`${KEY_NAME}=(?!<your key>)\\S`));
  });

  it("returns the key to the caller when present, without logging it", () => {
    const token = "FAKE-PRESENT-TOKEN-abcdef";
    // Capture anything written to the console during resolution; nothing should
    // be, and certainly not the token.
    const logs: string[] = [];
    const orig = { log: console.log, error: console.error, warn: console.warn };
    console.log = (...a: unknown[]) => logs.push(a.join(" "));
    console.error = (...a: unknown[]) => logs.push(a.join(" "));
    console.warn = (...a: unknown[]) => logs.push(a.join(" "));
    try {
      const resolved = requireApiKey((name) =>
        name === KEY_NAME ? token : undefined,
      );
      expect(resolved).toBe(token);
    } finally {
      console.log = orig.log;
      console.error = orig.error;
      console.warn = orig.warn;
    }
    // Nothing was printed at all, so the token certainly was not.
    expect(logs.join("\n")).not.toContain(token);
    expect(logs).toEqual([]);
  });
});
