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

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cacheFileName, cacheKey } from "../src/hints/cache.js";
import { loadPack } from "../packs/tools/src/load.js";
import type { Hints, Milestone } from "../packs/tools/src/types.js";

const VOICE_ID = "nbk2esDn4RRk4cVDdoiE"; // Alice (ASMR British Whisper)
const MODEL_ID = "eleven_v4";
const KEY_NAME = "ELEVENLABS_API_KEY";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const PACK_PATH = resolve(REPO, "packs/drascula-en.json");
const CACHE_DIR = resolve(REPO, "src/hints/ghost");

type TierName = keyof Hints; // "nudge" | "clue" | "answer"
const TIERS: TierName[] = ["nudge", "clue", "answer"];

interface Line {
  milestoneId: string;
  chapter: number;
  tier: TierName;
  text: string;
}

/** Every hint line in the pack: three tiers per milestone. */
function collectLines(milestones: Milestone[]): Line[] {
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

/** Read one named value from .env without exposing any other value. */
function readEnvKey(name: string): string | undefined {
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
    // Strip matching surrounding quotes if present.
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

  // Per-chapter breakdown.
  const byChapter = new Map<number, { lines: number; chars: number }>();
  for (const l of lines) {
    const c = byChapter.get(l.chapter) ?? { lines: 0, chars: 0 };
    c.lines += 1;
    c.chars += l.text.length;
    byChapter.set(l.chapter, c);
  }

  // Per-tier breakdown.
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
  // Rough cost at ~$0.08 per 1,000 characters (spike 06-voice).
  const estUsd = (totalChars / 1000) * 0.08;
  console.log(`Estimated cost at $0.08/1,000 chars: $${estUsd.toFixed(2)}`);
}

async function realRun(lines: Line[]): Promise<void> {
  const apiKey = readEnvKey(KEY_NAME);
  if (!apiKey) {
    throw new Error(
      `Missing ${KEY_NAME} in .env. Add ${KEY_NAME}=<your key> to the local .env file (gitignored). The key value is never printed.`,
    );
  }

  mkdirSync(CACHE_DIR, { recursive: true });

  // Import the SDK lazily so dry-run needs no dependency on it.
  const { ElevenLabsClient } = await import("@elevenlabs/elevenlabs-js");
  const client = new ElevenLabsClient({ apiKey });

  let generated = 0;
  let skipped = 0;
  for (const line of lines) {
    const key = await cacheKey(line.text, VOICE_ID, MODEL_ID);
    const outPath = resolve(CACHE_DIR, cacheFileName(key));
    if (existsSync(outPath)) {
      skipped += 1;
      continue;
    }
    const audio = await client.textToSpeech.convert(VOICE_ID, {
      text: line.text,
      modelId: MODEL_ID,
    });
    const chunks: Uint8Array[] = [];
    for await (const chunk of audio as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    writeFileSync(outPath, Buffer.concat(chunks));
    generated += 1;
  }

  // Counts only; never the key, the text, or the key-to-file mapping.
  console.log(
    `Done. ${lines.length} lines total, ${skipped} skipped (cached), ${generated} generated.`,
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

main().catch((err) => {
  // Print only the message; it never contains the key value.
  console.error((err as Error).message);
  process.exitCode = 1;
});
