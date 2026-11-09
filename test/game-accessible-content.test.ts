// @vitest-environment jsdom
//
// VoiceOver reads a role=application with no accessible content as "empty
// application". #game's other children are all aria-hidden or hidden, so the
// markup ships a visually hidden text node as its first child. These checks
// guard that node, and that nothing in src/ rebuilds #game's children.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..", "src");

const loadGame = (): HTMLElement => {
  const html = readFileSync(join(SRC, "index.html"), "utf8");
  document.documentElement.innerHTML = html;
  const game = document.getElementById("game");
  if (!game) throw new Error("#game missing from index.html");
  return game;
};

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return p.endsWith(".ts") ? [p] : [];
  });

describe("#game accessible content", () => {
  it("first child is a visible-to-AT text span", () => {
    const game = loadGame();
    const first = game.firstElementChild as HTMLElement;
    expect(first.tagName).toBe("SPAN");
    expect(first.classList.contains("visually-hidden")).toBe(true);
    expect(first.textContent).toBe("Ghostlight game");
    expect(first.closest("[aria-hidden='true']")).toBeNull();
    expect(first.hasAttribute("hidden")).toBe(false);
  });

  it("has a non-aria-hidden text child", () => {
    const game = loadGame();
    const readable = Array.from(game.children).filter(
      (c) =>
        !c.closest("[aria-hidden='true']") &&
        !c.hasAttribute("hidden") &&
        (c.textContent ?? "").trim() !== "",
    );
    expect(readable.length).toBeGreaterThan(0);
  });

  it("no source file clears or rebuilds #game's children", () => {
    const offenders: string[] = [];
    const pattern =
      /\b(gameEl|game)\b\s*\.\s*(innerHTML\s*=|replaceChildren\s*\(|textContent\s*=|innerText\s*=)|getElementById\(\s*["']game["']\s*\)\s*(!|\?)?\.\s*(innerHTML|replaceChildren|textContent)/;
    for (const file of sourceFiles(SRC)) {
      if (pattern.test(readFileSync(file, "utf8"))) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
