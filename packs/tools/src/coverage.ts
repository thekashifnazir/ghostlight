// Coverage checker: compare a pack to the census for the covered chapters.
// Reads data only; no network, no writes.
//
// Coverage reasons only over hotspot numbers, doors and the exit graph; it
// never inspects room `short`/`long` or object `description` text. So a
// description being a plain string or the variant object form (Describable)
// makes no difference here: a covered room or hotspot stays covered either way.
import type { Census, Pack } from "./types.js";

export interface CoverageGap {
  room: number;
  kind:
    | "missing-room"
    | "missing-hotspot"
    | "door-destination"
    | "stale-room"
    | "stale-hotspot"
    | "exit-graph"
    | "null-exit-no-note";
  message: string;
}

export interface CoverageResult {
  ok: boolean;
  gaps: CoverageGap[];
}

/** Chapters a census room belongs to. */
function censusRoomChapters(census: Census, room: number): number[] {
  return census.roomChapters[String(room)] ?? [];
}

export function checkCoverage(pack: Pack, census: Census): CoverageResult {
  const gaps: CoverageGap[] = [];
  const coveredChapters = new Set(pack.pack.coverage.chapters);

  // Census rooms that fall in a covered chapter.
  const censusRoomsInScope: number[] = [];
  for (const roomKey of Object.keys(census.rooms)) {
    const room = Number(roomKey);
    const chapters = censusRoomChapters(census, room);
    if (chapters.some((c) => coveredChapters.has(c))) {
      censusRoomsInScope.push(room);
    }
  }

  // 1 + 2 + 3 + 4: room, hotspot and door presence against the census.
  for (const room of censusRoomsInScope) {
    const roomKey = String(room);
    const censusRoom = census.rooms[roomKey]!;
    const packRoom = pack.rooms[roomKey];

    if (!packRoom) {
      gaps.push({
        room,
        kind: "missing-room",
        message: `census room ${room} (chapters ${censusRoomChapters(census, room).join(
          ", ",
        )}) has no pack entry`,
      });
      continue;
    }

    // Pack room must claim at least one covered chapter the census agrees with.
    const packClaims = new Set(packRoom.chapters);
    const censusChapters = censusRoomChapters(census, room);
    const sharedCovered = censusChapters.filter(
      (c) => coveredChapters.has(c) && packClaims.has(c),
    );
    if (sharedCovered.length === 0) {
      gaps.push({
        room,
        kind: "missing-room",
        message: `pack room ${room} chapters ${[...packClaims].join(
          ", ",
        )} do not include a covered census chapter (${censusChapters
          .filter((c) => coveredChapters.has(c))
          .join(", ")})`,
      });
    }

    const exitKeys = new Set(Object.keys(packRoom.exits));
    const objectKeys = new Set(Object.keys(packRoom.objects));
    const hasEntry = (num: number) =>
      exitKeys.has(String(num)) || objectKeys.has(String(num));

    for (const obj of censusRoom.objects) {
      const num = obj.num;
      const numKey = String(num);

      // Hotspot presence: every census number appears under exits or objects.
      if (!hasEntry(num)) {
        gaps.push({
          room,
          kind: "missing-hotspot",
          message: `room ${room}: census hotspot ${num} ("${obj.name}") has no entry in exits or objects`,
        });
        continue;
      }

      // Door destinations.
      if (obj.door === 1 && obj.toRoom !== undefined) {
        const exit = packRoom.exits[numKey];
        if (exit) {
          if (exit.to === null) {
            if (!exit.note) {
              gaps.push({
                room,
                kind: "null-exit-no-note",
                message: `room ${room}: exit ${num} has to:null but no note; census door leads to ${obj.toRoom}`,
              });
            }
          } else if (exit.to !== obj.toRoom && !exit.note) {
            gaps.push({
              room,
              kind: "door-destination",
              message: `room ${room}: exit ${num} to:${exit.to} disagrees with census toRoom ${obj.toRoom}, and has no note`,
            });
          }
        } else {
          // Covered under objects instead of exits (e.g. a door switched off in
          // this chapter). Allowed only when the object entry documents why.
          const object = packRoom.objects[numKey];
          if (!object?.note) {
            gaps.push({
              room,
              kind: "door-destination",
              message: `room ${room}: census door ${num} (to ${obj.toRoom}) is in objects, not exits, without a note explaining why it is not a live exit`,
            });
          }
        }
      }
    }

    // 5: stale hotspots the census does not have for this room.
    const censusNums = new Set(censusRoom.objects.map((o) => String(o.num)));
    for (const key of [...exitKeys, ...objectKeys]) {
      if (!censusNums.has(key)) {
        gaps.push({
          room,
          kind: "stale-hotspot",
          message: `room ${room}: pack hotspot ${key} is not in the census for this room`,
        });
      }
    }

    // 6: exit-graph agreement. A non-null destination must be reachable per
    // the census exit graph. A null destination must carry a note.
    const graph = new Set(census.exitGraph[roomKey] ?? []);
    for (const [exitNum, exit] of Object.entries(packRoom.exits)) {
      if (exit.to === null) {
        if (!exit.note) {
          gaps.push({
            room,
            kind: "null-exit-no-note",
            message: `room ${room}: exit ${exitNum} to:null must carry a note saying it ends a chapter or runs a scene`,
          });
        }
      } else if (!graph.has(exit.to) && !exit.note) {
        gaps.push({
          room,
          kind: "exit-graph",
          message: `room ${room}: exit ${exitNum} to ${exit.to} is not in the census exit graph (${[
            ...graph,
          ].join(", ")}) and has no note`,
        });
      }
    }
  }

  // 5 (rooms): stale pack rooms claiming a covered chapter the census lacks.
  for (const [roomKey, packRoom] of Object.entries(pack.rooms)) {
    const room = Number(roomKey);
    const claimsCovered = packRoom.chapters.some((c) => coveredChapters.has(c));
    if (!claimsCovered) continue;
    if (!census.rooms[roomKey]) {
      gaps.push({
        room,
        kind: "stale-room",
        message: `pack room ${room} claims a covered chapter but is not in the census`,
      });
    }
  }

  return { ok: gaps.length === 0, gaps };
}
