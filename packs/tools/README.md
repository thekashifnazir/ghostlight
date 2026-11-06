# Pack tools

Validator, coverage checker and property-based tests for ScummVM accessibility packs (format v1). Everything here is MIT licensed, like the rest of the repo outside `engine/`. The tools read packs, the schema and the census as local files only; they make no network calls and never touch `engine/`, `scripts/` or `vendor/`.

## Install

```sh
cd packs/tools
npm install
```

## Validate a pack

Runs schema validation (Ajv, JSON Schema 2020-12) plus the cross-reference checks the schema cannot express (item `(id, chapter)` uniqueness, `after` ids exist, no `after` cycles, referenced milestone ids exist, flag indices in range 0 to 49 and in range for a milestone's chapter). Reports every error, not just the first, and exits non-zero on any error.

```sh
npm run validate -- ../drascula-en.json
```

## Check coverage against the census

Compares a pack to `reference/census.json` for the chapters in `pack.coverage.chapters`: every census room, hotspot and door in a covered chapter has a pack entry; door destinations match the census (unless a documented `note` overrides); no stale entries; exit destinations agree with the census exit graph. Exits non-zero on any gap.

```sh
npm run check-coverage -- ../drascula-en.json ../../reference/census.json
```

## Test

Property-based tests with fast-check, run under Vitest.

```sh
npm test
```

## Layout

```
src/
  types.ts      TypeScript types mirrored from schema.json
  load.ts       read + parse pack / schema / census (local files only)
  validate.ts   schema check + cross-reference checks
  coverage.ts   census coverage + exit-graph check
  hints.ts      milestone hint-selection rule (pure function)
  cli.ts        validate and check-coverage entry points
test/
  gen.ts            fast-check arbitraries
  validate.test.ts  validator unit + property tests
  coverage.test.ts  checker unit + property tests
  hints.test.ts     no-spoiler invariant
```
