// Narration routing for the live region (web-player R3.4, R9.2).
//
// One place that decides WHAT reaches the live region from the engine's text
// and diff streams, so the live-engine run and the replay run narrate the same
// way. main.ts owns the model and UI; the Narrator owns three cross-cutting
// narration rules that the Crew survey of the live engine turned up:
//
//  1. Hover/name labels never reach the live region. The engine draws its own
//     name for whatever is under the (warped) cursor through centerText(),
//     which reaches the player as A11Y_TEXT events — never as the diff's
//     `said` — so the diff-path filter (suppressGenericLook) never sees them.
//     The Narrator drops a hover-name label ("BARTENDER", the hero's "hacker")
//     on EVERY text line: the list already names the focused thing, so a hover
//     echo is never functional text. During an examine it additionally drops
//     the generic "can't see anything in particular" reply, since examine has
//     already announced the pack's authored description.
//  2. "Nothing happened." is wrong after a look. A look that changes no state
//     is the normal case; examine already announced the pack description or the
//     engine's own look text, so the Narrator never says it for a look diff.
//  3. A line the engine reports twice — once as an A11Y_TEXT event when it is
//     drawn, then again in the following diff's `said` (engine/a11y.cpp onText
//     appends every drawn line to both streams) — must be announced once. The
//     Narrator remembers the last line it announced and drops a `said` repeat.

import type { Diff } from "../engine/adapter.js";
import type { Hotspot } from "../model/hotspot-list.js";
import {
  isExamineNoiseLine,
  isHoverNameLine,
  labelKey,
  suppressGenericLook,
} from "./controller.js";

/** The minimal live-region surface the Narrator writes to. */
export interface NarratorLive {
  announce(text: string): void;
}

export class Narrator {
  private readonly live: NarratorLive;
  /** True from the moment a look is issued until that look's diff arrives. */
  private examining = false;
  /** The last line announced, for de-duplicating a text event vs a diff said. */
  private lastAnnounced: string | undefined;
  /** Normalised hover-name labels for the current room (pack + engine names). */
  private roomLabels = new Set<string>();

  constructor(live: NarratorLive) {
    this.live = live;
  }

  /**
   * Refresh the room's hover-name labels: the pack's spoken names (from the
   * hotspot list) and the engine's raw object names. Called on every room or
   * same-room list change so an examine's hover echo is recognised wherever the
   * player is.
   */
  setRoomLabels(hotspots: readonly Hotspot[], engineNames: readonly string[]): void {
    const labels = new Set<string>();
    for (const h of hotspots) labels.add(labelKey(h.name));
    for (const name of engineNames) labels.add(labelKey(name));
    this.roomLabels = labels;
  }

  /**
   * Announce a line the player composes itself (room reading, hints, inventory
   * confirmations, the examine pack description). Keeps the de-dup memory in
   * step so a following identical `said` line is still dropped.
   */
  announce(text: string): void {
    this.live.announce(text);
    this.lastAnnounced = text.trim();
  }

  /** Arm the examine window before a look is sent. */
  beginExamine(): void {
    this.examining = true;
  }

  /**
   * Route one A11Y_TEXT line.
   *
   * Hover/name labels are dropped on EVERY line — the engine draws its own
   * name for whatever is under the warped cursor ("BARTENDER", or the hero's
   * "hacker" over a doorway), and that leaked into the live region even after
   * an examine had closed. The list already names the focused thing, so a
   * hover echo is never functional text. During an examine the generic
   * "can't see anything in particular" reply is dropped too, since examine
   * already announced the pack's authored description. Real text the engine
   * composes beyond a hover name (dialogue, narration, "HE WINKS AT YOU.") is
   * multi-word, never a label match, and is always announced.
   */
  text(line: string): void {
    if (this.examining) {
      if (isExamineNoiseLine(line, this.roomLabels)) return;
    } else if (isHoverNameLine(line, this.roomLabels)) {
      return;
    }
    this.announce(line);
  }

  /**
   * Announce a diff's spoken text. Closes the examine window on a look diff
   * (its text events have all arrived by now), applies the diff-path generic
   * look filter, and drops a `said` line equal to the last line already
   * announced (the text-vs-said duplicate). Returns whether this was a look
   * diff, so the caller can skip "Nothing happened." for it.
   */
  said(diff: Diff): boolean {
    const isLook = diff.cmd?.startsWith("look ") === true;
    if (isLook) this.examining = false;
    for (const line of suppressGenericLook(diff)) {
      if (line.text.trim() === this.lastAnnounced) continue;
      this.announce(line.text);
    }
    return isLook;
  }

  /**
   * Announce "Nothing happened." when an action changed no state and said
   * nothing — but never for a look (examine already spoke). `isLook` is the
   * value said() returned for this diff.
   */
  maybeNothingHappened(diff: Diff, isLook: boolean): void {
    if (diff.changed === false && !diff.said?.length && !isLook) {
      this.announce("Nothing happened.");
    }
  }
}
