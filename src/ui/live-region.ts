// The one live region (Requirement 9, 7.1).
//
// A single polite role=log region carries every functional line as text.
// announce(text) replaces the region's content so the newest line interrupts
// rather than queuing behind earlier lines (R9.3, gotcha 5). The last line is
// kept for the repeat key (R7.1). A visible transcript mirror is updated too,
// for a sighted co-player; it is aria-hidden so it is not double-read.

import type { Hotspot } from "../model/hotspot-list.js";

export class LiveRegion {
  private readonly region: HTMLElement;
  private readonly transcript: HTMLElement | undefined;
  private last = "";

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

  /** Re-announce the most recent line (the repeat key). */
  repeat(): void {
    if (this.last) {
      // Clear first so replacing with the same text still triggers a re-read.
      this.region.textContent = "";
      this.region.textContent = this.last;
    }
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
