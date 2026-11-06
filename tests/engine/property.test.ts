// Task 22: property-based tests (TypeScript + fast-check).
//
// fast-check generates random valid command sequences and drives the engine
// through the replay oracle, asserting the invariants that must hold for any
// sequence:
//   1. inventory after a command == inventory before + invAdded - invRemoved;
//   2. a diff's room (when the room changed) matches the room in the next
//      A11Y room-state line;
//   3. changed:false implies no other diff field moved;
//   4. every accepted command yields exactly one A11Y_DIFF or exactly one
//      A11Y_ERR (never both, never neither).
//
// Today the oracle is fixture-backed; the invariants are written against the
// generic EngineHarness observation, so when NativeHarness is wired the random
// sequences drive the real engine and these same properties are checked.

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { ReplayOracle } from "./src/oracle.js";
import { applyInvDelta, checkInvariants } from "./src/invariants.js";
import { diffOf } from "./src/harness.js";

const oracle = new ReplayOracle();
const accepted = oracle.acceptedCommands;
const erring = oracle.erringCommands();

/**
 * Drive a fresh oracle through a random *valid* command sequence. fast-check
 * generates selection numbers; at each step we map the number onto the set of
 * currently-applicable commands, so the sequence is always valid for the model
 * state (the task asks for "random valid command sequences"). Returns the
 * observations in order.
 */
function runValidSequence(picks: number[]): ReturnType<ReplayOracle["run"]>[] {
  const run = new ReplayOracle();
  const observations: ReturnType<ReplayOracle["run"]>[] = [];
  for (const pick of picks) {
    const options = accepted.filter((c) => run.applicable(c));
    if (options.length === 0) break;
    const cmd = options[pick % options.length]!;
    observations.push(run.run(cmd));
  }
  return observations;
}

describe("property: invariants over random valid command sequences", () => {
  it("every command in a random valid sequence satisfies all four invariants", () => {
    fc.assert(
      fc.property(
        fc.array(fc.nat(), { minLength: 1, maxLength: 40 }),
        (picks) => {
          for (const obs of runValidSequence(picks)) {
            const res = checkInvariants(obs);
            if (!res.ok) {
              const cmd = diffOf(obs.lines)?.cmd ?? "(err)";
              throw new Error(
                `invariants failed for "${cmd}": ${res.failures.join("; ")}`,
              );
            }
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it("invariant 1: inventory after == before + invAdded - invRemoved", () => {
    fc.assert(
      fc.property(
        fc.array(fc.nat(), { minLength: 1, maxLength: 40 }),
        (picks) => {
          const observations = runValidSequence(picks);
          // obs.invBefore of step n+1 must equal before + delta of step n.
          for (let i = 0; i < observations.length; i++) {
            const obs = observations[i]!;
            const d = diffOf(obs.lines);
            const after = d ? applyInvDelta(obs.invBefore, d) : obs.invBefore;
            const next = observations[i + 1];
            if (next) expect(next.invBefore).toEqual(after);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("invariant 4: an erring command yields one err and no diff", () => {
    if (erring.length === 0) return; // no erring fixture command recorded
    fc.assert(
      fc.property(fc.constantFrom(...erring), (cmd) => {
        const run = new ReplayOracle();
        const obs = run.run(cmd);
        const res = checkInvariants(obs);
        expect(res.ok, res.failures.join("; ")).toBe(true);
        expect(diffOf(obs.lines)).toBeNull();
        expect(obs.lines.some((l) => l.kind === "err")).toBe(true);
      }),
      { numRuns: 50 },
    );
  });

  it("invariant 2: a room-change diff matches the following room state", () => {
    fc.assert(
      fc.property(
        fc.array(fc.nat(), { minLength: 1, maxLength: 40 }),
        (picks) => {
          let sawRoomChange = false;
          for (const obs of runValidSequence(picks)) {
            const d = diffOf(obs.lines);
            if (d?.room && obs.nextRoomState) {
              sawRoomChange = true;
              expect(obs.nextRoomState.room).toBe(d.room[1]);
            }
          }
          return sawRoomChange || true; // the match, when present, must hold
        },
      ),
      { numRuns: 300 },
    );
  });

  it("invariant 3: changed:false diffs carry no moved field", () => {
    // Over valid sequences, any changed:false diff must have no real move
    // (flag-12 noise and spoken lines excluded). checkInvariants enforces it;
    // here we also confirm such diffs actually occur so the test has teeth.
    let sawNoop = false;
    fc.assert(
      fc.property(
        fc.array(fc.nat(), { minLength: 1, maxLength: 40 }),
        (picks) => {
          for (const obs of runValidSequence(picks)) {
            const d = diffOf(obs.lines);
            if (d?.changed === false) sawNoop = true;
            const res = checkInvariants(obs);
            expect(res.ok, res.failures.join("; ")).toBe(true);
          }
        },
      ),
      { numRuns: 200 },
    );
    expect(sawNoop, "expected some changed:false diff to be exercised").toBe(
      true,
    );
  });
});

describe("property: the command pool is non-trivial", () => {
  it("has accepted commands covering verbs, walking and use-on-object", () => {
    expect(accepted.length).toBeGreaterThan(0);
    expect(accepted.some((c) => c.startsWith("walk"))).toBe(true);
    expect(accepted.some((c) => c.startsWith("use "))).toBe(true);
    expect(
      accepted.some((c) => /^(look|take|open|close|talk|push) /.test(c)),
    ).toBe(true);
  });
});
