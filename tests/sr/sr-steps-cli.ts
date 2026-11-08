// sr-steps-cli.ts — emit a scenario's steps as a simple, tab-separated stream
// the bash orchestrator loops over, one line per step:
//
//   <index>\t<waitMs>\t<keys>\t<waitForSpoken>
//
// keys is the raw chord/action token (e.g. "right", "tab,esc", "start",
// "reload", "continue"); the orchestrator decides how to drive each. waitMs is
// the resolved wait (the scenario value or the default). waitForSpoken is the
// optional live-region substring the runner polls for before capturing (empty
// when the step has none); with it, waitMs is the poll cap rather than a fixed
// sleep. Matching the spoken output is done later by sr-report from the
// captured raw files, so only the driving fields are emitted here.
//
//   npx vite-node tests/sr/sr-steps-cli.ts -- <scenarioPath> [defaultWaitMs]

import { loadScenario } from "./sr-parse.js";

const path = process.argv[2];
const defaultWaitMs = Number(process.argv[3] ?? "1500");
if (!path) {
  console.error("usage: sr-steps-cli <scenarioPath> [defaultWaitMs]");
  process.exit(2);
}

const scenario = loadScenario(path);
scenario.steps.forEach((step, i) => {
  const waitMs = step.waitMs ?? defaultWaitMs;
  const waitForSpoken = (step.waitForSpoken ?? "").replace(/[\t\n\r]/g, " ");
  process.stdout.write(`${i}\t${waitMs}\t${step.keys}\t${waitForSpoken}\n`);
});
