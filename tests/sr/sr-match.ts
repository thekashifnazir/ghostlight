// sr-harness speech-log matcher (Requirement 5, pure).
//
// Two pure pieces, both VM-free so they can be unit-tested on recorded NVDA
// logs:
//
//   reduceSpeech(rawLines)  — turns raw NVDA "Speaking [...]" log lines into
//                             plain spoken utterances, stripping the wrapper
//                             noise and the Chrome window/document focus lines,
//                             exactly as Spike 10's keys.ps1 does. The live
//                             runner and the tests reduce identically, so a
//                             recorded log and a live capture are judged the
//                             same way.
//
//   matchStep(utterances, step) — decides a single step's pass/fail from the
//                             utterances it produced and its expectSpoken /
//                             expectNotSpoken substrings.
//
// Neither touches the VM, the filesystem, or the network.

import type { Step } from "./sr-parse.js";

/** The outcome of matching one step against what the screen reader said. */
export interface StepVerdict {
  /** True iff every expectSpoken is present and no expectNotSpoken is present. */
  pass: boolean;
  /** expectSpoken substrings that were not found (empty when all present). */
  missing: string[];
  /** expectNotSpoken substrings that were found (empty when none present). */
  forbidden: string[];
  /** The reduced utterances this step saw, for the report. */
  utterances: string[];
}

// NVDA at IO logging level writes each utterance as, e.g.:
//   Speaking [LangChangeCommand ('en_US'), 'bin, 2 of 10', CancellableSpeech (still valid)]
// The wrappers carry no spoken content; the quoted text is what the player
// hears. These patterns peel the wrappers off, matching keys.ps1's -replace
// chain.
const SPEAKING_PREFIX = /^Speaking \[/;
const LANG_CHANGE = /LangChangeCommand \('[^']*'\), /g;
const CANCELLABLE_SUFFIX = /, CancellableSpeech \([^)]*\)\]$/;
const TRAILING_BRACKET = /\]$/;

// Chrome's own focus utterances ("Google Chrome', 'window'", "...', 'document'")
// are not game output; keys.ps1 drops them. Match the same shapes.
const CHROME_FOCUS = /Google Chrome', 'window'|', 'document'$/;

/**
 * Reduce raw NVDA log lines to spoken utterances. Keeps only `Speaking` lines,
 * strips the LangChange/CancellableSpeech wrappers, drops the Chrome
 * window/document focus lines, and trims surrounding quotes/whitespace. Lines
 * that are not `Speaking` entries are ignored.
 */
export function reduceSpeech(rawLines: string[]): string[] {
  const out: string[] = [];
  for (const line of rawLines) {
    if (!SPEAKING_PREFIX.test(line)) continue;

    // Reduce first, then filter — the same order as keys.ps1, whose -replace
    // chain strips the wrappers and whose Where-clause then drops the Chrome
    // focus lines from the reduced text.
    let text = line.replace(SPEAKING_PREFIX, "");
    text = text.replace(LANG_CHANGE, "");
    text = text.replace(CANCELLABLE_SUFFIX, "");
    text = text.replace(TRAILING_BRACKET, "");
    text = text.trim();

    // Chrome's own window/document focus utterances are not game output.
    if (CHROME_FOCUS.test(text)) continue;

    // NVDA logs each spoken chunk as a quoted string; unwrap the outer quotes
    // when the whole utterance is a single quoted span.
    text = unwrapQuotes(text);
    if (text.length > 0) out.push(text);
  }
  return out;
}

/** Strip one layer of matching single or double quotes, if present. */
function unwrapQuotes(s: string): string {
  if (s.length >= 2) {
    const first = s[0];
    const last = s[s.length - 1];
    if ((first === "'" && last === "'") || (first === '"' && last === '"')) {
      return s.slice(1, -1);
    }
  }
  return s;
}

/**
 * Decide a step's pass/fail from its reduced utterances. Comparison is
 * case-insensitive substring matching against the joined utterances. Empty
 * utterances is valid input: a step that expected something spoken fails
 * (R5.6); a step with only expectNotSpoken passes. Pure — no side effects.
 */
export function matchStep(utterances: string[], step: Step): StepVerdict {
  const haystack = utterances.join("\n").toLowerCase();

  const missing = (step.expectSpoken ?? []).filter(
    (sub) => !haystack.includes(sub.toLowerCase()),
  );
  const forbidden = (step.expectNotSpoken ?? []).filter((sub) =>
    haystack.includes(sub.toLowerCase()),
  );

  return {
    pass: missing.length === 0 && forbidden.length === 0,
    missing,
    forbidden,
    utterances,
  };
}
