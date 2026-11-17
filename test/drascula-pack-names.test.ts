// Drascula's spoken names have no commas (17 Nov, as BASS did in its round 13):
// the player reads a room as a comma-separated list, so a name like "door on the
// far left, to the bar" sounded like two things. Object names, exit labels and
// item names in packs/drascula-en.json are checked. Written before the renames.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const pack = JSON.parse(readFileSync(resolve(process.cwd(), "packs/drascula-en.json"), "utf8"));

function spokenNames(): string[] {
  const out: string[] = [];
  for (const [room, r] of Object.entries<any>(pack.rooms)) {
    for (const [num, o] of Object.entries<any>(r.objects ?? {})) if (o.name) out.push(`room ${room} object ${num}: ${o.name}`);
    for (const [num, e] of Object.entries<any>(r.exits ?? {})) if (e.label) out.push(`room ${room} exit ${num}: ${e.label}`);
  }
  for (const i of pack.items ?? []) if (i.name) out.push(`item ${i.id}: ${i.name}`);
  return out;
}

describe("Drascula spoken names", () => {
  it("have no commas, so a room's list reads one name per thing", () => {
    const names = spokenNames();
    expect(names.length).toBeGreaterThan(100);
    expect(names.filter((n) => n.slice(n.indexOf(": ") + 2).includes(","))).toEqual([]);
  });
});
