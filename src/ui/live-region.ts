// The one live region (Requirement 9, 7.1).
//
// A single polite role=log region carries every functional line as text.
// announce(text) replaces the region's content so the newest line interrupts
// rather than queuing behind earlier lines (R9.3, gotcha 5). The last line is
// kept for the repeat key (R7.1). A visible transcript mirror is updated too,
// for a sighted co-player; it is aria-hidden so it is not double-read.

import type { Hotspot } from "../model/hotspot-list.js";

/** How many earlier lines Shift+R can step back through. */
const HISTORY_LIMIT = 20;

export class LiveRegion {
  private readonly region: HTMLElement;
  private readonly transcript: HTMLElement | undefined;
  private last = "";
  /**
   * Earlier announced lines, newest first, capped at HISTORY_LIMIT. The current
   * line (`last`) is NOT in here; these are the lines announced before it, the
   * ones Shift+R walks back through.
   */
  private history: string[] = [];
  /**
   * How many steps back Shift+R has walked: 0 means "at the current line", 1
   * means history[0], and so on. Reset to 0 on any new line or any other key.
   */
  private backCursor = 0;

  /**
   * @param region the role=log element.
   * @param transcript optional visible mirror for sighted co-players.
   */
  constructor(region: HTMLElement, transcript?: HTMLElement) {
    this.region = region;
    this.transcript = transcript;
  }

  /**
   * Write one functional line. Replaces the region's content (interrupt, not
   * append) and remembers it as the last line for repeat.
   */
  announce(text: string): void {
    const line = text.trim();
    // Push the line being replaced onto the history (newest first), capped, so
    // Shift+R can walk back through the recent lines. The very first line has
    // no predecessor to record. A new line resets the back-step cursor.
    if (this.last) {
      this.history.unshift(this.last);
      if (this.history.length > HISTORY_LIMIT) this.history.length = HISTORY_LIMIT;
    }
    this.backCursor = 0;
    this.last = line;
    // Replacing textContent is what makes a polite region re-announce the new
    // line rather than appending and reading the whole history.
    this.region.textContent = line;
    if (this.transcript) {
      const p = this.transcript.ownerDocument.createElement("p");
      p.textContent = line;
      this.transcript.appendChild(p);
      this.transcript.scrollTop = this.transcript.scrollHeight;
    }
  }

  /** Re-announce the most recent line (the repeat key, R). Resets the back
   *  cursor so a following Shift+R starts from the most recent earlier line. */
  repeat(): void {
    this.backCursor = 0;
    if (this.last) {
      // Clear first so replacing with the same text still triggers a re-read.
      this.region.textContent = "";
      this.region.textContent = this.last;
    }
  }

  /**
   * Step one line further back through the announced history (Shift+R),
   * announcing it prefixed with "Earlier: " so the player knows it is a recall,
   * not a new event. Walks back up to HISTORY_LIMIT lines; once at the oldest
   * remembered line, further Shift+R re-announces that oldest line rather than
   * going silent. Does not disturb `last` (R still repeats the real last line)
   * and does not add the recalled line to the history. A no-op with no history.
   */
  stepBack(): void {
    if (this.history.length === 0) return;
    if (this.backCursor < this.history.length) this.backCursor += 1;
    const line = this.history[this.backCursor - 1];
    const recall = `Earlier: ${line}`;
    // Clear first so replacing with the same text (repeated Shift+R at the
    // oldest line) still triggers a re-read in the polite region.
    this.region.textContent = "";
    this.region.textContent = recall;
    if (this.transcript) {
      const p = this.transcript.ownerDocument.createElement("p");
      p.textContent = recall;
      this.transcript.appendChild(p);
      this.transcript.scrollTop = this.transcript.scrollHeight;
    }
  }

  /** Reset the Shift+R back-step cursor (called when any other key is pressed
   *  so the next Shift+R starts again from the most recent earlier line). */
  resetHistoryCursor(): void {
    this.backCursor = 0;
  }

  /** The last announced line, for tests and recaps. */
  lastLine(): string {
    return this.last;
  }

  /** Compose the "name, N of M" focus line (R2.4). */
  static focusLine(name: string, index: number, total: number): string {
    return `${name}, ${index + 1} of ${total}`;
  }

  /**
   * Compose the room-entry announcement (R8.1): name, short description, then
   * the things and people, then the exits. Undefined name/short fall back so
   * the room is still announced (R8.2).
   */
  static roomAnnouncement(args: {
    name: string | undefined;
    short: string | undefined;
    hotspots: Hotspot[];
  }): string {
    const { name, short, hotspots } = args;
    const parts: string[] = [];

    parts.push(name && name.length > 0 ? name : "A room");
    if (short && short.length > 0) parts.push(short);

    const things = hotspots.filter((h) => h.kind !== "exit").map((h) => h.name);
    const exits = hotspots.filter((h) => h.kind === "exit").map((h) => h.name);

    if (things.length > 0) {
      parts.push(`Here: ${list(things)}.`);
    } else {
      parts.push("Nothing here to use.");
    }

    if (exits.length > 0) {
      parts.push(`Exits: ${list(exits)}.`);
    } else {
      parts.push("No obvious way out.");
    }

    return parts.join(" ");
  }
}

/** Join names as a readable list: "a", "a and b", "a, b and c". */
function list(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
