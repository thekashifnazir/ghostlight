// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { addMacGameSurfaceText } from "../src/ui/game-surface.js";

function makeGame(): HTMLElement {
  const el = document.createElement("div");
  el.id = "game";
  el.innerHTML = "<canvas></canvas>";
  return el;
}

describe("addMacGameSurfaceText", () => {
  it("adds the hidden span on a Mac, first, and not aria-hidden", () => {
    const el = makeGame();
    addMacGameSurfaceText(el, "MacIntel");
    const span = el.firstElementChild as HTMLElement;
    expect(span.tagName).toBe("SPAN");
    expect(span.classList.contains("visually-hidden")).toBe(true);
    expect(span.textContent).toBe("Ghostlight game");
    expect(span.hasAttribute("aria-hidden")).toBe(false);
  });

  it("adds it only once", () => {
    const el = makeGame();
    addMacGameSurfaceText(el, "macOS");
    addMacGameSurfaceText(el, "macOS");
    expect(el.querySelectorAll("span.visually-hidden").length).toBe(1);
  });

  it("never adds it on Windows or other platforms", () => {
    for (const p of ["Win32", "Windows", "Linux x86_64", "", undefined]) {
      const el = makeGame();
      addMacGameSurfaceText(el, p);
      expect(el.querySelector("span")).toBeNull();
    }
  });
});
