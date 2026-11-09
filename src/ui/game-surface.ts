// Mac-only accessible content for the game surface (#game, role=application).
//
// VoiceOver on the Mac reads an application element with no accessible content
// as "Ghostlight game, empty application". A visually hidden text child gives
// it content and removes that phrase. NVDA must NOT get this child: with it,
// NVDA stays in browse mode and the game keys turn into NVDA quick-nav keys
// (a scripted NVDA run fell from 16/16 to 9/16). So it is added on the Mac
// only, never on any other platform. The child is not aria-hidden.

import { isMacPlatform } from "./platform.js";

const MARKER_ATTR = "data-game-surface-label";

/**
 * Prepend the hidden "Ghostlight game" span to the game element when the
 * platform is a Mac. Adds it at most once. Does nothing on other platforms.
 */
export function addMacGameSurfaceText(
  gameEl: HTMLElement,
  platform: string | undefined,
): void {
  if (!isMacPlatform(platform)) return;
  if (gameEl.querySelector(`[${MARKER_ATTR}]`)) return;
  const span = gameEl.ownerDocument.createElement("span");
  span.className = "visually-hidden";
  span.setAttribute(MARKER_ATTR, "");
  span.textContent = "Ghostlight game";
  gameEl.prepend(span);
}
