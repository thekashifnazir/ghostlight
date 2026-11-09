// A console mirror of what the screen reader would speak (?speechlog).
//
// The problem this solves: an automated tester (Kiro Crew's browser tool) can
// read the browser CONSOLE but cannot read inside the role="application"
// element (#game), and cannot press F1 to learn the keys. So for that tool the
// two surfaces that carry everything a blind player hears — the ARIA live
// region, and the accessible name/role/position of whatever control takes
// focus — are invisible. ?speechlog opens a window onto both: with the query
// param present, every live-region line is mirrored to `console.log` as
// `[say] <text>`, and every focus change to a NAMED control is mirrored as
// `[focus] <accessible name> (<role>[, n of m])`.
//
// It sits beside `window.__ghostlight` (engine/status.ts) as the other
// observer-only test aid, and shares its contract: OFF BY DEFAULT (only the
// `?speechlog` param turns it on), it never writes to the live region, binds no
// keys, renders no UI and changes nothing a real player hears or does — it only
// reflects, to the console, lines and focus moves that already happened. The
// `[say]` text is the exact line the live region received, unchanged; the
// `[focus]` line is computed from the focused element's own accessibility
// attributes (the same ones NVDA/JAWS read), not invented.
//
// Nothing reads these lines back; they exist solely for a console reader.

/**
 * Whether ?speechlog is present in a URL query string. Any value (or none)
 * turns it on: `?speechlog`, `?speechlog=1`, `?speechlog=true` all enable it;
 * its absence (the default) leaves it off. `search` is `location.search`.
 */
export function isSpeechlogEnabled(search: string): boolean {
  return new URLSearchParams(search).has("speechlog");
}

/**
 * The accessible name a screen reader would announce for an element, by the
 * same precedence the ARIA name computation uses for the controls this player
 * builds: an explicit `aria-label`, else the text referenced by
 * `aria-labelledby`, else the element's own trimmed text content. Returns an
 * empty string when none of these yields text (an unnamed element), which the
 * focus mirror treats as "not a named control" and skips.
 */
export function accessibleName(el: Element): string {
  const label = el.getAttribute("aria-label");
  if (label && label.trim()) return label.trim();

  const labelledby = el.getAttribute("aria-labelledby");
  if (labelledby) {
    const doc = el.ownerDocument;
    const text = labelledby
      .split(/\s+/)
      .map((id) => doc.getElementById(id)?.textContent?.trim() ?? "")
      .filter(Boolean)
      .join(" ")
      .trim();
    if (text) return text;
  }

  const own = el.textContent?.trim() ?? "";
  return own;
}

/**
 * The ARIA role a screen reader would report for an element: an explicit
 * `role` attribute if present, else a small mapping of the native elements
 * this player focuses (a `<button>` is a button, a text `<input>` is a
 * textbox). Returns an empty string for anything else, which the focus mirror
 * treats as "not a named control" and skips (so a plain container that happens
 * to get focus is not logged).
 */
export function controlRole(el: Element): string {
  const explicit = el.getAttribute("role");
  if (explicit && explicit.trim()) return explicit.trim();

  const tag = el.tagName.toLowerCase();
  if (tag === "button") return "button";
  if (tag === "a" && el.hasAttribute("href")) return "link";
  if (tag === "input") {
    const type = (el.getAttribute("type") ?? "text").toLowerCase();
    if (type === "button" || type === "submit" || type === "reset") return "button";
    if (type === "checkbox") return "checkbox";
    if (type === "radio") return "radio";
    return "textbox";
  }
  if (tag === "textarea") return "textbox";
  if (tag === "select") return "combobox";
  return "";
}

/**
 * Compose the `[focus]` line for an element, or `undefined` when the element is
 * not a named control (no accessible name, or no reportable role) and so should
 * not be logged. The shape is `<accessible name> (<role>[, n of m])`, where the
 * `, n of m` suffix is added only when the element carries both
 * `aria-posinset` and `aria-setsize` (the roving menu items do), matching what
 * a screen reader announces for a positioned item.
 */
export function focusLogLine(el: Element): string | undefined {
  const name = accessibleName(el);
  const role = controlRole(el);
  // A named control needs both a name and a role; otherwise it is page
  // furniture (e.g. the <body> on a programmatic blur) and is skipped.
  if (!name || !role) return undefined;

  const posAttr = el.getAttribute("aria-posinset");
  const sizeAttr = el.getAttribute("aria-setsize");
  const pos = posAttr ? Number.parseInt(posAttr, 10) : NaN;
  const size = sizeAttr ? Number.parseInt(sizeAttr, 10) : NaN;
  const position =
    Number.isFinite(pos) && Number.isFinite(size) ? `, ${pos} of ${size}` : "";

  return `${name} (${role}${position})`;
}

/** The dependencies the installer needs, injected so a unit test can drive it. */
export interface SpeechlogDeps {
  /** The document to listen on for focus changes (focusin). */
  doc: Document;
  /** The sink for the mirror lines; `console.log` in the browser. */
  log: (line: string) => void;
}

/** The observer-only handle returned by {@link installSpeechlog}. */
export interface Speechlog {
  /**
   * Mirror one live-region line as `[say] <text>`. Called from the same seam
   * that records the line on `window.__ghostlight`, so it sees exactly what the
   * live region received. Empty/whitespace-only lines are skipped (they are not
   * announced either).
   */
  say(text: string): void;
  /** Remove the focusin listener (for tests and tidiness). */
  dispose(): void;
}

/**
 * Install the console mirror: attach a `focusin` listener that logs every focus
 * change to a named control as `[focus] <name> (<role>[, n of m])`, and return
 * a handle whose `say(text)` mirrors a live-region line as `[say] <text>`.
 *
 * The caller only installs this when {@link isSpeechlogEnabled} is true, so the
 * listener and the mirror never exist in the default (no-param) run. The
 * listener is observer-only — it reads the focused element's accessibility
 * attributes and logs; it never calls `preventDefault`, moves focus, or writes
 * to the live region.
 */
export function installSpeechlog(deps: SpeechlogDeps): Speechlog {
  const { doc, log } = deps;

  const onFocusIn = (ev: FocusEvent): void => {
    const target = ev.target;
    if (!(target instanceof Element)) return;
    const line = focusLogLine(target);
    if (line) log(`[focus] ${line}`);
  };
  doc.addEventListener("focusin", onFocusIn, true);

  return {
    say(text: string): void {
      const line = text.trim();
      if (!line) return;
      log(`[say] ${line}`);
    },
    dispose(): void {
      doc.removeEventListener("focusin", onFocusIn, true);
    },
  };
}
