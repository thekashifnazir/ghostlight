import { afterAll, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cacheFileName, cacheKey } from "../src/hints/cache.js";
import {
  collectLines,
  generateInto,
  MODEL_ID,
  VOICE_ID,
  type Synth,
} from "../scripts/gen-voice.js";
import type { Pack } from "../packs/tools/src/types.js";

// Run the generator over the REAL pack with the ElevenLabs call mocked: the
// mock writes an empty file for each computed key, so the test needs no key and
// no network (R10.5). Output goes to a temp dir, never the real cache, so this
// test never collides with real generated audio.
const pack = JSON.parse(
  readFileSync(resolve(__dirname, "../packs/drascula-en.json"), "utf8"),
) as Pack;

const outDir = mkdtempSync(resolve(tmpdir(), "ghostlight-ghost-"));

afterAll(() => {
  rmSync(outDir, { recursive: true, force: true });
});

// Mocked synthesis: no ElevenLabs, no network, no key. Produces empty bytes.
const mockSynth: Synth = async () => new Uint8Array(0);

describe("cache coverage: every pack hint line is cached after generation", () => {
  it("writes a file per tier of every milestone at its cacheKey path", async () => {
    const lines = collectLines(pack.milestones ?? []);
    const result = await generateInto(lines, outDir, mockSynth);

    // First run generates everything, skips nothing.
    expect(result.total).toBe(lines.length);
    expect(result.generated).toBe(lines.length);
    expect(result.skipped).toBe(0);

    // Every tier of every milestone has a file at its content-addressed path.
    for (const m of pack.milestones ?? []) {
      for (const tier of ["nudge", "clue", "answer"] as const) {
        const key = await cacheKey(m.hints[tier], VOICE_ID, MODEL_ID);
        const path = resolve(outDir, cacheFileName(key));
        expect(existsSync(path), `${m.id}/${tier} -> ${path}`).toBe(true);
      }
    }
  });

  it("re-running skips every already-cached line", async () => {
    const lines = collectLines(pack.milestones ?? []);
    const result = await generateInto(lines, outDir, mockSynth);
    expect(result.skipped).toBe(lines.length);
    expect(result.generated).toBe(0);
  });
});
