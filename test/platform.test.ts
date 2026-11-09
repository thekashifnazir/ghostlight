import { describe, expect, it } from "vitest";
import { isMacPlatform } from "../src/ui/platform.js";

// The one screen-reader tip whose advice differs by OS is chosen from this
// pure function. On a Mac the player speaks a VoiceOver Verbosity tip; on every
// other platform it speaks the NVDA/JAWS tip. The strings below are the real
// values from navigator.userAgentData.platform ("macOS") and the legacy
// navigator.platform ("MacIntel"), plus the Windows/Linux values that must take
// the NVDA/JAWS branch.
describe("isMacPlatform", () => {
  it("is true for Mac platform strings (modern and legacy)", () => {
    expect(isMacPlatform("macOS")).toBe(true); // userAgentData.platform
    expect(isMacPlatform("MacIntel")).toBe(true); // legacy navigator.platform
    expect(isMacPlatform("MacPPC")).toBe(true);
    expect(isMacPlatform("mac")).toBe(true); // case-insensitive
  });

  it("is false for non-Mac platforms and empty/undefined", () => {
    expect(isMacPlatform("Win32")).toBe(false);
    expect(isMacPlatform("Windows")).toBe(false);
    expect(isMacPlatform("Linux x86_64")).toBe(false);
    expect(isMacPlatform("iPhone")).toBe(false); // iOS is not a Mac desktop
    expect(isMacPlatform("")).toBe(false);
    expect(isMacPlatform(undefined)).toBe(false);
  });
});
