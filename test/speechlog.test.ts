// @vitest-environment jsdom
//
// The console mirror (?speechlog): the observer-only test aid that mirrors
// every live-region line as `[say] <text>` and every focus change to a named
// control as `[focus] <name> (<role>[, n of m])`. These tests pin the pure
// formatting (accessible name, role, position suffix), the enablement gate
// (off unless the param is present), the `say` line shape, and the focusin
// listener logging the right controls and skipping unnamed ones — all without
// touching the live region or the keyboard.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  accessibleName,
  controlRole,
  focusLogLine,
  installSpeechlog,
  isSpeechlogEnabled,
} from "../src/engine/speechlog.js";

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("isSpeechlogEnabled", () => {
  it("is off by default (no param) and on for any ?speechlog value", () => {
    expect(isSpeechlogEnabled("")).toBe(false);
    expect(isSpeechlogEnabled("?replay=tavern")).toBe(false);
    expect(isSpeechlogEnabled("?speechlog")).toBe(true);
    expect(isSpeechlogEnabled("?speechlog=1")).toBe(true);
    expect(isSpeechlogEnabled("?replay=tavern&speechlog")).toBe(true);
  });
});

describe("accessibleName", () => {
  it("prefers aria-label, then aria-labelledby, then text content", () => {
    document.body.innerHTML = `
      <div id="app" role="application" aria-label="Ghostlight game"></div>
      <span id="lbl">Type a command</span>
      <input id="box" aria-labelledby="lbl" />
      <button id="btn">Continue</button>
      <div id="bare"></div>
    `;
    expect(accessibleName(document.getElementById("app")!)).toBe("Ghostlight game");
    expect(accessibleName(document.getElementById("box")!)).toBe("Type a command");
    expect(accessibleName(document.getElementById("btn")!)).toBe("Continue");
    expect(accessibleName(document.getElementById("bare")!)).toBe("");
  });
});

describe("controlRole", () => {
  it("uses an explicit role, else maps native elements", () => {
    document.body.innerHTML = `
      <div id="menuitem" role="menuitem">Open</div>
      <button id="btn">Start</button>
      <input id="text" type="text" />
      <a id="link" href="/source/">Source</a>
      <div id="plain"></div>
    `;
    expect(controlRole(document.getElementById("menuitem")!)).toBe("menuitem");
    expect(controlRole(document.getElementById("btn")!)).toBe("button");
    expect(controlRole(document.getElementById("text")!)).toBe("textbox");
    expect(controlRole(document.getElementById("link")!)).toBe("link");
    expect(controlRole(document.getElementById("plain")!)).toBe("");
  });
});

describe("focusLogLine", () => {
  it("adds ', n of m' only when both posinset and setsize are present", () => {
    document.body.innerHTML = `
      <button id="item" role="menuitem" aria-posinset="1" aria-setsize="4">Open</button>
      <div id="app" role="application" aria-label="Ghostlight game"></div>
      <button id="gate">Continue</button>
    `;
    expect(focusLogLine(document.getElementById("item")!)).toBe(
      "Open (menuitem, 1 of 4)",
    );
    expect(focusLogLine(document.getElementById("app")!)).toBe(
      "Ghostlight game (application)",
    );
    expect(focusLogLine(document.getElementById("gate")!)).toBe(
      "Continue (button)",
    );
  });

  it("returns undefined for an element with no name or no role (not a control)", () => {
    document.body.innerHTML = `
      <div id="noname" role="application"></div>
      <div id="norole">just text</div>
    `;
    expect(focusLogLine(document.getElementById("noname")!)).toBeUndefined();
    expect(focusLogLine(document.getElementById("norole")!)).toBeUndefined();
  });
});

describe("installSpeechlog — say", () => {
  it("mirrors a live-region line as `[say] <text>`, trimmed, skipping empty", () => {
    const log = vi.fn();
    const sl = installSpeechlog({ doc: document, log });
    sl.say("  Inn bar. Here: bartender.  ");
    sl.say("   "); // whitespace-only is not announced, so not mirrored
    sl.say("");
    expect(log.mock.calls.map((c) => c[0])).toEqual([
      "[say] Inn bar. Here: bartender.",
    ]);
    sl.dispose();
  });
});

describe("installSpeechlog — focus listener", () => {
  it("logs `[focus] …` for a named control that receives focus", () => {
    document.body.innerHTML = `
      <button id="item" role="menuitem" aria-posinset="2" aria-setsize="3">Give me a drink.</button>
    `;
    const log = vi.fn();
    const sl = installSpeechlog({ doc: document, log });

    const btn = document.getElementById("item") as HTMLButtonElement;
    btn.focus();
    // jsdom fires focusin on focus(); assert the composed line reached the log.
    expect(log).toHaveBeenCalledWith("[focus] Give me a drink. (menuitem, 2 of 3)");

    sl.dispose();
  });

  it("does not log a focus change to an unnamed / roleless element", () => {
    document.body.innerHTML = `<div id="plain" tabindex="-1">just a div</div>`;
    const log = vi.fn();
    const sl = installSpeechlog({ doc: document, log });

    (document.getElementById("plain") as HTMLElement).focus();
    // A plain div with no role is not a named control, so nothing is logged.
    expect(log).not.toHaveBeenCalled();

    sl.dispose();
  });

  it("dispose() removes the listener so later focus changes are not logged", () => {
    document.body.innerHTML = `<button id="b" aria-label="Start">Start</button>`;
    const log = vi.fn();
    const sl = installSpeechlog({ doc: document, log });
    sl.dispose();

    (document.getElementById("b") as HTMLButtonElement).focus();
    expect(log).not.toHaveBeenCalled();
  });
});
