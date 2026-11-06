// List mode: focus and cycling (Requirements 1.5, 1.6, 1.7, 2).
//
// Holds the ordered hotspot list and the focused index. Left/Right move with
// wrap and announce "name, N of M". rebuild(list) replaces the list and focuses
// the first hotspot. Exactly one hotspot is focused while the list is non-empty;
// none when empty. This is pure state plus an announce callback, so it needs no
// DOM and is unit/property-testable directly.

import type { Hotspot } from "../model/hotspot-list.js";
import { LiveRegion } from "./live-region.js";

export class ListMode {
  private hotspots: Hotspot[] = [];
  private index = -1;
  private readonly announce: (text: string) => void;
  /** Called after any focus change (for the highlight and sonar). */
  private readonly onFocus: (hotspot: Hotspot | undefined) => void;

  constructor(
    announce: (text: string) => void,
    onFocus: (hotspot: Hotspot | undefined) => void = () => {},
  ) {
    this.announce = announce;
    this.onFocus = onFocus;
  }

  /** Replace the list and focus the first hotspot (R2.6, R1.5). */
  rebuild(hotspots: Hotspot[]): void {
    this.hotspots = hotspots;
    this.index = hotspots.length > 0 ? 0 : -1;
    this.onFocus(this.current());
  }

  /** Replace the list in place, keeping focus on the same hotspot number if it
   *  survives, else clamping into range (R1.6). Used for appeared/disappeared. */
  update(hotspots: Hotspot[]): void {
    const focusedNum = this.current()?.num;
    this.hotspots = hotspots;
    if (hotspots.length === 0) {
      this.index = -1;
    } else {
      const found =
        focusedNum == null
          ? -1
          : hotspots.findIndex((h) => h.num === focusedNum);
      this.index = found >= 0 ? found : 0;
    }
    this.onFocus(this.current());
  }

  /** The focused hotspot, or undefined when the list is empty. */
  current(): Hotspot | undefined {
    return this.index >= 0 ? this.hotspots[this.index] : undefined;
  }

  /** The focused index (−1 when empty). */
  focusedIndex(): number {
    return this.index;
  }

  /** The number of hotspots. */
  size(): number {
    return this.hotspots.length;
  }

  /** Move focus to the next hotspot, wrapping; announce it (R2.1, R2.3, R2.4). */
  next(): void {
    if (this.hotspots.length === 0) return;
    this.index = (this.index + 1) % this.hotspots.length;
    this.announceFocus();
  }

  /** Move focus to the previous hotspot, wrapping; announce it (R2.2, R2.3). */
  prev(): void {
    if (this.hotspots.length === 0) return;
    this.index =
      (this.index - 1 + this.hotspots.length) % this.hotspots.length;
    this.announceFocus();
  }

  /** Announce the focused hotspot and update dependents. */
  private announceFocus(): void {
    const h = this.current();
    if (!h) return;
    this.announce(LiveRegion.focusLine(h.name, this.index, this.hotspots.length));
    this.onFocus(h);
  }

  /** Announce the current focus without moving (used after rebuild). */
  announceCurrent(): void {
    this.announceFocus();
  }
}
