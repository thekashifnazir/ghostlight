import { describe, expect, it } from "vitest";
import { parseA11yLine, splitA11yLines } from "../src/engine/a11y-lines.js";

describe("parseA11yLine", () => {
  it("parses an A11Y room-state line into a room event", () => {
    const line =
      'A11Y {"chapter":1,"room":62,"hero":{"x":171,"y":158},' +
      '"objects":[{"num":52,"name":"BARTENDER","rect":[10,20,30,40],' +
      '"walkTo":[15,55],"visible":true,"door":false},' +
      '{"num":105,"name":"DOOR","rect":[0,0,10,10],"walkTo":[5,10],' +
      '"visible":true,"door":true,"toRoom":63}],' +
      '"inventory":[28],"flags":[0,0,0]}';
    const ev = parseA11yLine(line);
    expect(ev).not.toBeNull();
    if (ev?.type !== "room") throw new Error("expected room event");
    expect(ev.state.chapter).toBe(1);
    expect(ev.state.room).toBe(62);
    expect(ev.state.hero).toEqual({ x: 171, y: 158 });
    expect(ev.state.objects).toHaveLength(2);
    expect(ev.state.objects[1].toRoom).toBe(63);
    expect(ev.state.inventory).toEqual([28]);
    expect(ev.state.flags).toEqual([0, 0, 0]);
  });

  it("parses an A11Y_DIFF line into a diff event", () => {
    const line =
      'A11Y_DIFF {"cmd":"take 7","invAdded":[{"id":7,"name":"cigarettes"}],' +
      '"flags":{"19":[0,1]},"said":[{"color":"yellow","text":"GOT IT"}],' +
      '"changed":true}';
    const ev = parseA11yLine(line);
    expect(ev?.type).toBe("diff");
    if (ev?.type !== "diff") throw new Error("type");
    expect(ev.diff.cmd).toBe("take 7");
    expect(ev.diff.invAdded).toEqual([{ id: 7, name: "cigarettes" }]);
    expect(ev.diff.flags).toEqual({ "19": [0, 1] });
    expect(ev.diff.said).toEqual([{ color: "yellow", text: "GOT IT" }]);
    expect(ev.diff.changed).toBe(true);
  });

  it("parses an A11Y_TEXT line as a plain line", () => {
    const ev = parseA11yLine("A11Y_TEXT I CAN'T DO THAT");
    expect(ev).toEqual({ type: "text", line: "I CAN'T DO THAT" });
  });

  it("parses an A11Y_VTEXT line as a voiced text event", () => {
    const ev = parseA11yLine("A11Y_VTEXT WHAT DO YOU WANT?");
    expect(ev).toEqual({ type: "text", line: "WHAT DO YOU WANT?", voiced: true });
  });

  it("still parses A11Y_VTEXT after a WARNING: wrap", () => {
    expect(parseA11yLine("WARNING: A11Y_VTEXT HELLO!")).toEqual({
      type: "text",
      line: "HELLO",
      voiced: true,
    });
  });

  it("returns null for an empty A11Y_VTEXT payload", () => {
    expect(parseA11yLine("A11Y_VTEXT ")).toBeNull();
  });

  it("parses the voiced flag on a diff said entry", () => {
    const line =
      'A11Y_DIFF {"cmd":"talk 52","said":[' +
      '{"color":"white","text":"PLAIN"},' +
      '{"color":"white","text":"SPOKEN","voiced":true}],"changed":false}';
    const ev = parseA11yLine(line);
    if (ev?.type !== "diff") throw new Error("expected diff");
    expect(ev.diff.said).toEqual([
      { color: "white", text: "PLAIN" },
      { color: "white", text: "SPOKEN", voiced: true },
    ]);
  });

  it("parses an A11Y_CHOICES line into choices", () => {
    const line =
      'A11Y_CHOICES {"choices":[{"n":1,"text":"Ask about the key","used":false},' +
      '{"n":4,"text":"Goodbye","ends":true}]}';
    const ev = parseA11yLine(line);
    expect(ev?.type).toBe("choices");
    if (ev?.type !== "choices") throw new Error("type");
    expect(ev.choices).toHaveLength(2);
    expect(ev.choices[1].ends).toBe(true);
  });

  it("parses an A11Y_INV line into items", () => {
    const line =
      'A11Y_INV {"items":[{"id":28,"name":"phone","look":"THE MOBILE PHONE"}]}';
    const ev = parseA11yLine(line);
    expect(ev?.type).toBe("inv");
    if (ev?.type !== "inv") throw new Error("type");
    expect(ev.items[0]).toEqual({
      id: 28,
      name: "phone",
      look: "THE MOBILE PHONE",
    });
  });

  it("parses an A11Y_CMD line", () => {
    expect(parseA11yLine("A11Y_CMD look 52")).toEqual({
      type: "cmd",
      cmd: "look 52",
    });
  });

  it("parses the engine's A11Y_PHASE control/busy/choice lines", () => {
    expect(parseA11yLine("A11Y_PHASE control")).toEqual({
      type: "phase",
      phase: "control",
    });
    expect(parseA11yLine("A11Y_PHASE busy")).toEqual({
      type: "phase",
      phase: "busy",
    });
    expect(parseA11yLine("A11Y_PHASE choice")).toEqual({
      type: "phase",
      phase: "choice",
    });
  });

  it("still parses A11Y_PHASE after a WARNING: wrap", () => {
    expect(parseA11yLine("WARNING: A11Y_PHASE control!")).toEqual({
      type: "phase",
      phase: "control",
    });
  });

  it("returns null for an unknown or empty A11Y_PHASE word", () => {
    expect(parseA11yLine("A11Y_PHASE")).toBeNull();
    expect(parseA11yLine("A11Y_PHASE ")).toBeNull();
    expect(parseA11yLine("A11Y_PHASE paused")).toBeNull();
    expect(parseA11yLine("A11Y_PHASE CONTROL")).toBeNull(); // case-sensitive
  });

  it("parses an A11Y_ERR line", () => {
    expect(parseA11yLine("A11Y_ERR no handler for command: fly")).toEqual({
      type: "error",
      message: "no handler for command: fly",
    });
  });

  it("parses the engine's JSON A11Y_SAVED line into a slot number", () => {
    // The real engine emits the JSON form (engine/a11y.cpp dispatchSave).
    expect(
      parseA11yLine('A11Y_SAVED {"slot":1,"chapter":1,"room":62}'),
    ).toEqual({ type: "saved", slot: 1 });
    expect(
      parseA11yLine('A11Y_SAVED {"slot":9,"chapter":2,"room":14}'),
    ).toEqual({ type: "saved", slot: 9 });
  });

  it("still accepts a bare A11Y_SAVED slot number", () => {
    expect(parseA11yLine("A11Y_SAVED 3")).toEqual({ type: "saved", slot: 3 });
  });

  it("returns null for an A11Y_SAVED JSON payload with no numeric slot", () => {
    expect(parseA11yLine('A11Y_SAVED {"chapter":1}')).toBeNull();
    expect(parseA11yLine("A11Y_SAVED {bad json")).toBeNull();
  });

  it("strips a WARNING: prefix and trailing ! that ScummVM may add", () => {
    const ev = parseA11yLine('WARNING: A11Y_CMD skip!');
    expect(ev).toEqual({ type: "cmd", cmd: "skip" });
  });

  it("ignores A11Y_HOVER and A11Y_SAY", () => {
    expect(parseA11yLine("A11Y_HOVER bartender")).toBeNull();
    expect(parseA11yLine("A11Y_SAY hello there")).toBeNull();
  });

  it("returns null for non-A11Y lines", () => {
    expect(parseA11yLine("")).toBeNull();
    expect(parseA11yLine("some unrelated debug line")).toBeNull();
    expect(parseA11yLine("DEBUG: loading room 62")).toBeNull();
  });

  it("returns null for malformed JSON payloads", () => {
    expect(parseA11yLine("A11Y {not valid json}")).toBeNull();
    expect(parseA11yLine("A11Y_DIFF {")).toBeNull();
    expect(parseA11yLine("A11Y_CHOICES {}")).toBeNull();
    expect(parseA11yLine("A11Y_INV {}")).toBeNull();
    expect(parseA11yLine("A11Y_SAVED notanumber")).toBeNull();
  });
});

describe("splitA11yLines", () => {
  // The two glued examples proven on the live site: a room-changing A11Y_DIFF
  // whose payload ends in `}` immediately followed by the next A11Y line, with
  // no newline between them. Unsplit, JSON.parse of the diff fails and the whole
  // line is dropped, so the room change is lost.
  const DIFF =
    'A11Y_DIFF {"cmd":"walk 159","room":[14,12],"changed":true}';
  const ROOM =
    'A11Y {"chapter":2,"room":12,"hero":{"x":100,"y":150},' +
    '"objects":[],"inventory":[],"flags":[0]}';

  it("splits a diff glued to a following A11Y_PHASE line (live-site symptom)", () => {
    const glued = DIFF + "A11Y_PHASE control";
    expect(splitA11yLines(glued)).toEqual([DIFF, "A11Y_PHASE control"]);
    // Each half now parses: the diff carries the room change, the phase settles.
    const [diff, phase] = splitA11yLines(glued).map(parseA11yLine);
    expect(diff?.type).toBe("diff");
    expect(phase).toEqual({ type: "phase", phase: "control" });
  });

  it("splits a diff glued to a following A11Y room-state line (current main)", () => {
    const glued = DIFF + ROOM;
    expect(splitA11yLines(glued)).toEqual([DIFF, ROOM]);
    const [diff, room] = splitA11yLines(glued).map(parseA11yLine);
    expect(diff?.type).toBe("diff");
    expect(room?.type).toBe("room");
  });

  it("splits a payload ending in ']' glued to the next line", () => {
    const choices = 'A11Y_CHOICES {"choices":[]}';
    // A payload whose JSON ends in a bracket `]` is also a valid split boundary.
    const glued = 'A11Y_INV {"items":[]}' + choices;
    expect(splitA11yLines(glued)).toEqual(['A11Y_INV {"items":[]}', choices]);
  });

  it("returns a single normal line unchanged", () => {
    expect(splitA11yLines(DIFF)).toEqual([DIFF]);
  });

  it("splits multiple newline-separated lines (no gluing)", () => {
    const blob = ["A11Y_CMD walk 159", DIFF, "A11Y_PHASE control"].join("\n");
    expect(splitA11yLines(blob)).toEqual([
      "A11Y_CMD walk 159",
      DIFF,
      "A11Y_PHASE control",
    ]);
  });

  it("handles a mix of newlines and gluing in one string", () => {
    const blob = "A11Y_CMD walk 159\n" + DIFF + "A11Y_PHASE control";
    expect(splitA11yLines(blob)).toEqual([
      "A11Y_CMD walk 159",
      DIFF,
      "A11Y_PHASE control",
    ]);
  });

  it("never splits inside A11Y_TEXT text that merely contains 'A11Y'", () => {
    // The letters A11Y appear mid-sentence, not after a JSON payload boundary,
    // so the line must stay whole and parse as one text event.
    const text = "A11Y_TEXT the sign reads A11Y is not a command here";
    expect(splitA11yLines(text)).toEqual([text]);
    expect(parseA11yLine(text)).toEqual({
      type: "text",
      line: "the sign reads A11Y is not a command here",
    });
  });

  it("does not split an A11Y_TEXT line that happens to contain '}A11Y' mid-text", () => {
    // Even a `}` immediately before the letters A11Y stays whole UNLESS what
    // follows is a real prefix token with a space/end boundary. "A11Yish" is not
    // a known prefix, so no split.
    const text = "A11Y_TEXT he muttered }A11Yish nonsense";
    expect(splitA11yLines(text)).toEqual([text]);
  });
});
