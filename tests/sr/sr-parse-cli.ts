// sr-parse-cli.ts — validate a scenario file and print a small summary, or exit
// non-zero with a located error. Invoked by scripts/sr-check.sh BEFORE the VM
// is touched (Requirement 1.3 / 3.4), so a missing or malformed scenario stops
// the run cheaply and the VM is never started.
//
//   npx vite-node tests/sr/sr-parse-cli.ts -- <scenarioPath>
//
// On success prints: <stepCount> <scenarioName> and the fixture/url if present,
// one value per line prefixed so bash can read them.

import { loadScenario, ScenarioError } from "./sr-parse.js";

const path = process.argv[2];
if (!path) {
  console.error("usage: sr-parse-cli <scenarioPath>");
  process.exit(2);
}

try {
  const s = loadScenario(path);
  console.log(`name=${s.name}`);
  console.log(`steps=${s.steps.length}`);
  if (s.fixture) console.log(`fixture=${s.fixture}`);
  if (s.url) console.log(`url=${s.url}`);
  process.exit(0);
} catch (e) {
  if (e instanceof ScenarioError) {
    console.error(e.message);
    process.exit(1);
  }
  throw e;
}
