// Typed plain-English parser (Requirement 12, pure, optional shortcut).
//
// Maps a typed phrase to an intent against ONLY the currently visible hotspots
// and carried items, so a phrase can never resolve to an absent thing (R12.3).
// Fixed phrases first, then verb phrases with on/with/in/to splitting item from
// target, then a bare name scored against the candidates. A tie returns
// ambiguous so the controller asks rather than guesses (R12.4); no candidate
// returns none with the present names listed (R12.5). The list stays the
// primary way to play; this is a shortcut.

import type { InvItem } from "../engine/adapter.js";
import type { Hotspot } from "./hotspot-list.js";

export type EngineVerb =
  | "look"
  | "take"
  | "open"
  | "close"
  | "talk"
  | "push"
  | "walk"
  | "use";

export type FixedAction =
  | "repeat"
  | "readRoom"
  | "help"
  | "inventory"
  | "skip"
  | "choices"
  | "cancel";

export type Match =
  | { kind: "hotspot"; hotspot: Hotspot; verb?: EngineVerb }
  | { kind: "item"; item: InvItem; verb?: EngineVerb }
  | { kind: "use"; item: InvItem; target: Hotspot | InvItem }
  | { kind: "useSelf"; item: InvItem }
  | { kind: "fixed"; action: FixedAction }
  | { kind: "choice"; n: number }
  | { kind: "ambiguous"; options: Hotspot[] }
  | { kind: "none"; present: string[] };

export interface ParseContext {
  inConversation: boolean;
  pendingChoice: boolean;
}

const VERB_WORDS: Record<string, EngineVerb> = {
  look: "look",
  examine: "look",
  inspect: "look",
  take: "take",
  get: "take",
  grab: "take",
  pick: "take",
  open: "open",
  close: "close",
  shut: "close",
  talk: "talk",
  speak: "talk",
  ask: "talk",
  push: "push",
  pull: "push",
  press: "push",
  move: "push",
  walk: "walk",
  go: "walk",
  enter: "walk",
  use: "use",
};

const SPLIT_WORDS = new Set(["on", "with", "in", "to", "into", "at", "onto"]);
const STOP_WORDS = new Set(["the", "a", "an", "to", "at", "of", "my", "some"]);

function normalise(phrase: string): string[] {
  return phrase
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0);
}

/** Score how well a candidate name matches the query words (word overlap). */
function score(candidateName: string, queryWords: string[]): number {
  const nameWords = new Set(
    candidateName
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => !STOP_WORDS.has(w)),
  );
  let s = 0;
  for (const q of queryWords) {
    if (STOP_WORDS.has(q)) continue;
    if (nameWords.has(q)) s += 2;
    else if ([...nameWords].some((n) => n.includes(q) || q.includes(n))) s += 1;
  }
  return s;
}

/** Find the best-scoring hotspot(s) for the query words. */
function bestHotspots(
  queryWords: string[],
  visible: Hotspot[],
): { top: Hotspot[]; score: number } {
  let best = 0;
  let top: Hotspot[] = [];
  for (const h of visible) {
    const s = score(h.name, queryWords);
    if (s > best) {
      best = s;
      top = [h];
    } else if (s === best && s > 0) {
      top.push(h);
    }
  }
  return { top: preferWholeName(top, queryWords), score: best };
}

/**
 * Break a tie in favour of the one name the query covers completely: "push
 * torch" means the torch, not "secret door to B.J.'s bedroom, opens after the
 * torch" (a tester, 16 Nov: chapter 6's torch couldn't be pushed by typing).
 * Still ambiguous when no single name is covered best.
 */
function preferWholeName(top: Hotspot[], queryWords: string[]): Hotspot[] {
  if (top.length < 2) return top;
  const q = new Set(queryWords.filter((w) => !STOP_WORDS.has(w)));
  const extra = (h: Hotspot): number =>
    normalise(h.name).filter((w) => !STOP_WORDS.has(w) && !q.has(w)).length;
  const least = Math.min(...top.map(extra));
  const best = top.filter((h) => extra(h) === least);
  return best.length === 1 ? best : top;
}

function bestItem(
  queryWords: string[],
  inventory: InvItem[],
): { item: InvItem | undefined; score: number } {
  let best = 0;
  let item: InvItem | undefined;
  for (const it of inventory) {
    const s = score(it.name, queryWords);
    if (s > best) {
      best = s;
      item = it;
    }
  }
  return { item, score: best };
}

const FIXED_PHRASES: { match: RegExp; action: FixedAction }[] = [
  { match: /^(help|controls|\?)$/, action: "help" },
  { match: /^(repeat|again|say again)$/, action: "repeat" },
  { match: /^(look|look around|where am i|read room|describe)$/, action: "readRoom" },
  { match: /^(inventory|inv|items|bag)$/, action: "inventory" },
  { match: /^(skip)$/, action: "skip" },
  { match: /^(choices|options)$/, action: "choices" },
  { match: /^(cancel|back|never ?mind|stop)$/, action: "cancel" },
];

/**
 * Parse a typed phrase into an intent. The candidate set is exactly the
 * currently visible hotspots and carried items, so a phrase can never resolve
 * to something not present.
 */
export function parsePhrase(
  phrase: string,
  visible: Hotspot[],
  inventory: InvItem[],
  context: ParseContext,
): Match {
  const raw = phrase.trim().toLowerCase();

  // In a conversation with a pending choice, a bare number picks a choice.
  if (context.pendingChoice) {
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n) && String(n) === raw) return { kind: "choice", n };
  }

  // Fixed phrases first.
  for (const { match, action } of FIXED_PHRASES) {
    if (match.test(raw)) return { kind: "fixed", action };
  }

  const words = normalise(phrase);
  if (words.length === 0) return { kind: "none", present: presentNames(visible) };

  // An item used on the hero: "use X on me", "wear X", "put on X",
  // "put X in my ears".
  const self = parseSelfUse(words, inventory);
  if (self) return { kind: "useSelf", item: self };

  // Verb phrase? Lead word maps to an engine verb.
  let verb: EngineVerb | undefined;
  let rest = words;
  if (VERB_WORDS[words[0]]) {
    verb = VERB_WORDS[words[0]];
    rest = words.slice(1);
  }

  // Split on on/with/in/to into item + target for a `use` phrase. Only take
  // this branch for an explicit `use` (or a verbless phrase), and only when the
  // left side names something after stop words. Otherwise a split word like
  // "at" or "to" in "look at bartender" or "talk to drunk" would wrongly be
  // read as a use phrase with an empty item; fall through to the hotspot/name
  // branch so the verb and target resolve normally.
  const splitAt = rest.findIndex((w) => SPLIT_WORDS.has(w));
  const left = splitAt >= 0 ? rest.slice(0, splitAt).filter((w) => !STOP_WORDS.has(w)) : [];
  if (splitAt >= 0 && (verb === "use" || verb === undefined) && left.length > 0) {
    // A split word can be part of the item's own name: "use scotch on the
    // rocks on Drascula" split at the first "on" read as the scotch used on
    // itself (a tester's run, 18 Nov). Try the later split words first, last
    // to first. One counts only when every word before it belongs to the
    // chosen item's name and it uses the item on something else. Otherwise
    // the first split stands, as before.
    for (let at = rest.length - 1; at > splitAt; at--) {
      if (!SPLIT_WORDS.has(rest[at])) continue;
      const later = useSplitAt(rest, at, visible, inventory);
      if (later && later.kind === "use" && later.target !== later.item) {
        const nameWords = new Set(normalise(later.item.name));
        const before = rest.slice(0, at).filter((w) => !STOP_WORDS.has(w));
        if (before.every((w) => nameWords.has(w))) return later;
      }
    }
    return useSplitAt(rest, splitAt, visible, inventory) ?? { kind: "none", present: presentNames(visible) };
  }

  // A bare name (optionally with a verb). Score against visible hotspots and
  // carried items; prefer a hotspot, fall back to an item.
  const nameWords = rest.filter((w) => !STOP_WORDS.has(w));
  const hotspotMatch = bestHotspots(nameWords, visible);
  const itemMatch = bestItem(nameWords, inventory);

  if (hotspotMatch.score > 0 && hotspotMatch.score >= itemMatch.score) {
    if (hotspotMatch.top.length === 1) {
      return { kind: "hotspot", hotspot: hotspotMatch.top[0], verb };
    }
    return { kind: "ambiguous", options: hotspotMatch.top };
  }
  if (itemMatch.item && itemMatch.score > 0) {
    return { kind: "item", item: itemMatch.item, verb };
  }

  return { kind: "none", present: presentNames(visible) };
}

/**
 * Read `rest` as "<item> <split word> <target>", split at index `at`. Returns
 * the use (on a visible hotspot or another carried item), a `none` when the
 * item is carried but the target is not found, or undefined when the left side
 * names no carried item.
 */
function useSplitAt(
  rest: string[],
  at: number,
  visible: Hotspot[],
  inventory: InvItem[],
): Match | undefined {
  const left = rest.slice(0, at).filter((w) => !STOP_WORDS.has(w));
  const right = rest.slice(at + 1).filter((w) => !STOP_WORDS.has(w));
  const itemMatch = bestItem(left, inventory);
  if (!itemMatch.item) return undefined;
  // Target is a visible hotspot or another carried item.
  const targetHotspot = bestHotspots(right, visible);
  const targetItem = bestItem(right, inventory);
  if (
    targetHotspot.score > 0 &&
    targetHotspot.score >= targetItem.score &&
    targetHotspot.top.length === 1
  ) {
    return { kind: "use", item: itemMatch.item, target: targetHotspot.top[0] };
  }
  if (targetItem.item && targetItem.score > 0) {
    return { kind: "use", item: itemMatch.item, target: targetItem.item };
  }
  return { kind: "none", present: presentNames(visible) };
}

const SELF_WORDS = new Set(["me", "myself", "yourself", "self", "hero"]);
const EAR_WORDS = new Set(["ear", "ears"]);

/**
 * Recognise an item used on the hero and return the carried item, else
 * undefined. Forms: "use X on me/myself/yourself/self/hero", "wear X",
 * "put on X", "put X in my ears" (and "put X on me").
 */
function parseSelfUse(words: string[], inventory: InvItem[]): InvItem | undefined {
  const lead = words[0];
  const content = (ws: string[]): string[] => ws.filter((w) => !STOP_WORDS.has(w));
  let itemWords: string[];

  if (lead === "wear") {
    itemWords = content(words.slice(1));
  } else if (lead === "put" && words[1] === "on") {
    itemWords = content(words.slice(2));
  } else if (lead === "use" || lead === "put") {
    const rest = words.slice(1);
    // The split before the hero, not the first one: an item's name can hold a
    // split word ("use scotch on the rocks on me").
    const toSelf = (at: number): boolean => {
      const right = content(rest.slice(at + 1));
      return (
        right.length === 1 &&
        (SELF_WORDS.has(right[0]) || (lead === "put" && EAR_WORDS.has(right[0])))
      );
    };
    const splitAt = rest.findIndex((w, i) => SPLIT_WORDS.has(w) && toSelf(i));
    if (splitAt < 0) return undefined;
    itemWords = content(rest.slice(0, splitAt));
  } else {
    return undefined;
  }

  if (itemWords.length === 0) return undefined;
  return bestItem(itemWords, inventory).item;
}

function presentNames(visible: Hotspot[]): string[] {
  return visible.map((h) => h.name);
}
