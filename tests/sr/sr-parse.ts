// sr-harness scenario parser (Requirement 3, pure).
//
// Reads a scenario JSON file and returns a validated Scenario, or throws a
// clear, located error. A scenario is data under tests/sr/scenarios/<name>.json
// describing an ordered list of key-press steps and the substrings each step
// must (and must not) make the screen reader speak.
//
// This module is pure beyond reading the one file it is given: no VM, no
// network, no mutation. It is unit-tested directly (sr-parse.test.ts) so the
// scenario format is trusted without the Windows VM.

import { readFileSync } from "node:fs";

/** A whole scenario: a named, ordered list of steps. */
export interface Scenario {
  /** Human-readable name shown in reports. */
  name: string;
  /** Optional per-scenario URL hint (overridden by the sr-check.sh argument). */
  url?: string;
  /** Optional replay fixture the scenario assumes (e.g. "tavern"). */
  fixture?: string;
  /** Steps, run in this exact order. */
  steps: Step[];
}

/** One step: press some keys, then check what the screen reader said. */
export interface Step {
  /**
   * The chord or chords to press, in the spike's comma-and-plus syntax
   * ("right", "shift+r", "tab,esc"), or an action token the runner maps to an
   * operation ("start", "reload", "continue"). Required.
   */
  keys: string;
  /** Substrings that must all appear in what the screen reader speaks. */
  expectSpoken?: string[];
  /** Substrings that must not appear in what the screen reader speaks. */
  expectNotSpoken?: string[];
  /**
   * A substring to wait for in the page's live region (read over the page
   * bridge) before capturing the screen reader's speech. When set, the runner
   * polls the live region until this text appears (or `waitMs` elapses as a
   * cap) instead of sleeping a fixed time. This makes a step like Start robust:
   * the onboarding line lands after a variable delay, so we wait for it rather
   * than guessing a duration.
   */
  waitForSpoken?: string;
  /**
   * How long to wait (ms) before capturing. Without `waitForSpoken` this is a
   * fixed settle time; with it, it is the maximum time to poll for the awaited
   * text before giving up and capturing anyway.
   */
  waitMs?: number;
  /** Optional human label for the report. */
  note?: string;
}

/** Thrown when a scenario file is missing, malformed, or a step is invalid. */
export class ScenarioError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScenarioError";
  }
}

/**
 * Parse a scenario from an already-loaded JSON string. Pure — no file access —
 * so tests can exercise it without touching the disk. `source` names the origin
 * (file path or scenario name) for error messages.
 */
export function parseScenario(text: string, source: string): Scenario {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    throw new ScenarioError(`Scenario ${source}: not valid JSON (${detail}).`);
  }

  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ScenarioError(`Scenario ${source}: top level must be a JSON object.`);
  }
  const obj = raw as Record<string, unknown>;

  if (typeof obj.name !== "string" || obj.name.length === 0) {
    throw new ScenarioError(`Scenario ${source}: "name" must be a non-empty string.`);
  }
  if (obj.url !== undefined && typeof obj.url !== "string") {
    throw new ScenarioError(`Scenario ${source}: "url" must be a string when present.`);
  }
  if (obj.fixture !== undefined && typeof obj.fixture !== "string") {
    throw new ScenarioError(`Scenario ${source}: "fixture" must be a string when present.`);
  }
  if (!Array.isArray(obj.steps) || obj.steps.length === 0) {
    throw new ScenarioError(`Scenario ${source}: "steps" must be a non-empty array.`);
  }

  const steps = obj.steps.map((s, i) => parseStep(s, source, i));

  return {
    name: obj.name,
    ...(obj.url !== undefined ? { url: obj.url } : {}),
    ...(obj.fixture !== undefined ? { fixture: obj.fixture } : {}),
    steps,
  };
}

/** Validate one step. `index` is its position in the steps array (0-based). */
function parseStep(s: unknown, source: string, index: number): Step {
  const where = `Scenario ${source} step ${index}`;
  if (s === null || typeof s !== "object" || Array.isArray(s)) {
    throw new ScenarioError(`${where}: must be a JSON object.`);
  }
  const step = s as Record<string, unknown>;

  if (typeof step.keys !== "string" || step.keys.length === 0) {
    throw new ScenarioError(`${where}: "keys" is required and must be a non-empty string.`);
  }
  assertStringArray(step.expectSpoken, `${where}: "expectSpoken"`);
  assertStringArray(step.expectNotSpoken, `${where}: "expectNotSpoken"`);
  if (step.waitForSpoken !== undefined && (typeof step.waitForSpoken !== "string" || step.waitForSpoken.length === 0)) {
    throw new ScenarioError(`${where}: "waitForSpoken" must be a non-empty string when present.`);
  }
  if (step.waitMs !== undefined && (typeof step.waitMs !== "number" || !Number.isFinite(step.waitMs))) {
    throw new ScenarioError(`${where}: "waitMs" must be a finite number when present.`);
  }
  if (step.note !== undefined && typeof step.note !== "string") {
    throw new ScenarioError(`${where}: "note" must be a string when present.`);
  }

  return {
    keys: step.keys,
    ...(step.expectSpoken !== undefined ? { expectSpoken: step.expectSpoken as string[] } : {}),
    ...(step.expectNotSpoken !== undefined ? { expectNotSpoken: step.expectNotSpoken as string[] } : {}),
    ...(step.waitForSpoken !== undefined ? { waitForSpoken: step.waitForSpoken as string } : {}),
    ...(step.waitMs !== undefined ? { waitMs: step.waitMs as number } : {}),
    ...(step.note !== undefined ? { note: step.note as string } : {}),
  };
}

/** A field that, when present, must be an array of strings. */
function assertStringArray(value: unknown, label: string): void {
  if (value === undefined) return;
  if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) {
    throw new ScenarioError(`${label} must be an array of strings when present.`);
  }
}

/**
 * Load and parse a scenario file from disk. The only file-touching entry point;
 * delegates all validation to the pure parseScenario. A missing file is
 * reported as a located ScenarioError, not a raw fs throw.
 */
export function loadScenario(path: string): Scenario {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (e) {
    const code = (e as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") {
      throw new ScenarioError(`Scenario file not found: ${path}.`);
    }
    const detail = e instanceof Error ? e.message : String(e);
    throw new ScenarioError(`Scenario file ${path}: cannot read (${detail}).`);
  }
  return parseScenario(text, path);
}
