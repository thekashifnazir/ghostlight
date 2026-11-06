// Canvas highlight (Requirement 5).
//
// A decorative overlay rectangle drawn over the focused hotspot, for a sighted
// co-player. It is aria-hidden and carries no functional information that is
// not already in the live region (R5.4). show(rect) positions it over the
// focused hotspot (scaled from engine coordinates to the canvas's displayed
// size); when the rect is off the visible area it is clamped to the edge with a
// direction marker so a co-player can still tell where focus is (R5.3);
// hide() when the list is empty (R5.5).

/** The engine's internal resolution; rects are in this space. */
const ENGINE_WIDTH = 320;
const ENGINE_HEIGHT = 200;

export class Highlight {
  private readonly overlay: HTMLElement;
  private readonly canvas: HTMLElement;

  constructor(overlay: HTMLElement, canvas: HTMLElement) {
    this.overlay = overlay;
    this.canvas = canvas;
    this.hide();
  }

  /**
   * Position the highlight over a hotspot's engine-space rect [x, y, w, h],
   * scaling to the canvas's displayed size. Clamps to the canvas edge with a
   * direction marker when the rect falls outside the visible area.
   */
  show(rect: [number, number, number, number]): void {
    const bounds = this.canvas.getBoundingClientRect();
    const parentBounds =
      this.overlay.offsetParent instanceof HTMLElement
        ? this.overlay.offsetParent.getBoundingClientRect()
        : { left: 0, top: 0 };

    const scaleX = bounds.width / ENGINE_WIDTH;
    const scaleY = bounds.height / ENGINE_HEIGHT;

    // Canvas-local pixel rect.
    let x = rect[0] * scaleX;
    let y = rect[1] * scaleY;
    let w = rect[2] * scaleX;
    let h = rect[3] * scaleY;

    // Clamp to the visible canvas area, noting the direction it was pushed from
    // so a co-player can see focus is off to that side (R5.3).
    const offLeft = x + w < 0;
    const offRight = x > bounds.width;
    const offTop = y + h < 0;
    const offBottom = y > bounds.height;

    let marker = "";
    if (offLeft) {
      x = 0;
      marker = "◄";
    } else if (offRight) {
      x = bounds.width - w;
      marker = "►";
    }
    if (offTop) {
      y = 0;
      marker = marker ? marker : "▲";
    } else if (offBottom) {
      y = bounds.height - h;
      marker = marker ? marker : "▼";
    }

    // Position relative to the overlay's offset parent (the stage), offset by
    // where the canvas sits within it.
    const canvasOffsetX = bounds.left - parentBounds.left;
    const canvasOffsetY = bounds.top - parentBounds.top;

    this.overlay.style.display = "block";
    this.overlay.style.left = `${canvasOffsetX + x}px`;
    this.overlay.style.top = `${canvasOffsetY + y}px`;
    this.overlay.style.width = `${Math.max(w, 2)}px`;
    this.overlay.style.height = `${Math.max(h, 2)}px`;
    // The marker is decorative; it is in an aria-hidden element so it is never
    // read. It only helps a sighted co-player when focus is off-canvas.
    this.overlay.textContent = marker;
  }

  /** Hide the highlight (empty list). */
  hide(): void {
    this.overlay.style.display = "none";
    this.overlay.textContent = "";
  }
}
