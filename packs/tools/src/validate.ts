// Pack validation: schema (Ajv 2020-12) plus cross-reference checks the
// schema cannot express. Collects every error, never short-circuits.
import Ajv2020 from "ajv/dist/2020.js";
import type { ErrorObject } from "ajv";
import { FLAG_MAX, FLAG_MIN } from "./types.js";
import type { Condition, Milestone, Pack } from "./types.js";

export interface ValidationError {
  /** JSON pointer / dotted path to the offending value, or "" for whole-pack. */
  path: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: ValidationError[];
}

/** Stage 1: validate the pack against the JSON Schema with all errors collected. */
export function validateSchema(
  pack: unknown,
  schema: Record<string, unknown>,
): ValidationError[] {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);
  const ok = validate(pack);
  if (ok) return [];
  return (validate.errors ?? []).map((e: ErrorObject) => ({
    path: e.instancePath || "/",
    message: `${e.message ?? "invalid"}${
      e.params && Object.keys(e.params).length
        ? " " + JSON.stringify(e.params)
        : ""
    }`,
  }));
}

/** Walk a condition tree, collecting every flag index and every milestone ref. */
function walkCondition(
  cond: Condition,
  onFlag: (index: number) => void,
  onMilestone: (id: string) => void,
): void {
  if (cond.flags) {
    for (const key of Object.keys(cond.flags)) onFlag(Number(key));
  }
  if (cond.milestone !== undefined) onMilestone(cond.milestone);
  if (cond.all) for (const c of cond.all) walkCondition(c, onFlag, onMilestone);
  if (cond.any) for (const c of cond.any) walkCondition(c, onFlag, onMilestone);
  if (cond.not) walkCondition(cond.not, onFlag, onMilestone);
}

/** Stage 2: cross-reference checks that JSON Schema cannot express. */
export function validateCrossRefs(pack: Pack): ValidationError[] {
  const errors: ValidationError[] = [];
  const milestones: Milestone[] = pack.milestones ?? [];
  const milestoneIds = new Set(milestones.map((m) => m.id));

  // Item (id, chapter) uniqueness.
  const seenItemKeys = new Set<string>();
  (pack.items ?? []).forEach((item, i) => {
    for (const ch of item.chapters) {
      const key = `${item.id}:${ch}`;
      if (seenItemKeys.has(key)) {
        errors.push({
          path: `/items/${i}`,
          message: `duplicate item (id ${item.id}, chapter ${ch}); each (id, chapter) must be unique`,
        });
      }
      seenItemKeys.add(key);
    }
  });

  // Flag range in every condition anywhere in the pack (exits.opensWhen and
  // milestone.when), plus referenced milestone ids exist.
  const checkConditionFlags = (cond: Condition, where: string, chapter?: number) => {
    walkCondition(
      cond,
      (index) => {
        if (!Number.isInteger(index) || index < FLAG_MIN || index > FLAG_MAX) {
          errors.push({
            path: where,
            message: `flag index ${index} out of range ${FLAG_MIN} to ${FLAG_MAX}${
              chapter !== undefined ? ` (chapter ${chapter})` : ""
            }`,
          });
        }
      },
      (id) => {
        if (!milestoneIds.has(id)) {
          errors.push({
            path: where,
            message: `condition refers to unknown milestone "${id}"`,
          });
        }
      },
    );
  };

  // exits.*.opensWhen conditions.
  for (const [roomNum, room] of Object.entries(pack.rooms)) {
    for (const [exitNum, exit] of Object.entries(room.exits)) {
      if (exit.opensWhen) {
        checkConditionFlags(
          exit.opensWhen,
          `/rooms/${roomNum}/exits/${exitNum}/opensWhen`,
        );
      }
    }
  }

  // Milestone checks: after ids exist, no cycles, when flags in range for chapter.
  for (const [i, m] of milestones.entries()) {
    const base = `/milestones/${i}`;
    for (const dep of m.after ?? []) {
      if (!milestoneIds.has(dep)) {
        errors.push({
          path: `${base}/after`,
          message: `milestone "${m.id}" lists unknown prerequisite "${dep}"`,
        });
      }
    }
    if (m.when) checkConditionFlags(m.when, `${base}/when`, m.chapter);
  }

  // after graph acyclicity (DFS with a visiting set).
  const byId = new Map(milestones.map((m) => [m.id, m]));
  const state = new Map<string, "visiting" | "done">();
  const inCycle = new Set<string>();
  const visit = (id: string, stack: string[]): void => {
    const s = state.get(id);
    if (s === "done") return;
    if (s === "visiting") {
      const from = stack.indexOf(id);
      for (const node of stack.slice(from)) inCycle.add(node);
      return;
    }
    state.set(id, "visiting");
    const m = byId.get(id);
    for (const dep of m?.after ?? []) {
      if (byId.has(dep)) visit(dep, [...stack, id]);
    }
    state.set(id, "done");
  };
  for (const m of milestones) visit(m.id, []);
  if (inCycle.size > 0) {
    errors.push({
      path: "/milestones",
      message: `cycle in milestone "after" graph involving: ${[...inCycle]
        .sort()
        .join(", ")}`,
    });
  }

  return errors;
}

/** Full validation: schema then cross-references, all errors merged. */
export function validatePack(
  pack: unknown,
  schema: Record<string, unknown>,
): ValidationResult {
  const schemaErrors = validateSchema(pack, schema);
  // Cross-ref checks assume the basic shape; run them whenever the top-level
  // object has the sections we read, so authors see both kinds at once.
  let crossErrors: ValidationError[] = [];
  if (pack && typeof pack === "object" && "rooms" in pack) {
    try {
      crossErrors = validateCrossRefs(pack as Pack);
    } catch (err) {
      crossErrors = [
        {
          path: "/",
          message: `cross-reference checks could not run: ${(err as Error).message}`,
        },
      ];
    }
  }
  const errors = [...schemaErrors, ...crossErrors];
  return { ok: errors.length === 0, errors };
}
