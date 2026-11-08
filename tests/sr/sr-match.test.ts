import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { reduceSpeech, matchStep } from "./sr-match.js";

// Unit tests for the speech-log reducer and matcher (Requirement 10.3), driven
// by the two committed sample NVDA logs. No VM, no network.

const here = __dirname;
const passLog = readFileSync(join(here, "sample-pass.log"), "utf8").split(/\r?\n/);
const failLog = readFileSync(join(here, "sample-fail.log"), "utf8").split(/\r?\n/);

describe("reduceSpeech", () => {
  it("strips NVDA wrappers and drops Chrome focus lines", () => {
    const out = reduceSpeech(passLog);
    expect(out).toEqual([
      "bin, 2 of 10",
      "A dented metal bin by the tavern wall.",
      "Inventory, 1 item.",
    ]);
    // The "Google Chrome', 'window'" focus line is gone.
    expect(out.join("\n")).not.toContain("Google Chrome");
  });

  it("drops the document focus line from the fail log", () => {
    const out = reduceSpeech(failLog);
    expect(out).toEqual(["no next list", "Control and reprogram MIDI devices?"]);
    expect(out.join("\n")).not.toContain("document");
  });

  it("ignores non-Speaking lines", () => {
    expect(reduceSpeech(["INFO - some nvda log noise", "DEBUG - more"])).toEqual([]);
  });
});

describe("matchStep", () => {
  const passUtterances = reduceSpeech(passLog);
  const failUtterances = reduceSpeech(failLog);

  it("passes when every expectSpoken substring is present", () => {
    const v = matchStep(passUtterances, { keys: "right", expectSpoken: ["2 of 10", "bin"] });
    expect(v.pass).toBe(true);
    expect(v.missing).toEqual([]);
  });

  it("fails and lists the missing expectSpoken substring", () => {
    const v = matchStep(passUtterances, { keys: "right", expectSpoken: ["crypt door"] });
    expect(v.pass).toBe(false);
    expect(v.missing).toEqual(["crypt door"]);
  });

  it("fails when an expectNotSpoken substring is present", () => {
    const v = matchStep(failUtterances, {
      keys: "boot",
      expectNotSpoken: ["Control and reprogram MIDI devices"],
    });
    expect(v.pass).toBe(false);
    expect(v.forbidden).toEqual(["Control and reprogram MIDI devices"]);
  });

  it("passes when the expectNotSpoken substring is absent", () => {
    const v = matchStep(passUtterances, { keys: "boot", expectNotSpoken: ["MIDI"] });
    expect(v.pass).toBe(true);
    expect(v.forbidden).toEqual([]);
  });

  it("matches case-insensitively", () => {
    const v = matchStep(passUtterances, { keys: "right", expectSpoken: ["BIN, 2 OF 10"] });
    expect(v.pass).toBe(true);
  });

  it("fails a step that expected speech but produced none", () => {
    const v = matchStep([], { keys: "right", expectSpoken: ["anything"] });
    expect(v.pass).toBe(false);
    expect(v.missing).toEqual(["anything"]);
  });

  it("passes an expectNotSpoken-only step on empty speech", () => {
    const v = matchStep([], { keys: "right", expectNotSpoken: ["MIDI"] });
    expect(v.pass).toBe(true);
  });

  it("returns the utterances it saw for the report", () => {
    const v = matchStep(passUtterances, { keys: "right", expectSpoken: ["bin"] });
    expect(v.utterances).toEqual(passUtterances);
  });
});
