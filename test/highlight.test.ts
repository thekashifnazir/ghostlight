// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Highlight } from "../src/ui/highlight.js";

/** Stub a canvas whose displayed size is exactly the engine resolution (1:1),
 *  so engine rect values map straight to pixels and assertions are simple. */
function setup(canvasRect: Partial<DOMRect> = {}) {
  document.body.innerHTML = `
    <div id="stage" style="position:relative">
      <canvas id="c" aria-hidden="true"></canvas>
      <div id="h" aria-hidden="true"></div>
    </div>`;
  const canvas = document.getElementById("c") as HTMLCanvasElement;
  const overlay = document.getElementById("h") as HTMLElement;

  const rect: DOMRect = {
    left: 0,
    top: 0,
    width: 320,
    height: 200,
    right: 320,
    bottom: 200,
    x: 0,
    y: 0,
    toJSON: () => ({}),
    ...canvasRect,
  } as DOMRect;
  vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue(rect);
  // Overlay has no offsetParent in jsdom; the class treats a non-HTMLElement
  // offsetParent as origin (0,0), which matches the stage at (0,0) here.
  return { canvas, overlay };
}

describe("Highlight", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("is hidden on construction", () => {
    const { canvas, overlay } = setup();
    new Highlight(overlay, canvas);
    expect(overlay.style.display).toBe("none");
  });

  it("positions over a visible hotspot rect (1:1 scale)", () => {
    const { canvas, overlay } = setup();
    const hl = new Highlight(overlay, canvas);
    hl.show([140, 54, 40, 57]);
    expect(overlay.style.display).toBe("block");
    expect(overlay.style.left).toBe("140px");
    expect(overlay.style.top).toBe("54px");
    expect(overlay.style.width).toBe("40px");
    expect(overlay.style.height).toBe("57px");
    expect(overlay.textContent).toBe(""); // on-screen: no direction marker
  });

  it("scales from engine coordinates to a larger canvas", () => {
    const { canvas, overlay } = setup({ width: 640, height: 400 });
    const hl = new Highlight(overlay, canvas);
    hl.show([10, 20, 30, 40]);
    // 2x scale on both axes.
    expect(overlay.style.left).toBe("20px");
    expect(overlay.style.top).toBe("40px");
    expect(overlay.style.width).toBe("60px");
    expect(overlay.style.height).toBe("80px");
  });

  it("clamps an off-right hotspot to the edge with a marker", () => {
    const { canvas, overlay } = setup();
    const hl = new Highlight(overlay, canvas);
    // x beyond the 320-wide canvas.
    hl.show([400, 50, 20, 20]);
    expect(overlay.style.display).toBe("block");
    expect(overlay.textContent).toBe("►");
    // Clamped so the box sits at the right edge.
    expect(overlay.style.left).toBe("300px");
  });

  it("hide() hides and clears the marker", () => {
    const { canvas, overlay } = setup();
    const hl = new Highlight(overlay, canvas);
    hl.show([10, 10, 5, 5]);
    hl.hide();
    expect(overlay.style.display).toBe("none");
    expect(overlay.textContent).toBe("");
  });
});
