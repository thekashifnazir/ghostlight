// Stage 4 (draft): a pure transform from per-room dumps to a draft file.
// No engine, no network: dumps in (packs/survey/<room>/), draft-<chapter>.json
// out. Spec: .kiro/specs/pack-coverage, Requirement 3.
//
// What this script does and does NOT do. The English prose of a room name and
// description is authored by Kiro reading the room's screenshot and dump; this
// script is the deterministic structure around those proposals. It:
//   - lists EVERY hotspot the dump reported and never invents one (3.6),
//   - splits hotspots into exits (door=1) and objects (door=0), keyed on the
//     engine's own hotspot numbers (3.5),
//   - carries each exit's census destination through to the draft (3.5),
//   - flags a Spanish/misspelt raw engine name for a textFix decision (3.3),
//   - sets `seen` and `provenance` from whether a screenshot was captured
//     (3.4, 3.4a),
//   - marks a room that already has an accepted pack entry `alreadyCovered` and
//     carries the existing text for comparison (3.7, 6.2),
//   - NEVER writes packs/drascula-en.json (3.2).
//
// The descriptive fields (room name/short/long, exit label, object name,
// object description) are emitted EMPTY for a not-yet-covered room, as slots
// for Kiro to fill from the screenshot. For an already-covered room they are
// pre-filled from the existing pack entry, so the default is to keep proven
// text. A reviewer never sees a fabricated description masquerading as authored.

import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

import type { Pack, Room } from "../tools/src/types.js";
import type {
  Draft,
  DraftExit,
  DraftObject,
  DraftRoom,
  Provenance,
  RoomDumpMeta,
  RoomDumpState,
  RoomDumpVerbs,
} from "./types.js";

/** Raw engine names that are Spanish or misspelt and want a textFix (gotcha 10). */
const FOREIGN_OR_MISSPELT = new Set([
  "SALIDA",
  "PUERTA",
  "ESCALERA",
  "ESCALERAS",
  "CAMINO",
  "HABITACIONES",
  "ARBOLITO",
  "PASADIZO",
  "LAPIDA",
  "AJO",
  "CHIMENEA",
  "GRILLETES",
  "CEMENTERY",
  "TAPESTRIE",
  "GRAFFITTI",
  "RETABLUM",
  "CYPRES",
  "DRASKIS",
]);

function reasonFor(raw: string): "spanish" | "spelling" {
  const spanish = new Set([
    "SALIDA",
    "PUERTA",
    "ESCALERA",
    "ESCALERAS",
    "CAMINO",
    "HABITACIONES",
    "ARBOLITO",
    "PASADIZO",
    "LAPIDA",
    "AJO",
    "CHIMENEA",
    "GRILLETES",
  ]);
  return spanish.has(raw) ? "spanish" : "spelling";
}

/** Read one room's three dump files; returns null if the room folder is absent. */
export function readRoomDump(
  surveyDir: string,
  room: number,
): { state: RoomDumpState; verbs: RoomDumpVerbs; meta: RoomDumpMeta } | null {
  const dir = join(surveyDir, String(room));
  const statePath = join(dir, "state.json");
  const verbsPath = join(dir, "verbs.json");
  const metaPath = join(dir, "meta.json");
  if (!existsSync(statePath) || !existsSync(metaPath)) return null;
  const state = JSON.parse(readFileSync(statePath, "utf8")) as RoomDumpState;
  const verbs = existsSync(verbsPath)
    ? (JSON.parse(readFileSync(verbsPath, "utf8")) as RoomDumpVerbs)
    : { room, probes: [] };
  const meta = JSON.parse(readFileSync(metaPath, "utf8")) as RoomDumpMeta;
  return { state, verbs, meta };
}

/** List the room-number subfolders present under a survey directory. */
export function surveyedRooms(surveyDir: string): number[] {
  if (!existsSync(surveyDir)) return [];
  return readdirSync(surveyDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^\d+$/.test(d.name))
    .map((d) => Number(d.name))
    .sort((a, b) => a - b);
}

/** Build one draft room from its dump + the existing pack entry (if any). */
export function draftRoom(
  state: RoomDumpState,
  verbs: RoomDumpVerbs,
  meta: RoomDumpMeta,
  existing: Room | undefined,
): DraftRoom {
  const provenance: Provenance = meta.screenshot
    ? "drafted by Kiro from a screenshot"
    : "drafted by Kiro from game text only";
  const alreadyCovered = existing !== undefined;

  const exits: Record<string, DraftExit> = {};
  const objects: Record<string, DraftObject> = {};

  // List EVERY dumped hotspot, split by the door flag. Never invent one.
  for (const h of state.hotspots) {
    const key = String(h.num);
    if (h.door === 1) {
      const to = h.toRoom ?? meta.hotspots.find((m) => m.num === h.num)?.toRoom ?? null;
      const prefill = existing?.exits?.[key];
      exits[key] = {
        label: prefill?.label ?? "",
        to: prefill ? prefill.to : (to ?? null),
        ...(prefill?.direction ? { direction: prefill.direction } : {}),
      };
    } else {
      const prefill = existing?.objects?.[key];
      const obj: DraftObject = {
        name: prefill?.name ?? "",
        type: prefill?.type ?? "object",
      };
      if (FOREIGN_OR_MISSPELT.has(h.rawName)) {
        obj.textFixSuggestion = { from: h.rawName, to: "", reason: reasonFor(h.rawName) };
        obj.note = `engine name "${h.rawName}" is ${reasonFor(h.rawName)}; propose a translated label`;
      }
      objects[key] = obj;
    }
  }

  return {
    room: state.room,
    chapters: existing?.chapters ?? [state.chapter],
    name: existing?.name ?? "",
    short: typeof existing?.short === "string" ? existing.short : "",
    long: typeof existing?.long === "string" ? existing.long : "",
    seen: existing?.seen ?? meta.screenshot,
    provenance,
    alreadyCovered,
    ...(existing
      ? { existing: { name: existing.name, short: existing.short, long: existing.long, seen: existing.seen } }
      : {}),
    exits,
    objects,
  };
}

/** The pure transform: rooms' dumps + pack + reached/unreached -> Draft. */
export function buildDraft(
  chapter: number,
  dumps: { state: RoomDumpState; verbs: RoomDumpVerbs; meta: RoomDumpMeta }[],
  pack: Pack,
  unreached: { room: number; reason: string }[],
): Draft {
  const rooms = dumps
    .slice()
    .sort((a, b) => a.state.room - b.state.room)
    .map((d) => draftRoom(d.state, d.verbs, d.meta, pack.rooms[String(d.state.room)]));
  return {
    chapter,
    generated: new Date().toISOString().slice(0, 10),
    rooms,
    unreached: unreached.slice().sort((a, b) => a.room - b.room),
  };
}

// --- CLI ------------------------------------------------------------------

function main(argv: string[]): number {
  const chapterArg = argv[0];
  if (!chapterArg) {
    console.error("Usage: tsx draft.ts <chapter> [surveyDir] [packPath] [outPath]");
    return 2;
  }
  const chapter = Number(chapterArg);
  const surveyDir = resolve(argv[1] ?? resolve(import.meta.dirname));
  const packPath = resolve(argv[2] ?? resolve(import.meta.dirname, "..", "drascula-en.json"));
  const outPath = resolve(argv[3] ?? join(surveyDir, `draft-${chapter}.json`));

  const pack = JSON.parse(readFileSync(packPath, "utf8")) as Pack;
  const rooms = surveyedRooms(surveyDir);
  const dumps = rooms
    .map((r) => readRoomDump(surveyDir, r))
    .filter((d): d is NonNullable<typeof d> => d !== null)
    .filter((d) => d.state.chapter === chapter);

  const draft = buildDraft(chapter, dumps, pack, []);
  writeFileSync(outPath, JSON.stringify(draft, null, 2) + "\n");
  console.log(`draft: wrote ${draft.rooms.length} room(s) to ${outPath}`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv.slice(2)));
}
