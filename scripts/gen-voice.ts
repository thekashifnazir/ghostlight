// Ghost voice generator (Requirements 8, 9). Build-time only, never in the
// browser.
//
// Reads every hint line from the pack (the nudge/clue/answer of every
// milestone) and, in real mode, generates one audio file per line through the
// ElevenLabs power (voice Alice, model eleven_v4) into the content-addressed
// cache at src/hints/ghost/<cacheKey>.mp3. A line already cached is skipped, so
// an unchanged line never costs credits.
//
// `--dry-run` (the mode to run first, gotcha 11) prints the number of hint
// lines and their total character count, with per-chapter and per-tier
// breakdowns for cost estimation, and makes NO ElevenLabs call and writes
// nothing. Real generation runs only without `--dry-run`, so the paid run is
// explicit and deliberate.
//
// The ElevenLabs API key is read from the local .env by name
// (ELEVENLABS_API_KEY) and is never printed, logged, or written anywhere. A
// missing key fails with a clear message that names the key, not its value.
//
// `collectLines`, `generateInto` and the `Synth`/`Line` types are exported so
// the cache-coverage test (R10.4) can run the generator over the real pack with
// the ElevenLabs call mocked, into a temp dir, with no key or network.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cacheFileName, cacheKey } from "../src/hints/cache.js";
import { loadPack } from "../packs/tools/src/load.js";
import type { Hints, Milestone } from "../packs/tools/src/types.js";

export const VOICE_ID = "nbk2esDn4RRk4cVDdoiE"; // Alice (ASMR British Whisper)
export const MODEL_ID = "eleven_v4";
const KEY_NAME = "ELEVENLABS_API_KEY";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const PACK_PATH = resolve(REPO, "packs/drascula-en.json");
const CACHE_DIR = resolve(REPO, "src/hints/ghost");

type TierName = keyof Hints; // "nudge" | "clue" | "answer"
const TIERS: TierName[] = ["nudge", "clue", "answer"];

export interface Line {
  milestoneId: string;
  chapter: number;
  tier: TierName;
  text: string;
}

/** Synthesize one line's audio bytes. Injected so the test can mock it. */
export type Synth = (text: string) => Promise<Uint8Array>;

export interface GenerateResult {
  total: number;
  skipped: number;
  generated: number;
}

/** Every hint line in the pack: three tiers per milestone. */
export function collectLines(milestones: Milestone[]): Line[] {
  const lines: Line[] = [];
  for (const m of milestones) {
    for (const tier of TIERS) {
      lines.push({
        milestoneId: m.id,
        chapter: m.chapter,
        tier,
        text: m.hints[tier],
      });
    }
  }
  return lines;
}

/**
 * Write one content-addressed file per line into `outDir`, skipping lines
 * already present, using `synth` to produce the bytes. Pure of the ElevenLabs
 * SDK and of any key: the caller supplies `synth`. Returns the counts.
 */
export async function generateInto(
  lines: Line[],
  outDir: string,
  synth: Synth,
): Promise<GenerateResult> {
  mkdirSync(outDir, { recursive: true });
  let generated = 0;
  let skipped = 0;
  for (const line of lines) {
    const key = await cacheKey(line.text, VOICE_ID, MODEL_ID);
    const outPath = resolve(outDir, cacheFileName(key));
    if (existsSync(outPath)) {
      skipped += 1;
      continue;
    }
    writeFileSync(outPath, Buffer.from(await synth(line.text)));
    generated += 1;
  }
  return { total: lines.length, skipped, generated };
}

/** Read one named value from .env without exposing any other value. */
export function readEnvKey(name: string): string | undefined {
  const envPath = resolve(REPO, ".env");
  if (!existsSync(envPath)) return undefined;
  const raw = readFileSync(envPath, "utf8");
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    if (line.slice(0, eq).trim() !== name) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    return value;
  }
  return undefined;
}

function dryRun(lines: Line[]): void {
  const totalChars = lines.reduce((n, l) => n + l.text.length, 0);

  const byChapter = new Map<number, { lines: number; chars: number }>();
  for (const l of lines) {
    const c = byChapter.get(l.chapter) ?? { lines: 0, chars: 0 };
    c.lines += 1;
    c.chars += l.text.length;
    byChapter.set(l.chapter, c);
  }

  const byTier = new Map<TierName, { lines: number; chars: number }>();
  for (const l of lines) {
    const t = byTier.get(l.tier) ?? { lines: 0, chars: 0 };
    t.lines += 1;
    t.chars += l.text.length;
    byTier.set(l.tier, t);
  }

  console.log("Dry run: no ElevenLabs call, nothing written.");
  console.log(`Hint lines: ${lines.length}`);
  console.log(`Total characters: ${totalChars}`);
  console.log("");
  console.log("Per chapter:");
  for (const chapter of [...byChapter.keys()].sort((a, b) => a - b)) {
    const c = byChapter.get(chapter)!;
    console.log(`  chapter ${chapter}: ${c.lines} lines, ${c.chars} chars`);
  }
  console.log("Per tier:");
  for (const tier of TIERS) {
    const t = byTier.get(tier);
    if (t) console.log(`  ${tier}: ${t.lines} lines, ${t.chars} chars`);
  }
  console.log("");
  const estUsd = (totalChars / 1000) * 0.08;
  console.log(`Estimated cost at $0.08/1,000 chars: $${estUsd.toFixed(2)}`);
}

/**
 * Resolve the ElevenLabs key through `lookup`, or throw a clear error that
 * names the key (never a value) when it is missing (R9.4). The lookup is
 * injectable so this can be unit-tested with no real `.env` and no network;
 * `realRun` passes the `.env` reader. The returned key is handed straight to
 * the SDK and is never logged or written (R9.2, R9.3).
 */
export function requireApiKey(
  lookup: (name: string) => string | undefined = readEnvKey,
): string {
  const apiKey = lookup(KEY_NAME);
  if (!apiKey) {
    throw new Error(
      `Missing ${KEY_NAME} in .env. Add ${KEY_NAME}=<your key> to the local .env file (gitignored). The key value is never printed.`,
    );
  }
  return apiKey;
}

async function realRun(lines: Line[]): Promise<void> {
  const apiKey = requireApiKey();

  // Import the SDK lazily and by a computed specifier so neither dry-run, the
  // test, nor the project typecheck needs the package installed. The SDK is a
  // real dependency only for the explicit paid run.
  const sdkName = "@elevenlabs/elevenlabs-js";
  const { ElevenLabsClient } = (await import(sdkName)) as {
    ElevenLabsClient: new (opts: { apiKey: string }) => {
      textToSpeech: {
        convert: (
          voiceId: string,
          body: { text: string; modelId: string },
        ) => Promise<AsyncIterable<Uint8Array>>;
      };
    };
  };
  const client = new ElevenLabsClient({ apiKey });

  const synth: Synth = async (text) => {
    const audio = await client.textToSpeech.convert(VOICE_ID, {
      text,
      modelId: MODEL_ID,
    });
    const chunks: Uint8Array[] = [];
    for await (const chunk of audio) chunks.push(chunk);
    return Buffer.concat(chunks);
  };

  const { total, skipped, generated } = await generateInto(
    lines,
    CACHE_DIR,
    synth,
  );
  // Counts only; never the key, the text, or the key-to-file mapping.
  console.log(
    `Done. ${total} lines total, ${skipped} skipped (cached), ${generated} generated.`,
  );
}

async function main(): Promise<void> {
  const dry = process.argv.includes("--dry-run");
  const pack = loadPack(PACK_PATH);
  const lines = collectLines(pack.milestones ?? []);

  if (dry) {
    dryRun(lines);
    return;
  }
  await realRun(lines);
}

// Run as a CLI only when invoked directly, not when imported by the test.
if (
  typeof process !== "undefined" &&
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  main().catch((err) => {
    console.error((err as Error).message);
    process.exitCode = 1;
  });
}
