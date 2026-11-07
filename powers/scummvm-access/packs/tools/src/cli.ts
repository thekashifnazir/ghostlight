#!/usr/bin/env node
// CLI for the pack tools. Two subcommands:
//   validate <pack> [schema]
//   check-coverage <pack> <census>
// Exits 0 when clean, non-zero with the full list of problems otherwise.
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { loadCensus, loadPack, loadSchema } from "./load.js";
import { validatePack } from "./validate.js";
import { checkCoverage } from "./coverage.js";

const HERE = dirname(fileURLToPath(import.meta.url));
// Default schema sits at packs/schema.json, one level up from src/ (or dist/).
const DEFAULT_SCHEMA = resolve(HERE, "..", "..", "schema.json");

function usage(): never {
  console.error(
    [
      "Usage:",
      "  pack-validate validate <pack.json> [schema.json]",
      "  pack-validate check-coverage <pack.json> <census.json>",
    ].join("\n"),
  );
  process.exit(2);
}

function runValidate(packPath: string, schemaPath: string): number {
  const pack = loadPack(packPath);
  const schema = loadSchema(schemaPath);
  const result = validatePack(pack, schema);
  if (result.ok) {
    console.log(`validate: ${packPath} is valid (${schemaPath}).`);
    return 0;
  }
  console.error(`validate: ${packPath} has ${result.errors.length} error(s):`);
  for (const e of result.errors) console.error(`  ${e.path}  ${e.message}`);
  return 1;
}

function runCoverage(packPath: string, censusPath: string): number {
  const pack = loadPack(packPath);
  const census = loadCensus(censusPath);
  const result = checkCoverage(pack, census);
  const chapters = pack.pack.coverage.chapters.join(", ");
  if (result.ok) {
    console.log(
      `check-coverage: ${packPath} fully covers census chapters ${chapters}.`,
    );
    return 0;
  }
  console.error(
    `check-coverage: ${packPath} has ${result.gaps.length} gap(s) for chapters ${chapters}:`,
  );
  for (const g of result.gaps) console.error(`  [${g.kind}] ${g.message}`);
  return 1;
}

function main(argv: string[]): number {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case "validate": {
      const [packPath, schemaPath] = rest;
      if (!packPath) usage();
      return runValidate(packPath, schemaPath ?? DEFAULT_SCHEMA);
    }
    case "check-coverage": {
      const [packPath, censusPath] = rest;
      if (!packPath || !censusPath) usage();
      return runCoverage(packPath, censusPath);
    }
    default:
      usage();
  }
}

process.exit(main(process.argv.slice(2)));
