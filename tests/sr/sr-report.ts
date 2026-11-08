// sr-report.ts — assemble a run report from a scenario and the raw per-step
// NVDA captures that sr-check.sh collected in the VM (Requirement 6). This is
// the Mac-side half: it parses the scenario, reduces each step's raw speech,
// matches it, prints one pass/fail line per step, writes the JSON report, and
// appends a one-line entry to the committed summary. No VM, no network.
//
// Invoked by scripts/sr-check.sh via `node --import tsx` (or tsc-compiled) as:
//   sr-report <scenarioPath> <captureDir> <reportDir> <url> [--stopped <reason>]
//
// captureDir holds, per executed step, a file `step-<i>.raw` with the raw
// `Speaking` lines captured after that step (empty file = no new speech). The
// number and order of step files follow the scenario's steps.

import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { loadScenario, type Step } from "./sr-parse.js";
import { reduceSpeech, matchStep, type StepVerdict } from "./sr-match.js";

interface StepReport {
  index: number;
  keys: string;
  note?: string;
  expectSpoken: string[];
  expectNotSpoken: string[];
  waitMs?: number;
  utterances: string[];
  verdict: StepVerdict;
}

interface RunReport {
  url: string;
  scenario: string;
  startedAt: string;
  result: "pass" | "fail" | "error";
  stoppedAt?: number;
  reason?: string;
  steps: StepReport[];
}

function readRaw(captureDir: string, index: number): string[] | null {
  const path = join(captureDir, `step-${index}.raw`);
  if (!existsSync(path)) return null; // step never ran
  const text = readFileSync(path, "utf8");
  return text.length === 0 ? [] : text.split(/\r?\n/);
}

export function buildReport(
  scenarioPath: string,
  captureDir: string,
  url: string,
  startedAt: string,
  stoppedReason: string | null,
): RunReport {
  const scenario = loadScenario(scenarioPath);
  const steps: StepReport[] = [];
  let anyFail = false;
  let stoppedAt: number | undefined;

  scenario.steps.forEach((step: Step, i: number) => {
    const raw = readRaw(captureDir, i);
    if (raw === null) {
      // This and later steps did not run (the run stopped early).
      if (stoppedAt === undefined) stoppedAt = i;
      return;
    }
    const utterances = reduceSpeech(raw);
    const verdict = matchStep(utterances, step);
    if (!verdict.pass) anyFail = true;
    steps.push({
      index: i,
      keys: step.keys,
      ...(step.note !== undefined ? { note: step.note } : {}),
      expectSpoken: step.expectSpoken ?? [],
      expectNotSpoken: step.expectNotSpoken ?? [],
      ...(step.waitMs !== undefined ? { waitMs: step.waitMs } : {}),
      utterances,
      verdict,
    });
  });

  const errored = stoppedReason !== null || stoppedAt !== undefined;
  const result: RunReport["result"] = errored ? "error" : anyFail ? "fail" : "pass";

  return {
    url,
    scenario: scenario.name,
    startedAt,
    result,
    ...(stoppedAt !== undefined ? { stoppedAt } : {}),
    ...(stoppedReason !== null ? { reason: stoppedReason } : {}),
    steps,
  };
}

export function printReport(report: RunReport): void {
  for (const s of report.steps) {
    const tag = s.verdict.pass ? "PASS" : "FAIL";
    const label = s.note ? `${s.note} [${s.keys}]` : s.keys;
    console.log(`${tag}  step ${s.index}: ${label}`);
    if (!s.verdict.pass) {
      if (s.verdict.missing.length) console.log(`        missing: ${s.verdict.missing.join(" | ")}`);
      if (s.verdict.forbidden.length) console.log(`        forbidden: ${s.verdict.forbidden.join(" | ")}`);
      console.log(`        spoken: ${s.utterances.join(" / ") || "(nothing)"}`);
    }
  }
  if (report.reason || report.stoppedAt !== undefined) {
    console.log(`ERROR  run did not complete${report.stoppedAt !== undefined ? ` (stopped at step ${report.stoppedAt})` : ""}: ${report.reason ?? "steps missing"}`);
  }
  const passed = report.steps.filter((s) => s.verdict.pass).length;
  console.log(`RESULT ${report.result.toUpperCase()}  (${passed}/${report.steps.length} steps passed)`);
}

export function writeReport(report: RunReport, reportDir: string): void {
  mkdirSync(reportDir, { recursive: true });
  writeFileSync(join(reportDir, "report.json"), JSON.stringify(report, null, 2) + "\n");
}

/** Append one row to the committed tests/sr/reports/summary.md table. */
export function appendSummary(report: RunReport, summaryPath: string): void {
  const passed = report.steps.filter((s) => s.verdict.pass).length;
  const failed = report.steps.length - passed;
  const date = report.startedAt.slice(0, 10);
  const row = `| ${date} | ${report.url} | ${report.scenario} | ${passed} | ${failed} | ${report.result} |\n`;
  if (!existsSync(summaryPath)) mkdirSync(dirname(summaryPath), { recursive: true });
  appendFileSync(summaryPath, row);
}

// CLI entry point, called by scripts/sr-check.sh through sr-report-cli.ts:
//   <scenarioPath> <captureDir> <reportDir> <url> [--stopped <reason>]
// Returns the process exit code: 0 pass, 1 fail, 2 usage.
export function runReportCli(argv: string[]): number {
  const [scenarioPath, captureDir, reportDir, url, flag, reason] = argv;
  if (!scenarioPath || !captureDir || !reportDir || !url) {
    console.error("usage: sr-report <scenarioPath> <captureDir> <reportDir> <url> [--stopped <reason>]");
    return 2;
  }
  const stoppedReason = flag === "--stopped" ? (reason ?? "unknown") : null;
  const report = buildReport(scenarioPath, captureDir, url, new Date().toISOString(), stoppedReason);
  printReport(report);
  writeReport(report, reportDir);
  // summary.md lives one level up from a dated report dir: reports/<date>/ -> reports/summary.md
  appendSummary(report, join(reportDir, "..", "summary.md"));
  return report.result === "pass" ? 0 : 1;
}
