// sr-report-cli.ts — thin executable wrapper around runReportCli, invoked by
// scripts/sr-check.sh via vite-node. Kept separate from sr-report.ts so that
// module stays a pure, importable library (the tests import buildReport etc.
// without triggering a process.exit).
//
//   npx vite-node tests/sr/sr-report-cli.ts -- <scenarioPath> <captureDir> <reportDir> <url> [--stopped <reason>]

import { runReportCli } from "./sr-report.js";

process.exit(runReportCli(process.argv.slice(2)));
