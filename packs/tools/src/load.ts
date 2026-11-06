// Local file I/O only. No network calls.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Census, Pack } from "./types.js";

/** Read and parse a JSON file from a local path. Throws a clear error on bad JSON. */
export function readJson<T>(path: string): T {
  const abs = resolve(path);
  let raw: string;
  try {
    raw = readFileSync(abs, "utf8");
  } catch (err) {
    throw new Error(`Cannot read file: ${abs} (${(err as Error).message})`);
  }
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    throw new Error(`Invalid JSON in ${abs}: ${(err as Error).message}`);
  }
}

export function loadSchema(path: string): Record<string, unknown> {
  return readJson<Record<string, unknown>>(path);
}

export function loadPack(path: string): Pack {
  return readJson<Pack>(path);
}

export function loadCensus(path: string): Census {
  return readJson<Census>(path);
}
