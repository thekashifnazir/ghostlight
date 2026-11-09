// Platform detection for the one screen-reader tip whose advice differs by OS.
// On a Mac the NVDA/JAWS hint is no use, so the player points VoiceOver users
// at the Verbosity setting instead. The decision is one tiny pure function that
// takes the platform string (rather than reading navigator itself) so it is
// unit-testable without a DOM, and lives in its own module so a unit test can
// import it without evaluating main.ts's build-stamp globals.

/**
 * True when the given platform string names a Mac. Matches the macOS values
 * from both the modern navigator.userAgentData.platform ("macOS") and the
 * legacy navigator.platform ("MacIntel"). Undefined is treated as not-Mac, so
 * an unknown environment falls back to the NVDA/JAWS tip.
 */
export function isMacPlatform(platform: string | undefined): boolean {
  return /mac/i.test(platform ?? "");
}
