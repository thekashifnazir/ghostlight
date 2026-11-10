// Stage 1 and 2 (survey and dump): the command line.
// Spec: .kiro/specs/pack-coverage, Requirements 1 and 2.
//
//   npx tsx packs/survey/survey.ts --chapter 3 --slot 30 --saves <dir>
//
// Starts the drascula-mcp server (native transport) as a child process, talks
// to it with the MCP SDK client, and drives the game only through its documented
// tools. It never touches the engine command file or the engine directly. The
// walk itself lives in survey-core.ts so it can be tested with a fake engine.
//
// Needs the native engine, so the live run is done by Claude Code, not in CI.
//
// Options:
//   --chapter N         chapter to survey (required)
//   --slot N            checkpoint slot to start from (required)
//   --saves DIR         where the checkpoint save lives (read only; required)
//   --screenshots       also capture screenshot.png per room (macOS screencapture)
//   --probe-verbs a,b   extra verbs to probe besides look (open, close, push only)
//   --step-timeout MS   per-step timeout (default 25000)
//   --out DIR           survey output folder (default packs/survey)
//   --scummvm PATH, --game PATH, --extra PATH   override the engine locations

import { execFile } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  chapterRooms,
  runSurvey,
  unreachedSummary,
  verdictLine,
  SAFE_EXTRA_VERBS,
  type CensusSlice,
  type EngineDriver,
  type SurveySink,
  type ToolResult,
} from "./survey-core.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const MCP_DIR = join(REPO, "mcp");

/** The pipeline's own save path, distinct from engine, player, MCP and Crew. */
export const SURVEY_SAVE_PATH = "/tmp/ghostlight-pack-coverage";

interface Args {
  chapter: number;
  slot: number;
  saves: string;
  screenshots: boolean;
  probeVerbs: string[];
  stepTimeout: number;
  out: string;
  scummvm: string;
  game: string;
  extra: string;
}

function parseArgs(argv: string[]): Args | string {
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith("--")) continue;
    const eq = a.indexOf("=");
    if (eq !== -1) {
      flags.set(a.slice(2, eq), a.slice(eq + 1));
    } else if (argv[i + 1] !== undefined && !argv[i + 1]!.startsWith("--")) {
      flags.set(a.slice(2), argv[++i]!);
    } else {
      flags.set(a.slice(2), "true");
    }
  }
  const int = (name: string): number | undefined => {
    const v = flags.get(name);
    if (v === undefined) return undefined;
    const n = Number.parseInt(v, 10);
    return Number.isInteger(n) && n >= 0 ? n : undefined;
  };
  const chapter = int("chapter");
  const slot = int("slot");
  const saves = flags.get("saves");
  if (chapter === undefined) return "missing or invalid --chapter";
  if (slot === undefined) return "missing or invalid --slot";
  if (!saves || saves === "true") return "missing --saves <dir>";
  const probeVerbs = (flags.get("probe-verbs") ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  const bad = probeVerbs.filter((v) => !SAFE_EXTRA_VERBS.includes(v));
  if (bad.length > 0) {
    return `--probe-verbs only allows ${SAFE_EXTRA_VERBS.join(", ")} (got ${bad.join(", ")})`;
  }
  return {
    chapter,
    slot,
    saves: resolve(saves),
    screenshots: flags.has("screenshots"),
    probeVerbs,
    stepTimeout: int("step-timeout") ?? 25_000,
    out: resolve(flags.get("out") ?? HERE),
    scummvm: resolve(REPO, flags.get("scummvm") ?? "vendor/scummvm/scummvm"),
    game: resolve(REPO, flags.get("game") ?? "vendor/game/drascula"),
    extra: resolve(REPO, flags.get("extra") ?? "vendor/scummvm/dists/engine-data"),
  };
}

/**
 * Copy the checkpoint from the Crew saves folder into our own save path. The
 * source is only read. Matches ScummVM's `drascula.NNN` names by slot number.
 */
export function copyCheckpoint(savesDir: string, slot: number, savePath: string): string[] {
  if (!existsSync(savesDir)) throw new Error(`saves folder not found: ${savesDir}`);
  const wanted = readdirSync(savesDir).filter((name) => {
    const m = /^drascula\.(\d+)$/.exec(name);
    return m !== null && Number.parseInt(m[1]!, 10) === slot;
  });
  if (wanted.length === 0) {
    throw new Error(`no drascula.NNN save for slot ${slot} in ${savesDir}`);
  }
  mkdirSync(savePath, { recursive: true });
  for (const name of wanted) copyFileSync(join(savesDir, name), join(savePath, name));
  return wanted;
}

// --- The MCP client ---------------------------------------------------------

interface McpClientLike {
  connect(transport: unknown): Promise<void>;
  callTool(
    req: { name: string; arguments?: Record<string, unknown> },
    schema?: unknown,
    options?: { timeout?: number },
  ): Promise<{ content?: { type: string; text?: string }[]; isError?: boolean }>;
  close(): Promise<void>;
}

/** Find the MCP SDK the mcp/ package already installed. */
function sdkDir(): string {
  const candidates = [
    join(MCP_DIR, "node_modules/@modelcontextprotocol/sdk/dist/esm"),
    join(REPO, "node_modules/@modelcontextprotocol/sdk/dist/esm"),
  ];
  const found = candidates.find((c) => existsSync(join(c, "client/index.js")));
  if (!found) {
    throw new Error("MCP SDK not found; run `npm --prefix mcp install` first.");
  }
  return found;
}

async function connectMcp(args: Args): Promise<McpClientLike> {
  const sdk = sdkDir();
  const { Client } = (await import(pathToFileURL(join(sdk, "client/index.js")).href)) as {
    Client: new (info: { name: string; version: string }) => McpClientLike;
  };
  const { StdioClientTransport } = (await import(
    pathToFileURL(join(sdk, "client/stdio.js")).href
  )) as { StdioClientTransport: new (p: Record<string, unknown>) => unknown };

  const transport = new StdioClientTransport({
    command: "npx",
    args: ["--no-install", "tsx", "src/server.ts"],
    cwd: MCP_DIR,
    stderr: "inherit",
    env: {
      ...(Object.fromEntries(
        Object.entries(process.env).filter(([, v]) => v !== undefined),
      ) as Record<string, string>),
      DRASCULA_MCP_TRANSPORT: "native",
      DRASCULA_MCP_SCUMMVM: args.scummvm,
      DRASCULA_MCP_GAME: args.game,
      DRASCULA_MCP_EXTRA: args.extra,
      DRASCULA_MCP_SAVEPATH: SURVEY_SAVE_PATH,
    },
  });
  const client = new Client({ name: "pack-coverage-survey", version: "0.1.0" });
  await client.connect(transport);
  return client;
}

/** An EngineDriver over the MCP client, with a hard per-step timeout. */
function mcpDriver(client: McpClientLike, stepTimeoutMs: number): EngineDriver {
  return {
    async call(tool, callArgs): Promise<ToolResult> {
      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<ToolResult>((resolveTimeout) => {
        timer = setTimeout(
          () =>
            resolveTimeout({
              data: { error: `${tool} did not return within ${stepTimeoutMs} ms` },
              isError: true,
              timedOut: true,
            }),
          stepTimeoutMs,
        );
      });
      const call = client
        .callTool({ name: tool, arguments: callArgs ?? {} }, undefined, {
          timeout: stepTimeoutMs,
        })
        .then((res): ToolResult => {
          const text = res.content?.find((c) => c.type === "text")?.text ?? "";
          let data: unknown = text;
          try {
            data = JSON.parse(text);
          } catch {
            /* keep the raw text */
          }
          return { data, isError: res.isError === true };
        })
        .catch(
          (e: unknown): ToolResult => ({
            data: { error: e instanceof Error ? e.message : String(e) },
            isError: true,
            timedOut: /timed? ?out/i.test(e instanceof Error ? e.message : String(e)),
          }),
        );
      try {
        return await Promise.race([call, timeout]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
  };
}

// --- Output -----------------------------------------------------------------

function screenshotVia(path: string): Promise<boolean> {
  // macOS only. This grabs the whole display, so keep the ScummVM window in
  // front while a screenshot run is going. It is a plain file grab; it does not
  // touch the engine.
  return new Promise((done) => {
    execFile("screencapture", ["-x", path], (err) => done(!err && existsSync(path)));
  });
}

function makeSink(outDir: string): SurveySink {
  return {
    writeRoom(room, files) {
      const dir = join(outDir, String(room));
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "state.json"), JSON.stringify(files.state, null, 2) + "\n");
      writeFileSync(join(dir, "verbs.json"), JSON.stringify(files.verbs, null, 2) + "\n");
      writeFileSync(join(dir, "meta.json"), JSON.stringify(files.meta, null, 2) + "\n");
    },
    screenshot(room) {
      const dir = join(outDir, String(room));
      mkdirSync(dir, { recursive: true });
      return screenshotVia(join(dir, "screenshot.png"));
    },
    log: (line) => console.error(`[survey] ${line}`),
  };
}

function engineBuildId(binary: string): string {
  try {
    return `scummvm@${statSync(binary).mtime.toISOString()}`;
  } catch {
    return "unknown";
  }
}

// --- Main -------------------------------------------------------------------

async function main(argv: string[]): Promise<number> {
  const parsed = parseArgs(argv);
  if (typeof parsed === "string") {
    console.error(
      `${parsed}\nUsage: npx tsx packs/survey/survey.ts --chapter N --slot N --saves DIR ` +
        `[--screenshots] [--probe-verbs open,close,push] [--step-timeout MS] [--out DIR]`,
    );
    return 2;
  }
  const args = parsed;
  const census = JSON.parse(
    readFileSync(join(REPO, "reference", "census.json"), "utf8"),
  ) as CensusSlice;
  const today = new Date().toISOString().slice(0, 10);
  const build = engineBuildId(args.scummvm);
  const summaryPath = join(args.out, `survey-${args.chapter}.json`);

  let summary;
  let client: McpClientLike | undefined;
  try {
    copyCheckpoint(args.saves, args.slot, SURVEY_SAVE_PATH);
    client = await connectMcp(args);
    const sink = makeSink(args.out);
    summary = await runSurvey(mcpDriver(client, args.stepTimeout), {
      chapter: args.chapter,
      slot: args.slot,
      census,
      sink,
      screenshots: args.screenshots,
      probeVerbs: args.probeVerbs,
      engineBuild: build,
    });
  } catch (e) {
    // Setup failures (no checkpoint, no SDK, no server) still give a verdict.
    const reason = e instanceof Error ? e.message : String(e);
    summary = unreachedSummary(args.chapter, args.slot, census, reason, today, build);
  } finally {
    if (client) {
      // The core already calls `stop`; closing the client ends the server child.
      await client.close().catch(() => undefined);
    }
  }

  mkdirSync(args.out, { recursive: true });
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + "\n");
  for (const v of summary.rooms) console.log(verdictLine(v));
  const reached = summary.rooms.filter((r) => r.verdict === "reached").length;
  console.log(
    `chapter ${args.chapter}: ${reached}/${chapterRooms(census, args.chapter).length} rooms reached; ` +
      `summary in ${summaryPath}`,
  );
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      console.error(e);
      process.exit(1);
    },
  );
}
