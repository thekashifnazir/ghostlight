import { describe, expect, it } from "vitest";
import { parseA11yLine } from "../src/engine/a11y-lines.js";

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
