// One-time (and re-runnable) reformat of a pack file to the stable layout that
// merge.ts writes. Changes layout only: before writing, the script parses the
// new text and checks it is deeply equal to the parsed original, and refuses to
// write if it is not.
//
//   tsx packs/survey/format-pack.ts [packPath]          rewrite in place
//   tsx packs/survey/format-pack.ts [packPath] --check  exit 1 if not already stable
//
// Spec: .kiro/specs/pack-coverage, Requirement 4.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { serializePack } from "./serialize-pack.js";

function main(argv: string[]): number {
  const check = argv.includes("--check");
  const pathArg = argv.find((a) => !a.startsWith("--"));
  const packPath = resolve(pathArg ?? resolve(import.meta.dirname, "..", "drascula-en.json"));

  const before = readFileSync(packPath, "utf8");
  const parsed: unknown = JSON.parse(before);
  const after = serializePack(parsed);

  if (!isDeepStrictEqual(JSON.parse(after), parsed)) {
    console.error("format-pack: reformatted text is NOT deeply equal to the original; nothing written.");
    return 1;
  }
  if (after === before) {
    console.log(`format-pack: ${packPath} is already in the stable layout.`);
    return 0;
  }
  if (check) {
    console.error(`format-pack: ${packPath} is not in the stable layout (run without --check).`);
    return 1;
  }
  writeFileSync(packPath, after);
  console.log(
    `format-pack: rewrote ${packPath} (${before.split("\n").length - 1} -> ${after.split("\n").length - 1} lines); deep-equal check passed.`,
  );
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv.slice(2)));
}
