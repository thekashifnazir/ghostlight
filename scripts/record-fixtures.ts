// record-fixtures.ts — re-record the engine replay fixtures from the REAL
// native engine (engine-a11y-layer, task 30 and the recording discipline the
// fixtures README describes: "Re-record from the real engine via the paced
// feeder, not by hand-editing JSON").
//
// Why a bespoke recorder and not drive.sh: the fixtures interleave commands
// that SETTLE on a plain A11Y_DIFF (look/walk/use/push/open) with commands that
// need skips PACED into the live command file while a blocking loop runs
// (talk 52's long speech; the chapter 1->2 crossing cutscene) and with
// conversation commands serviced by the converse hook (talk 53, choose N). This
// recorder drives the real binary in a REAL window (gotcha 12), feeds the
// command file, paces skips where a step needs them, segments the captured
// A11Y* log into per-step `raw` arrays by the A11Y_CMD echoes, and writes the
// fixture JSON in the exact on-disk raw shape tests/engine/src/fixture.ts loads.
//
// It records the hero field task 30 adds: a step that moved the hero now shows
// `"hero":{"x":..,"y":..}` in its A11Y_DIFF; a step that did not stays without.
// The recorder does not fabricate any line — every line comes straight off the
// engine's stderr.
//
// Teardown: the engine PID is tracked directly and SIGKILLed (ScummVM ignores
// SIGTERM, gotcha 12); its own savepath is used so parallel chats never share
// a11y-cmd.txt.
//
// Usage:
//   node_modules/.bin/tsx scripts/record-fixtures.ts <fixture> [savepath]
//     <fixture>  one of: tavern | leave-tavern | ch2-handbag | ch2-vending-machine
//     savepath   default /tmp/ghostlight-engine
//
// Run scripts/build-engine.sh first, and scripts/make-ch2-save.sh <savepath> 9
// before the chapter-2 fixtures (they load slot 9).

import { spawn, type ChildProcess } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const VENDOR = resolve(ROOT, "vendor");
const SCUMMVM = resolve(VENDOR, "scummvm", "scummvm");
const GAME_DIR = resolve(VENDOR, "game", "drascula");
const ENGINE_DATA = resolve(VENDOR, "scummvm", "dists", "engine-data");
const FIXTURE_DIR = resolve(ROOT, "tests", "engine", "fixtures");

const A11Y_PREFIXES = [
  "A11Y_DIFF ",
  "A11Y_CHOICES ",
  "A11Y_CMD ",
  "A11Y_ERR ",
  "A11Y_TEXT ",
  "A11Y_INV ",
  "A11Y_SAVED ",
  "A11Y_HOVER ",
  "A11Y_SAY ",
  "A11Y ",
];

function isA11y(line: string): boolean {
  return A11Y_PREFIXES.some((p) => line.startsWith(p));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A recorded step: the command and the raw A11Y lines it produced. */
interface Step {
  cmd: string;
  raw: string[];
}

/** One step's drive recipe. */
interface StepSpec {
  cmd: string;
  /** Record this step into the fixture (false = setup only, not recorded). */
  record: boolean;
  /**
   * How the step settles:
   *  - "diff": wait for A11Y_DIFF/A11Y_ERR for cmd (ordinary command).
   *  - "paced-skip": feed `skip` on a cadence until the DIFF for cmd appears
   *    (talk 52's speech; the crossing cutscene).
   *  - "saved": wait for A11Y_SAVED (a `save` command).
   */
  settle: "diff" | "paced-skip" | "saved";
  /** For paced-skip: marker substring that means "done" (default: cmd DIFF). */
  doneMarker?: string;
}

class Recorder {
  private proc: ChildProcess | null = null;
  private rawLog = "";
  private readonly cmdFile: string;
  private readonly cap: number;

  constructor(
    private readonly savePath: string,
    private readonly saveSlot?: number,
    capSeconds = 240,
  ) {
    this.cmdFile = resolve(savePath, "a11y-cmd.txt");
    this.cap = capSeconds * 1000;
  }

  private lines(): string[] {
    return this.rawLog.split(/\r?\n/);
  }

  private has(marker: string): boolean {
    return this.rawLog.includes(marker);
  }

  async start(): Promise<void> {
    mkdirSync(this.savePath, { recursive: true });
    writeFileSync(this.cmdFile, "");

    const args = [
      `--path=${GAME_DIR}`,
      `--extrapath=${ENGINE_DATA}`,
      `--savepath=${this.savePath}`,
      "--subtitles",
    ];
    if (this.saveSlot !== undefined) args.push(`--save-slot=${this.saveSlot}`);
    args.push("drascula");

    this.proc = spawn(SCUMMVM, args, { stdio: ["ignore", "pipe", "pipe"] });
    const onData = (c: Buffer) => {
      this.rawLog += c.toString();
    };
    this.proc.stdout?.on("data", onData);
    this.proc.stderr?.on("data", onData);
  }

  private alive(): boolean {
    return this.proc !== null && this.proc.exitCode === null;
  }

  /** Append a command line to the engine's command file. */
  private feed(cmd: string): void {
    const cur = existsSync(this.cmdFile)
      ? readFileSync(this.cmdFile, "utf8")
      : "";
    writeFileSync(this.cmdFile, `${cur}${cmd}\n`);
  }

  async waitFor(marker: string, what: string): Promise<void> {
    const deadline = Date.now() + this.cap;
    while (!this.has(marker)) {
      if (!this.alive()) throw new Error(`engine exited before ${what}`);
      if (Date.now() >= deadline) throw new Error(`timed out waiting for ${what}`);
      await sleep(200);
    }
  }

  /** Wait until any of the markers appears (used for diff-or-err settles). */
  async waitForAny(markers: string[], what: string): Promise<void> {
    const deadline = Date.now() + this.cap;
    while (!markers.some((m) => this.has(m))) {
      if (!this.alive()) throw new Error(`engine exited before ${what}`);
      if (Date.now() >= deadline) throw new Error(`timed out waiting for ${what}`);
      await sleep(200);
    }
  }

  /** How many A11Y_ERR lines are in the capture so far. */
  errCount(): number {
    return this.lines().filter((l) => l.startsWith("A11Y_ERR ")).length;
  }

  /** Number of A11Y lines captured so far (used to slice per-step output). */
  private a11yCount(): number {
    return this.lines().filter(isA11y).length;
  }

  /**
   * Drive one step. Returns the A11Y lines produced AFTER `baseline` lines (the
   * step's own output), trimmed to this step. The segmentation by A11Y_CMD echo
   * is done by the caller from the full capture; here we just make the step
   * settle and return the fresh slice.
   */
  async runStep(spec: StepSpec, baseline: number): Promise<string[]> {
    const diffMarker = `A11Y_DIFF {"cmd":"${spec.cmd}"`;
    const errBefore = this.errCount();
    this.feed(spec.cmd);
    await this.waitFor(`A11Y_CMD ${spec.cmd}`, `echo of "${spec.cmd}"`);

    if (spec.settle === "saved") {
      await this.waitFor("A11Y_SAVED", `save of "${spec.cmd}"`);
    } else if (spec.settle === "paced-skip") {
      // Feed one skip at a time and poll often, so we stop the instant the done
      // marker appears and do NOT over-feed skips past the step (a surplus skip
      // consumed in the next room would emit its own stray A11Y_DIFF).
      const done = spec.doneMarker ?? diffMarker;
      const deadline = Date.now() + this.cap;
      while (!this.has(done)) {
        if (!this.alive()) throw new Error(`engine died during "${spec.cmd}"`);
        if (Date.now() >= deadline)
          throw new Error(`"${spec.cmd}" never settled within the cap`);
        this.feed("skip");
        // Poll in short slices between skips so a settled marker ends the feed
        // promptly rather than after a full fixed interval.
        for (let w = 0; w < 6 && !this.has(done); w++) await sleep(200);
      }
      // The done marker may be the chapter-change substring; wait for the step's
      // own DIFF line to be fully flushed before trimming.
      await this.waitFor(diffMarker, `settle of "${spec.cmd}"`);
    } else {
      // Ordinary command: settle on its own A11Y_DIFF, OR on a new A11Y_ERR (a
      // command that cannot run yields exactly one err and no diff, R2.5). We
      // can't key the err on the command text (A11Y_ERR has no cmd field), so
      // we settle when either this command's diff appears or the err count
      // rose beyond what it was before we fed the command.
      const deadline = Date.now() + this.cap;
      while (!this.has(diffMarker) && this.errCount() === errBefore) {
        if (!this.alive()) throw new Error(`engine died during "${spec.cmd}"`);
        if (Date.now() >= deadline)
          throw new Error(`"${spec.cmd}" never settled within the cap`);
        await sleep(200);
      }
    }

    // Small settle window so the step's own terminator line flushes.
    await sleep(400);

    const all = this.lines().filter(isA11y);
    return all.slice(baseline);
  }

  /** The current full A11Y capture (room-state start line is lines[0]). */
  fullA11y(): string[] {
    return this.lines().filter(isA11y);
  }

  async stop(): Promise<void> {
    if (this.alive()) this.proc!.kill("SIGKILL");
    this.proc = null;
  }
}

/** Per-fixture drive recipe: how to reach the start, then the steps. */
interface FixtureRecipe {
  label: string;
  saveSlot?: number;
  /** Marker for the fixture's start room-state line. */
  startMarker: string;
  /** Setup steps run but NOT recorded (to reach the declared start state). */
  setup: StepSpec[];
  /**
   * After setup, re-emit the start room state with `dump` so the recorder has a
   * clean A11Y line to use as startRaw. The dump's own lines are discarded.
   */
  steps: StepSpec[];
}

function recipe(name: string): FixtureRecipe {
  switch (name) {
    case "tavern":
      return {
        label: "tavern",
        startMarker: 'A11Y {"chapter":1,"room":62',
        setup: [],
        steps: [
          { cmd: "inventory", record: true, settle: "diff" },
          { cmd: "look 102", record: true, settle: "diff" },
          { cmd: "talk 53", record: true, settle: "diff" },
          { cmd: "choose 2", record: true, settle: "diff" },
          { cmd: "choose 4", record: true, settle: "diff" },
          { cmd: "walk 105", record: true, settle: "diff" }, // locked: plain diff
          { cmd: "talk 52", record: true, settle: "paced-skip" },
          {
            cmd: "walk 105",
            record: true,
            settle: "paced-skip",
            doneMarker: '"chapter":[1,2]',
          },
        ],
      };
    case "leave-tavern":
      return {
        label: "leave-tavern",
        startMarker: 'A11Y {"chapter":1,"room":62',
        // Setup: talk 52 sets flag 0 (unlocks door 105) so the single recorded
        // step is the crossing, matching the committed fixture's start (flag 0
        // already set).
        setup: [{ cmd: "talk 52", record: false, settle: "paced-skip" }],
        steps: [
          {
            cmd: "walk 105",
            record: true,
            settle: "paced-skip",
            doneMarker: '"chapter":[1,2]',
          },
        ],
      };
    case "ch2-handbag":
      return {
        label: "ch2-handbag",
        saveSlot: 9,
        startMarker: 'A11Y {"chapter":2,"room":14',
        setup: [],
        steps: [
          { cmd: "walk 162", record: true, settle: "diff" },
          { cmd: "open 183", record: true, settle: "diff" },
          { cmd: "open 22", record: true, settle: "diff" },
        ],
      };
    case "ch2-vending-machine":
      return {
        label: "ch2-vending-machine",
        saveSlot: 9,
        startMarker: 'A11Y {"chapter":2,"room":14',
        // Setup: the committed start has the handbag items (7,18,22) and flags
        // 19/20/23 — i.e. the handbag chain already done. Reproduce it from the
        // slot-9 chapter-2 start, then walk back to room 14 so the recorded
        // steps begin where the committed fixture does.
        setup: [
          { cmd: "walk 162", record: false, settle: "diff" },
          { cmd: "open 183", record: false, settle: "diff" },
          { cmd: "open 22", record: false, settle: "diff" },
          { cmd: "walk 163", record: false, settle: "diff" }, // back to room 14
        ],
        steps: [
          { cmd: "walk 171", record: true, settle: "diff" },
          { cmd: "look 188", record: true, settle: "diff" },
          { cmd: "use 18 188", record: true, settle: "diff" },
          { cmd: "take 999", record: true, settle: "diff" },
          { cmd: "push 188", record: true, settle: "diff" },
        ],
      };
    default:
      throw new Error(`unknown fixture: ${name}`);
  }
}

/**
 * Segment a flat A11Y capture into per-step raw arrays. The capture after the
 * start line is a sequence of `A11Y_CMD <cmd>` echoes, each followed by the
 * lines that command produced, up to the next recorded command's echo. We walk
 * the recorded step list in order and, for each, take from its A11Y_CMD echo up
 * to (but not including) the next recorded step's echo. `take 999`'s echo is
 * `A11Y_CMD take 999` with an A11Y_ERR and no diff. The whole segment (which may
 * contain extra A11Y_CMD skip echoes the engine produced for a paced step) is
 * the step's raw, exactly as the committed fixtures store them.
 */
function segment(full: string[], recorded: StepSpec[]): Step[] {
  // Find the index of each recorded step's own A11Y_CMD echo, in order, each
  // search starting after the previous step's echo so repeated commands (two
  // `walk 105`) map to their own occurrence.
  const echoIdx: number[] = [];
  let from = 0;
  for (const spec of recorded) {
    const want = `A11Y_CMD ${spec.cmd}`;
    let i = from;
    for (; i < full.length; i++) {
      if (full[i] === want) break;
    }
    if (i >= full.length)
      throw new Error(`could not find echo for recorded step "${spec.cmd}"`);
    echoIdx.push(i);
    from = i + 1;
  }
  const steps: Step[] = [];
  for (let s = 0; s < recorded.length; s++) {
    const begin = echoIdx[s]!;
    const end = s + 1 < recorded.length ? echoIdx[s + 1]! : full.length;
    const segment = full.slice(begin, end);
    steps.push({ cmd: recorded[s]!.cmd, raw: trimToTerminator(recorded[s]!.cmd, segment) });
  }
  return steps;
}

/**
 * Trim a step's raw segment to end at the step's own terminator: the first
 * `A11Y_DIFF {"cmd":"<cmd>"` or `A11Y_ERR` line for this command. Everything
 * after the terminator is dropped — a trailing hover-name `A11Y_TEXT` the
 * engine redrew once the action settled, or a surplus `skip` the paced feeder
 * queued that was consumed as a no-op in the next room and emitted its own
 * stray diff. A step is, by the harness contract, the echo plus the lines up to
 * and including its single A11Y_DIFF or A11Y_ERR (see harness.ts), so trimming
 * here keeps the recorded fixture to exactly that shape without hand-editing any
 * line's content — the kept lines are verbatim engine output.
 */
function trimToTerminator(cmd: string, segment: string[]): string[] {
  const diffMarker = `A11Y_DIFF {"cmd":"${cmd}"`;
  for (let i = 0; i < segment.length; i++) {
    const line = segment[i]!;
    if (line.startsWith(diffMarker) || line.startsWith("A11Y_ERR ")) {
      return segment.slice(0, i + 1);
    }
  }
  // No terminator found (should not happen for a recorded step): keep as-is so
  // the problem is visible rather than silently swallowed.
  return segment;
}

async function main(): Promise<void> {
  const name = process.argv[2];
  const savePath = process.argv[3] ?? "/tmp/ghostlight-engine";
  if (!name) throw new Error("usage: record-fixtures.ts <fixture> [savepath]");
  const r = recipe(name);

  const rec = new Recorder(savePath, r.saveSlot);
  try {
    await rec.start();
    await rec.waitFor(r.startMarker, `start room state (${r.startMarker})`);

    // Run setup steps (not recorded) to reach the declared start state.
    for (const spec of r.setup) {
      const baseline = rec.fullA11y().length;
      await rec.runStep(spec, baseline);
    }

    // Capture the start room-state line: dump the current state so startRaw is a
    // clean A11Y line reflecting the post-setup state.
    const beforeDump = rec.fullA11y().length;
    await rec.runStep({ cmd: "dump", record: false, settle: "diff" }, beforeDump);
    const afterSetup = rec.fullA11y();
    // The last A11Y room-state line is the dump's room state.
    let startRaw = "";
    for (let i = afterSetup.length - 1; i >= 0; i--) {
      if (afterSetup[i]!.startsWith("A11Y {")) {
        startRaw = afterSetup[i]!;
        break;
      }
    }
    if (!startRaw) throw new Error("no A11Y room-state line captured for start");

    // Mark the boundary: recorded steps start after everything captured so far.
    const recordBaseline = rec.fullA11y().length;

    const recorded = r.steps;
    for (const spec of recorded) {
      const baseline = rec.fullA11y().length;
      await rec.runStep(spec, baseline);
    }

    const full = rec.fullA11y().slice(recordBaseline);
    const steps = segment(full, recorded);

    const out = { label: r.label, startRaw, steps };
    const path = resolve(FIXTURE_DIR, `${name}.json`);
    writeFileSync(path, `${JSON.stringify(out, null, 2)}\n`);
    process.stderr.write(`[record] wrote ${path} with ${steps.length} step(s)\n`);
  } finally {
    await rec.stop();
  }
}

main().catch((e) => {
  process.stderr.write(`[record] ERROR: ${e?.message ?? e}\n`);
  process.exit(1);
});
