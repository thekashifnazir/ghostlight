import { describe, expect, it } from "vitest";
import { DRASCULA, QUEEN, gameFromSearch } from "../src/engine/game.js";
import { launchArguments } from "../src/engine/boot.js";
import { saveFileName } from "../src/engine/persistence.js";

describe("gameFromSearch", () => {
  it("defaults to drascula with no parameter", () => {
    expect(gameFromSearch("")).toBe(DRASCULA);
    expect(gameFromSearch("?live")).toBe(DRASCULA);
  });

  it("accepts game=drascula and game=queen", () => {
    expect(gameFromSearch("?game=drascula")).toBe(DRASCULA);
    expect(gameFromSearch("?live&game=queen")).toBe(QUEEN);
  });

  it("falls back to drascula for unknown values", () => {
    expect(gameFromSearch("?game=monkey")).toBe(DRASCULA);
    expect(gameFromSearch("?game=")).toBe(DRASCULA);
    expect(gameFromSearch("?game=QUEEN")).toBe(DRASCULA);
  });
});

describe("game configs", () => {
  it("carries the flag counts and packs", () => {
    expect(DRASCULA.flagCount).toBe(50);
    expect(QUEEN.flagCount).toBe(211);
    expect(DRASCULA.pack).toBe("drascula-en");
    expect(QUEEN.pack).toBe("queen-en");
  });

  it("carries the hero target and command example", () => {
    expect(DRASCULA.heroTarget).toBe(50);
    expect(QUEEN.heroTarget).toBeUndefined();
    expect(DRASCULA.commandExample).toBe("talk to drunk");
    expect(QUEEN.commandExample).toBe("look at chest");
  });
});

describe("save file names", () => {
  it("zero-pads the slot to 3 digits per game", () => {
    expect(saveFileName(1, QUEEN)).toBe("queen.001");
    expect(saveFileName(12, QUEEN)).toBe("queen.012");
    expect(saveFileName(1, DRASCULA)).toBe("drascula.001");
  });
});

describe("launch arguments", () => {
  it("launches queen from its data dir with its game id", () => {
    const args = launchArguments(undefined, QUEEN);
    expect(args.slice(-3)).toEqual(["-p", "/data/games/queen", "queen"]);
  });

  it("keeps the drascula launch unchanged", () => {
    const args = launchArguments(undefined, DRASCULA);
    expect(args.slice(-3)).toEqual(["-p", "/data/games/drascula", "drascula"]);
  });

  it("puts --save-slot before the game path", () => {
    const args = launchArguments(3, QUEEN);
    expect(args).toContain("--save-slot=3");
    expect(args.slice(-3)).toEqual(["-p", "/data/games/queen", "queen"]);
  });
});
