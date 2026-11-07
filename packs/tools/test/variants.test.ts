// Tests for description variants: the validator checks variant `when`
// conditions the same way it checks milestone `when` and `exits.opensWhen`,
// and coverage is unaffected by a description being a plain string or the
// variant object form. (description-variants spec, tasks 4, 5, 6.)
import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { loadCensus, loadPack, loadSchema } from "../src/load.js";
import { validatePack } from "../src/validate.js";
import { checkCoverage } from "../src/coverage.js";
import type { Describable, Pack } from "../src/types.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const PACK = resolve(HERE, "..", "..", "drascula-en.json");
const SCHEMA = resolve(HERE, "..", "..", "schema.json");
const CENSUS = resolve(HERE, "..", "..", "..", "reference", "census.json");

const schema = loadSchema(SCHEMA);
const census = loadCensus(CENSUS);

/** A fresh deep copy of the real pack for each test to mutate freely. */
function freshPack(): Pack {
  return loadPack(PACK) as Pack;
}

/** The default form of a description, whether it is a plain string or object. */
function plainDefault(d: Describable): string {
  return typeof d === "string" ? d : d.default;
}

/** Errors whose path points inside a variant `when`. */
function variantErrors(pack: Pack) {
  return validatePack(pack, schema).errors.filter((e) =>
    e.path.includes("/variants/"),
  );
}

describe("validator: variant conditions", () => {
  it("accepts valid variants with no new errors", () => {
    const pack = freshPack();
    pack.rooms["5"].short = {
      default: plainDefault(pack.rooms["5"].short),
      variants: [{ when: { flags: { "8": 1 } }, text: "The window is open." }],
    };
    pack.rooms["5"].long = {
      default: plainDefault(pack.rooms["5"].long),
      variants: [{ when: { flags: { "8": 1 } }, text: "The window stands open now." }],
    };
    const result = validatePack(pack, schema);
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("flags an out-of-range flag in a short variant, at the variant path", () => {
    const pack = freshPack();
    pack.rooms["5"].short = {
      default: "boarded",
      variants: [{ when: { flags: { "50": 1 } }, text: "open" }],
    };
    const errs = variantErrors(pack);
    expect(
      errs.some(
        (e) =>
          e.path === "/rooms/5/short/variants/0/when" &&
          /flag index/i.test(e.message),
      ),
    ).toBe(true);
  });

  it("flags an unknown milestone reference in a long variant, at the variant path", () => {
    const pack = freshPack();
    pack.rooms["5"].long = {
      default: "boarded",
      variants: [{ when: { milestone: "ch9.does-not-exist" }, text: "open" }],
    };
    const errs = variantErrors(pack);
    expect(
      errs.some(
        (e) =>
          e.path === "/rooms/5/long/variants/0/when" &&
          /unknown milestone/i.test(e.message),
      ),
    ).toBe(true);
  });

  it("recurses into any/all/not inside a variant when (object description)", () => {
    const pack = freshPack();
    pack.rooms["5"].objects["213"].description = {
      default: "a second window",
      variants: [{ when: { any: [{ flags: { "99": 1 } }] }, text: "beside the open one" }],
    };
    const errs = variantErrors(pack);
    expect(
      errs.some(
        (e) =>
          e.path === "/rooms/5/objects/213/description/variants/0/when" &&
          /flag index/i.test(e.message),
      ),
    ).toBe(true);
  });

  it("collects every variant error without short-circuiting", () => {
    const pack = freshPack();
    pack.rooms["5"].short = {
      default: "boarded",
      variants: [
        { when: { flags: { "88": 1 } }, text: "a" },
        { when: { milestone: "nope" }, text: "b" },
      ],
    };
    const errs = variantErrors(pack);
    expect(errs.some((e) => e.path === "/rooms/5/short/variants/0/when")).toBe(true);
    expect(errs.some((e) => e.path === "/rooms/5/short/variants/1/when")).toBe(true);
  });
});

describe("coverage: unaffected by description shape", () => {
  it("covers the real pack with no gaps once it carries variants", () => {
    const pack = freshPack();
    const toVariant = (d: Describable): Describable => ({
      default: plainDefault(d),
      variants: [{ when: { flags: { "8": 1 } }, text: "open" }],
    });
    pack.rooms["5"].short = toVariant(pack.rooms["5"].short);
    pack.rooms["5"].long = toVariant(pack.rooms["5"].long);
    pack.rooms["5"].objects["213"].description = toVariant(
      pack.rooms["5"].objects["213"].description as Describable,
    );
    const result = checkCoverage(pack, census);
    expect(result.gaps).toEqual([]);
    expect(result.ok).toBe(true);
  });
});
