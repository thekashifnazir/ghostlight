import { describe, it, expect } from "vitest";
import { parseScenario, ScenarioError, type Scenario } from "./sr-parse.js";

// Unit tests for the scenario parser (Requirement 10.2). Pure: no VM, no file
// access — parseScenario takes the JSON text directly, so every case is a
// string in, a Scenario or a located ScenarioError out.

const VALID = JSON.stringify({
  name: "tavern",
  fixture: "tavern",
  steps: [
    { keys: "start", expectSpoken: ["tavern"], note: "Start" },
    { keys: "right", expectSpoken: ["2 of"], expectNotSpoken: ["review"], waitMs: 1500 },
  ],
});

describe("parseScenario — valid", () => {
  it("parses a well-formed scenario with all fields", () => {
    const s: Scenario = parseScenario(VALID, "tavern");
    expect(s.name).toBe("tavern");
    expect(s.fixture).toBe("tavern");
    expect(s.steps).toHaveLength(2);
    expect(s.steps[0]).toMatchObject({ keys: "start", expectSpoken: ["tavern"], note: "Start" });
    expect(s.steps[1]).toMatchObject({
      keys: "right",
      expectSpoken: ["2 of"],
      expectNotSpoken: ["review"],
      waitMs: 1500,
    });
  });

  it("accepts a step with only the required keys field", () => {
    const s = parseScenario(JSON.stringify({ name: "n", steps: [{ keys: "esc" }] }), "n");
    expect(s.steps[0]).toEqual({ keys: "esc" });
  });

  it("parses waitForSpoken alongside waitMs (await with a cap)", () => {
    const text = JSON.stringify({
      name: "n",
      steps: [{ keys: "start", waitForSpoken: "Left and Right", waitMs: 15000 }],
    });
    const s = parseScenario(text, "n");
    expect(s.steps[0]).toEqual({ keys: "start", waitForSpoken: "Left and Right", waitMs: 15000 });
  });
});

describe("parseScenario — invalid, each error located", () => {
  it("throws on malformed JSON, naming the source", () => {
    expect(() => parseScenario("{ not json", "broken")).toThrow(ScenarioError);
    expect(() => parseScenario("{ not json", "broken")).toThrow(/Scenario broken: not valid JSON/);
  });

  it("throws when a step is missing keys, naming the step index", () => {
    const text = JSON.stringify({ name: "n", steps: [{ keys: "right" }, { expectSpoken: ["x"] }] });
    expect(() => parseScenario(text, "n")).toThrow(/step 1: "keys" is required/);
  });

  it("throws when keys is the wrong type", () => {
    const text = JSON.stringify({ name: "n", steps: [{ keys: 42 }] });
    expect(() => parseScenario(text, "n")).toThrow(/step 0: "keys" is required and must be a non-empty string/);
  });

  it("throws when expectSpoken is not a string array", () => {
    const text = JSON.stringify({ name: "n", steps: [{ keys: "l", expectSpoken: "room" }] });
    expect(() => parseScenario(text, "n")).toThrow(/step 0: "expectSpoken" must be an array of strings/);
  });

  it("throws when waitMs is the wrong type", () => {
    const text = JSON.stringify({ name: "n", steps: [{ keys: "l", waitMs: "soon" }] });
    expect(() => parseScenario(text, "n")).toThrow(/step 0: "waitMs" must be a finite number/);
  });

  it("throws when waitForSpoken is the wrong type", () => {
    const text = JSON.stringify({ name: "n", steps: [{ keys: "start", waitForSpoken: 123 }] });
    expect(() => parseScenario(text, "n")).toThrow(/step 0: "waitForSpoken" must be a non-empty string/);
  });

  it("throws when waitForSpoken is an empty string", () => {
    const text = JSON.stringify({ name: "n", steps: [{ keys: "start", waitForSpoken: "" }] });
    expect(() => parseScenario(text, "n")).toThrow(/step 0: "waitForSpoken" must be a non-empty string/);
  });

  it("throws when name is missing", () => {
    const text = JSON.stringify({ steps: [{ keys: "l" }] });
    expect(() => parseScenario(text, "n")).toThrow(/"name" must be a non-empty string/);
  });

  it("throws when steps is empty", () => {
    const text = JSON.stringify({ name: "n", steps: [] });
    expect(() => parseScenario(text, "n")).toThrow(/"steps" must be a non-empty array/);
  });
});
