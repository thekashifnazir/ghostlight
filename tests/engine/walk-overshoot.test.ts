// Walk overshoot regression (chapter 4 room 22, found 10 Nov).
//
// Bug: `look 180` leaves the hero at (207,160), above room 22's walk area
// (y 165 to 181). The next walking command, `use 22 52` (coin on the magpie,
// walk-to point (190,177)), never returned: the engine sat in walkToPoint()
// for ever, and the busy watchdog could not free it.
//
// Root cause: the engine ends a walk only through exact-hit windows at the top
// of moveCharacters() (actors.cpp). A sideways walk stops when the hero's
// centre is within STEP_X - 1 px of the target; there is no "already past it"
// test. From (207,160) startWalking() picks a sideways walk with stepY 8
// (dx == dy == 17), and on the third step the feet cross scale row 176, the
// sprite width grows 38 -> 39, and increaseFrameNum()'s perspective re-scale
// (curX += curWidth - newWidth) adds one more pixel, so the centre goes
// 207, 199, 191, 182 and misses the window [183,190]. It never stops.
//
// Fix (engine/a11y.cpp): A11yLayer::walkOvershot() + checkWalkOvershoot(),
// armed only around the a11y layer's own walkToPoint() calls. Once the walk is
// past its window it ends it and places the hero on the target, the way the
// engine's own track-1 arrival does.
//
// This file ports the engine's walk maths (startWalking, quadrant_*,
// moveCharacters, increaseFrameNum, enterRoom's factor_red table) for the
// non-chapter-2 path and the C++ walkOvershot() line for line, so the bug and
// the "no change for walks that already stop" rule can be checked without a
// rebuild. Keep the ports in lockstep with the C++.

import { describe, expect, it } from "vitest";

const STEP_X = 8;
const STEP_Y = 3;
const CHARACTER_WIDTH = 43;
const CHARACTER_HEIGHT = 70;

// Room 22 from 22.ALD (reference/census.json).
const ROOM22 = {
  walkRect: { left: 21, top: 165, right: 257, bottom: 181 },
  upperLimit: 90,
  lowerLimit: 93,
  walkTo: {
    exit102: [154, 199],
    branch140: [170, 163],
    magpie52: [190, 177],
    key180: [207, 160],
  } as Record<string, [number, number]>,
};

/** enterRoom()'s perspective table (rooms.cpp), non-chapter-2 path. */
function factorTable(r: typeof ROOM22): number[] {
  const f = new Array<number>(202).fill(0);
  const { top, bottom } = r.walkRect;
  for (let l = 0; l <= top; l++) f[l] = r.upperLimit;
  for (let l = top; l <= 201; l++) f[l] = r.lowerLimit;
  const chiquez = (r.lowerLimit - r.upperLimit) / (bottom - top);
  let pequegnez = 0;
  for (let l = top; l <= bottom; l++) {
    f[l] = Math.trunc(r.upperLimit + pequegnez);
    pequegnez += chiquez;
  }
  return f;
}

const FACTOR = factorTable(ROOM22);
// The C array is factor_red[202]; past that the engine reads out of bounds.
// The simulation clamps, which only matters for walks that have already run off.
const factorAt = (y: number) => FACTOR[Math.max(0, Math.min(201, y))];

/** Transliteration of A11yLayer::walkOvershot (engine/a11y.cpp). */
function walkOvershot(
  chapter: number,
  track: number,
  heroLeft: number,
  heroWidth: number,
  feetY: number,
  targetX: number,
  targetY: number,
): boolean {
  if (track === 0 || track === 1) {
    let x: number;
    if (chapter === 2) x = track === 0 ? heroLeft : heroLeft + heroWidth;
    else x = heroLeft + Math.trunc(heroWidth / 2);
    if (track === 0) return x < targetX - (STEP_X - 1);
    return x > targetX + (STEP_X - 1);
  }
  if (track === 2) return feetY < targetY - (STEP_Y - 1);
  if (track === 3) return feetY > targetY + (STEP_Y - 1);
  return false;
}

interface Hero {
  curX: number;
  curY: number;
  curWidth: number;
  curHeight: number;
}

interface WalkResult {
  stopped: boolean;
  frames: number;
  guardFired: boolean;
  hero: Hero;
  feet: [number, number];
}

/** Place the hero by foot point, as enterRoom() sizes it for that row. */
function heroAt(fx: number, fy: number): Hero {
  const curWidth = Math.trunc((CHARACTER_WIDTH * factorAt(fy)) / 100);
  const curHeight = Math.trunc((CHARACTER_HEIGHT * factorAt(fy)) / 100);
  return { curX: fx - Math.trunc(curWidth / 2), curY: fy - curHeight, curWidth, curHeight };
}

/**
 * walkToPoint() for chapters 1, 3, 4 (non-chapter-2 maths, hero visible), one
 * loop iteration per frame. Every frame after the first is at least 90 ms
 * (pause(3)), past increaseFrameNum()'s 60 ms gate, so each frame after the
 * first takes one step; the first frame runs straight after startWalking().
 */
function simulateWalk(start: Hero, roomX: number, roomY: number, guard: boolean, maxFrames = 200): WalkResult {
  let { curX, curY, curWidth, curHeight } = start;
  let stepX = STEP_X;
  let stepY = STEP_Y;
  let track = 0;
  let dir = 0; // 0 up, 1 down, 2 left, 3 right (kDirection*)
  let moved = true;
  let guardFired = false;

  // startWalking()
  const centre = () => curX + Math.trunc(curWidth / 2);
  const feet = () => curY + curHeight;
  if (roomX < centre() && roomY <= feet()) {
    const dX = centre() - roomX, dY = feet() - roomY; // quadrant_1
    if (dX < dY) { dir = 0; track = 2; stepX = Math.trunc(dX / (dY / STEP_Y)); }
    else { dir = 0; track = 0; stepY = Math.trunc(dY / (dX / STEP_X)); }
  } else if (roomX < centre() && roomY > feet()) {
    const dX = centre() - roomX, dY = roomY - feet(); // quadrant_3
    if (dX < dY) { dir = 2; track = 3; stepX = Math.trunc(dX / (dY / STEP_Y)); }
    else { dir = 2; track = 0; stepY = Math.trunc(dY / (dX / STEP_X)); }
  } else if (roomX > centre() && roomY <= feet()) {
    const dX = Math.abs(centre() - roomX), dY = feet() - roomY; // quadrant_2
    if (dX < dY) { dir = 3; track = 2; stepX = Math.trunc(dX / (dY / STEP_Y)); }
    else { dir = 3; track = 1; stepY = Math.trunc(dY / (dX / STEP_X)); }
  } else if (roomX > centre() && roomY > feet()) {
    const dX = Math.abs(centre() - roomX), dY = roomY - feet(); // quadrant_4
    if (dX < dY) { dir = 1; track = 3; stepX = Math.trunc(dX / (dY / STEP_Y)); }
    else { dir = 1; track = 1; stepY = Math.trunc(dY / (dX / STEP_X)); }
  } else {
    moved = false;
  }

  let frame = 0;
  while (moved && frame < maxFrames) {
    // moveCharacters(): stop tests first.
    if (moved && stepX === STEP_X) {
      for (let r = 0; r < stepX; r++) {
        if (track === 0 && roomX - r === centre()) { moved = false; stepX = STEP_X; stepY = STEP_Y; }
        if (track === 1 && roomX + r === centre()) {
          moved = false; stepX = STEP_X; stepY = STEP_Y;
          curX = roomX - Math.trunc(curWidth / 2);
          curY = roomY - curHeight;
        }
      }
    }
    if (moved && stepY === STEP_Y) {
      for (let r = 0; r < stepY; r++) {
        if (track === 2 && roomY - r === feet()) { moved = false; stepX = STEP_X; stepY = STEP_Y; }
        if (track === 3 && roomY + r === feet()) { moved = false; stepX = STEP_X; stepY = STEP_Y; }
      }
    }
    if (moved) {
      // reduce_hare_chico() sizes from the pre-step feet row.
      const f = factorAt(feet());
      const newWidth = Math.trunc((CHARACTER_WIDTH * f) / 100);
      const newHeight = Math.trunc((CHARACTER_HEIGHT * f) / 100);
      // increaseFrameNum()
      if (frame > 0) {
        if (dir === 0) { curX -= stepX; curY -= stepY; }
        else if (dir === 3) { curX += stepX; curY -= stepY; }
        else if (dir === 1) { curX += stepX; curY += stepY; }
        else if (dir === 2) { curX -= stepX; curY += stepY; }
      }
      curY += curHeight - newHeight;
      curX += curWidth - newWidth;
      curHeight = newHeight;
      curWidth = newWidth;
    }
    // updateEvents() -> A11yLayer::onUpdateEvents() -> checkWalkOvershoot()
    if (guard && moved && walkOvershot(4, track, curX, curWidth, feet(), roomX, roomY)) {
      moved = false;
      stepX = STEP_X;
      stepY = STEP_Y;
      curX = roomX - Math.trunc(curWidth / 2);
      curY = roomY - curHeight;
      guardFired = true;
    }
    frame++;
  }
  return {
    stopped: !moved,
    frames: frame,
    guardFired,
    hero: { curX, curY, curWidth, curHeight },
    feet: [curX + Math.trunc(curWidth / 2), curY + curHeight],
  };
}

describe("walk overshoot guard (ch4 room 22)", () => {
  it("reproduces the hang: (207,160) to the magpie never stops unguarded", () => {
    const r = simulateWalk(heroAt(207, 160), 190, 177, false);
    expect(r.stopped).toBe(false);
  });

  it("the guard ends that walk on the magpie point", () => {
    const r = simulateWalk(heroAt(207, 160), 190, 177, true);
    expect(r.stopped).toBe(true);
    expect(r.guardFired).toBe(true);
    expect(r.feet).toEqual([190, 177]);
  });

  it("snapping the hero into the walk area first would NOT have fixed it", () => {
    // (207,165) is the nearest in-area point; it still overshoots the magpie.
    const r = simulateWalk(heroAt(207, 165), 190, 177, false);
    expect(r.stopped).toBe(false);
  });

  it("never changes a walk that stops by itself (in-area starts, room 22)", () => {
    const { left, top, right, bottom } = ROOM22.walkRect;
    const targets: [number, number][] = [...Object.values(ROOM22.walkTo)];
    for (let tx = left; tx <= right; tx += 13)
      for (let ty = top; ty <= bottom; ty += 4) targets.push([tx, ty]);

    let checked = 0;
    const mismatches: string[] = [];
    for (let sx = left; sx <= right; sx++) {
      for (let sy = top; sy <= bottom; sy++) {
        const start = heroAt(sx, sy);
        for (const [tx, ty] of targets) {
          const plain = simulateWalk(start, tx, ty, false);
          if (!plain.stopped) continue; // a hang either way; the guard may end it
          const guarded = simulateWalk(start, tx, ty, true);
          if (
            guarded.guardFired ||
            guarded.frames !== plain.frames ||
            JSON.stringify(guarded.hero) !== JSON.stringify(plain.hero)
          ) {
            mismatches.push(`(${sx},${sy}) -> (${tx},${ty})`);
          }
          checked++;
        }
      }
    }
    expect(mismatches).toEqual([]);
    expect(checked).toBeGreaterThan(0);
  });

  it("every walk the guard ends, ends on its target point", () => {
    const { left, right, bottom } = ROOM22.walkRect;
    const bad: string[] = [];
    for (let sx = left; sx <= right; sx += 3) {
      for (let sy = 155; sy <= bottom; sy++) {
        for (const [tx, ty] of Object.values(ROOM22.walkTo)) {
          const guarded = simulateWalk(heroAt(sx, sy), tx, ty, true);
          if (!guarded.stopped || (guarded.guardFired && (guarded.feet[0] !== tx || guarded.feet[1] !== ty)))
            bad.push(`(${sx},${sy}) -> (${tx},${ty})`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});
