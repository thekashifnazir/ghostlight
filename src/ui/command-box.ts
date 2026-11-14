// The typed command box (Requirement 12, tester feedback).
//
// A free key ("/") opens a labelled single-line text input. While open, Enter
// parses the typed phrase with the existing parser (model/parser.ts) against
// ONLY the currently visible hotspots and carried items, and sends the
// resolved command through the same adapter seam the rest of the page uses.
// Escape closes the box and returns focus to the list. Unknown or ambiguous
// phrases are never sent: they are announced in the live region (the closest
// options the parser offers), so a screen-reader user hears why nothing
// happened and what to try instead. The list stays the primary way to play;
// this is a keyboard shortcut layered on top.

import type { Command, InvItem } from "../engine/adapter.js";
import type { Hotspot } from "../model/hotspot-list.js";
import { HERO_TARGET } from "../model/hero.js";
import { type FixedAction, type Match, parsePhrase } from "../model/parser.js";

export interface CommandBoxCallbacks {
  /** Announce a functional line to the live region (polite role=log). */
  announce: (text: string) => void;
  /** Send a resolved command through the adapter seam (same path as the rest). */
  send: (cmd: Command) => void;
  /** The currently visible hotspots, for the parser's candidate set. */
  visible: () => Hotspot[];
  /** The carried items by id + pack name, for the parser's candidate set. */
  inventory: () => InvItem[];
  /** The parse context (conversation / pending choice), for fixed phrases. */
  parseContext: () => { inConversation: boolean; pendingChoice: boolean };
  /** Return focus to the hotspot list after the box closes. */
  returnToList: () => void;
  /** Run a fixed action the parser recognised (help, read room, inventory…). */
  runFixed: (action: FixedAction) => void;
  /**
   * Examine a hotspot through the SAME path the Down key uses (the controller's
   * examineHotspot): announce the pack's authored description and arm the
   * look-text suppression, then send `look`. A typed "look at <hotspot>" and
   * "examine <hotspot>" route here so they read the pack description instead of
   * the engine's useless stock "I CAN'T SEE ANYTHING IN PARTICULAR" reply,
   * matching what Down reads. A look at a carried ITEM is unaffected: it still
   * sends `look <id>` (items have their own look text, not this stock line).
   * Optional so a test that exercises only command resolution need not wire it;
   * when absent, a typed hotspot look falls back to sending a raw `look`.
   */
  examineHotspot?: (h: Hotspot) => void;
}

/**
 * The default engine verb for a bare hotspot match with no explicit verb: an
 * exit walks, a person is talked to, a plain object is interacted with (`take`,
 * which the engine routes to the object's own primary action). Mirrors the
 * controller's primaryVerb so a typed name behaves like Enter on the list.
 */
function defaultCommandFor(h: Hotspot): Command {
  if (h.kind === "exit") return { verb: "walk", target: h.num };
  if (h.kind === "npc") return { verb: "talk", target: h.num };
  return { verb: "take", target: h.num };
}

export class CommandBox {
  private readonly el: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly cb: CommandBoxCallbacks;
  private open = false;

  /**
   * @param el the container element (hidden until opened).
   * @param input the single-line text input inside it.
   */
  constructor(el: HTMLElement, input: HTMLInputElement, cb: CommandBoxCallbacks) {
    this.el = el;
    this.input = input;
    this.cb = cb;
    this.el.hidden = true;
  }

  isOpen(): boolean {
    return this.open;
  }

  /** Open the box, clear and focus the input, and announce how to use it. */
  openBox(): void {
    if (this.open) return;
    this.open = true;
    this.el.hidden = false;
    this.input.value = "";
    this.input.focus();
    this.cb.announce(
      "Command. Type what to do, for example talk to drunk, then press Enter. Escape closes.",
    );
  }

  /**
   * Handle one key while the box is open. Enter submits the typed phrase;
   * Escape closes without sending. Every other key is left for the native
   * input so the player can type. Returns true when the key was consumed, so
   * the page stops it from reaching the engine's own input (gotcha 7).
   */
  handleKey(key: string): boolean {
    if (!this.open) return false;
    if (key === "Enter") {
      this.submit();
      return true;
    }
    if (key === "Escape") {
      this.close();
      this.cb.returnToList();
      return true;
    }
    // Let the keystroke reach the input element (typing, editing). It must not
    // be consumed, or the character would never be entered.
    return false;
  }

  /** Parse the typed phrase and either send a command or announce near-misses. */
  private submit(): void {
    const phrase = this.input.value.trim();
    if (phrase.length === 0) {
      this.cb.announce("Type a command, or press Escape to close.");
      return;
    }

    const match = parsePhrase(
      phrase,
      this.cb.visible(),
      this.cb.inventory(),
      this.cb.parseContext(),
    );

    // A typed look/examine at a HOTSPOT ("look at bartender", "examine door")
    // goes through the same examine path the Down key uses, so it reads the
    // pack's authored description rather than the engine's stock "I can't see
    // anything in particular" reply. The parser maps look/examine/inspect to
    // the "look" verb, so this catches all three. A look at a carried ITEM is
    // NOT routed here — it falls through to commandFor, which sends `look <id>`.
    if (
      match.kind === "hotspot" &&
      match.verb === "look" &&
      this.cb.examineHotspot
    ) {
      this.close();
      this.cb.returnToList();
      this.cb.examineHotspot(match.hotspot);
      return;
    }

    const command = this.commandFor(match);
    if (command) {
      // A real command: close the box, return to the list, then send so the
      // engine's reply is the newest line the player hears.
      this.close();
      this.cb.returnToList();
      this.cb.send(command);
      return;
    }

    // A fixed action the parser recognised (help, read room, inventory, skip,
    // choices, repeat). Run it against the page's existing handlers; the box
    // closes so focus returns to the list and the action's own line is read.
    if (match.kind === "fixed") {
      this.close();
      this.cb.returnToList();
      this.cb.runFixed(match.action);
      return;
    }

    // Unknown or ambiguous: do NOT send. Announce the closest options the
    // parser offers and keep the box open so the player can refine the phrase.
    this.cb.announce(this.nearMissLine(match));
  }

  /** Map a parser Match to an engine Command, or undefined if it is not one. */
  private commandFor(match: Match): Command | undefined {
    switch (match.kind) {
      case "hotspot":
        // A `use` verb on a bare hotspot has no item to use, so fall back to
        // the hotspot's default interaction. Otherwise the parser's verb is a
        // single-target verb the engine takes directly.
        if (match.verb && match.verb !== "use") {
          return { verb: match.verb, target: match.hotspot.num };
        }
        return defaultCommandFor(match.hotspot);
      case "item":
        // A bare item name with a verb targets the item (e.g. look at an item);
        // without a verb, examine it. A `use` verb needs a target, which a bare
        // item phrase lacks, so it too falls back to examine. The engine takes
        // the item id as the target number.
        return {
          verb: match.verb && match.verb !== "use" ? match.verb : "look",
          target: match.item.id,
        };
      case "use": {
        // The target is a visible hotspot (keyed by engine hotspot number) or
        // another carried item (keyed by item id). The engine's `use` takes a
        // single target number in both cases.
        const target = "num" in match.target ? match.target.num : match.target.id;
        return { verb: "use", item: match.item.id, target };
      }
      case "useSelf":
        return { verb: "use", item: match.item.id, target: HERO_TARGET };
      case "choice":
        return { verb: "choose", n: match.n };
      default:
        return undefined;
    }
  }

  /**
   * Compose the near-miss line for an ambiguous or unknown phrase. Uses only
   * the candidate information the parser already returns: the tied options for
   * ambiguous, the present names for none.
   */
  private nearMissLine(match: Match): string {
    if (match.kind === "ambiguous") {
      return `Did you mean ${nameList(match.options.map((h) => h.name))}? Try a more specific name.`;
    }
    if (match.kind === "none") {
      if (match.present.length === 0) {
        return "I don't understand that, and there is nothing here to use.";
      }
      return `I don't understand that. Here: ${nameList(match.present)}.`;
    }
    return "I don't understand that.";
  }

  /** Close the box and hide it (no announcement; the caller decides the line). */
  private close(): void {
    this.open = false;
    this.el.hidden = true;
    this.input.value = "";
  }
}

/** Join names as a readable list: "a", "a or b", "a, b or c". */
function nameList(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} or ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`;
}
