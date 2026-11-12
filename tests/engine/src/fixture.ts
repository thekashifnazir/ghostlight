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
 * How a fixture reaches its starting state when run against the native engine.
 *
 * The chapter-1 fixtures (tavern, leave-tavern) begin at the first playable
 * room, so a native run launches fresh and replays from the start. The
 * chapter-2 fixtures begin partway through: rather than replay all of chapter 1
 * (the drunkard conversation, the bartender talk, and the long animation_2_1
 * crossing cutscene — minutes of paced skips), the native run LOADS a saved
 * game taken at the chapter-2 start and begins there in about two seconds
 * (engine-a11y-layer R9.2, --save-slot). The save is produced on demand by
 * scripts/make-ch2-save.sh (it is never committed — a Drascula save embeds a
 * graphics thumbnail, i.e. game data). `saveSlot` is the slot that script
 * writes and the slot the native harness loads with --save-slot.
 */
export interface FixtureStartMode {
  /** The chapter this fixture's recorded transcript begins in. */
  startChapter: number;
  /**
   * When set, a native run LOADS this save slot (--save-slot) to reach the
   * fixture's starting room, instead of replaying from the first room. Produced
   * by scripts/make-ch2-save.sh; absent for chapter-1 fixtures, which start
   * fresh.
   */
  saveSlot?: number;
}

/**
 * Per-fixture start modes. The chapter-2 fixtures share one chapter-2-start save
 * (slot 9): both begin in chapter 2 room 14, so one saved crossing serves both,
 * and each fixture's own command script then drives its puzzle from there.
 */
export const FIXTURE_START: Record<FixtureName, FixtureStartMode> = {
  tavern: { startChapter: 1 },
  "leave-tavern": { startChapter: 1 },
  "ch2-handbag": { startChapter: 2, saveSlot: 9 },
  "ch2-vending-machine": { startChapter: 2, saveSlot: 9 },
};

/** True when a fixture reaches its start by loading a save (chapter 2). */
export function loadsSave(name: FixtureName): boolean {
  return FIXTURE_START[name].saveSlot !== undefined;
}

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

// --- Harness selection -------------------------------------------------------
//
// By default the tests run against the fixture harness (the recorded spike-04
// transcripts), which is deterministic and needs no engine build. Setting
// GHOSTLIGHT_NATIVE=1 switches to the real native engine in a real window
// (gotcha 12), using scripts/build-engine.sh's binary and the vendor/ data.
//
// Crucially, a chapter-2 fixture under the native harness LOADS its chapter-2
// save (FIXTURE_START[name].saveSlot, via --save-slot) rather than replaying
// chapter 1 — the whole point of task 19's chapter-2 change. The save must have
// been produced first by scripts/make-ch2-save.sh (writing that slot into the
// native savepath); it is never committed. Chapter-1 fixtures launch fresh.

import { NativeHarness } from "./native.js";
import { resolve as resolvePath } from "node:path";

/** Resolve the native engine paths from the repo layout (vendor/ + build). */
export function nativePaths(): {
  binary: string;
  gamePath: string;
  extraPath: string;
  savePath: string;
} {
  const root = resolvePath(HERE, "..", "..", "..");
  return {
    binary: resolvePath(root, "vendor", "scummvm", "scummvm"),
    gamePath: resolvePath(root, "vendor", "game", "drascula"),
    extraPath: resolvePath(root, "vendor", "scummvm", "dists", "engine-data"),
    // The native savepath holds the chapter-2 save made by make-ch2-save.sh.
    savePath: process.env.GHOSTLIGHT_SAVEPATH ?? "/tmp/ghostlight-engine",
  };
}

/** True when the suite is configured to drive the real native engine. */
export function useNative(): boolean {
  return process.env.GHOSTLIGHT_NATIVE === "1";
}

/**
 * Build the harness for a fixture. Fixture-backed by default; native (real
 * window) when GHOSTLIGHT_NATIVE=1, with chapter-2 fixtures loading their save
 * slot via --save-slot instead of replaying chapter 1 (R9.2).
 */
export function makeHarness(name: FixtureName): EngineHarness {
  if (!useNative()) return FixtureHarness.load(name);
  const paths = nativePaths();
  const slot = FIXTURE_START[name].saveSlot;
  return new NativeHarness({
    ...paths,
    saveSlot: slot,
    label: `native:${name}${slot !== undefined ? `:slot${slot}` : ""}`,
  });
}
