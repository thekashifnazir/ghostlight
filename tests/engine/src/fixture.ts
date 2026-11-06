// Fixture-backed EngineHarness.
//
// A fixture stores the raw a11y lines the engine printed, exactly as they come
// off stderr. We run them back through the real parser (parse.ts), so a fixture
// that does not match the line contract fails to load. That keeps the recorded
// transcripts honest against the same parser a native run will use.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { A11yLine, RoomState } from "./lines.js";
import { parseLine, parseStream } from "./parse.js";
import type { EngineHarness } from "./harness.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = resolve(HERE, "..", "fixtures");

/** On-disk fixture: raw lines, as printed by the engine. */
interface RawFixture {
  label: string;
  /** The raw `A11Y {...}` room-state line the engine prints on start. */
  startRaw: string;
  steps: { cmd: string; raw: string[] }[];
}

export interface LoadedFixture {
  label: string;
  start: RoomState;
  steps: { cmd: string; lines: A11yLine[] }[];
}

function expectRoomState(raw: string): RoomState {
  const parsed = parseLine(raw);
  if (!parsed || parsed.kind !== "room") {
    throw new Error(`fixture start is not an A11Y room-state line: ${raw}`);
  }
  return parsed;
}

export function loadFixture(name: string): LoadedFixture {
  const path = resolve(FIXTURE_DIR, `${name}.json`);
  const raw = JSON.parse(readFileSync(path, "utf8")) as RawFixture;
  return {
    label: raw.label,
    start: expectRoomState(raw.startRaw),
    steps: raw.steps.map((s) => ({
      cmd: s.cmd,
      lines: parseStream(s.raw.join("\n")),
    })),
  };
}

export const FIXTURE_NAMES = [
  "tavern",
  "leave-tavern",
  "ch2-handbag",
  "ch2-vending-machine",
] as const;

export type FixtureName = (typeof FIXTURE_NAMES)[number];

/**
 * An EngineHarness that replays a loaded fixture. send(cmd) returns the lines
 * for the next step and asserts the command matches, so a test driving the
 * harness with the fixture's own command order gets the recorded output.
 */
export class FixtureHarness implements EngineHarness {
  readonly label: string;
  private readonly fixture: LoadedFixture;
  private index = 0;

  constructor(fixture: LoadedFixture) {
    this.fixture = fixture;
    this.label = `fixture:${fixture.label}`;
  }

  static load(name: FixtureName): FixtureHarness {
    return new FixtureHarness(loadFixture(name));
  }

  async start(): Promise<RoomState> {
    this.index = 0;
    return this.fixture.start;
  }

  async send(cmd: string): Promise<A11yLine[]> {
    const step = this.fixture.steps[this.index];
    if (!step) {
      throw new Error(
        `${this.label}: no recorded step ${this.index} for command "${cmd}"`,
      );
    }
    if (step.cmd !== cmd) {
      throw new Error(
        `${this.label}: step ${this.index} recorded command "${step.cmd}", got "${cmd}"`,
      );
    }
    this.index += 1;
    return step.lines;
  }

  /** The command sequence this fixture recorded, in order. */
  commands(): string[] {
    return this.fixture.steps.map((s) => s.cmd);
  }

  async stop(): Promise<void> {
    /* nothing to release */
  }
}
