// Keep focus on a start-screen button while the page finishes loading.
//
// Safari with VoiceOver already running (checked 15 Nov 2026, Safari 27.2):
// Ghostlight focuses Start, Continue or "Start the guide" about 0.3 s after the
// page loads, then VoiceOver starts reading the new page from the top and moves
// keyboard focus to the body. The player hears the whole start page, and Enter
// does whatever VoiceOver is reading at that moment (in that run, it opened the
// Source code link). Without VoiceOver, focus stays put.
//
// So for a short time after the page's load event, if focus falls to the body,
// put it back on the button. A move to any other element is left alone: that's
// the player, or VoiceOver's cursor reaching a control.
//
// Code AI-generated under Kash's direction. GPL-3.0-or-later.

/** How long after the load event a lost focus is put back. */
export const HOLD_AFTER_LOAD_MS = 1500;
/** At most this many put-backs, so focus is never fought over. */
export const MAX_REFOCUS = 3;

/**
 * Focus `el`, and put focus back on it if it falls to the body before
 * HOLD_AFTER_LOAD_MS after the window's load event. Returns a function that
 * stops holding early.
 */
export function holdFocusThroughLoad(el: HTMLElement): () => void {
  const doc = el.ownerDocument;
  const win = doc.defaultView;
  if (!win) {
    el.focus();
    return () => {};
  }
  let refocused = 0;
  let stopped = false;
  let deadline = Number.POSITIVE_INFINITY;
  let timer: number | undefined;

  const stop = (): void => {
    stopped = true;
    doc.removeEventListener("focusout", onFocusOut, true);
    win.removeEventListener("load", onLoad);
    if (timer !== undefined) win.clearTimeout(timer);
  };
  const countDown = (): void => {
    deadline = Date.now() + HOLD_AFTER_LOAD_MS;
    timer = win.setTimeout(stop, HOLD_AFTER_LOAD_MS);
  };
  const onLoad = (): void => countDown();
  const onFocusOut = (): void => {
    // activeElement is only settled after the focusout event. A check queued
    // before stop() must not act after it.
    win.setTimeout(() => {
      if (stopped) return;
      const active = doc.activeElement;
      if (active && active !== doc.body && active !== doc.documentElement) return;
      if (!el.isConnected || Date.now() > deadline) {
        stop();
        return;
      }
      el.focus();
      refocused += 1;
      if (refocused >= MAX_REFOCUS) stop();
    }, 0);
  };

  doc.addEventListener("focusout", onFocusOut, true);
  if (doc.readyState === "complete") countDown();
  else win.addEventListener("load", onLoad, { once: true });
  el.focus();
  return stop;
}
