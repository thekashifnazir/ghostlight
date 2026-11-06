import { defineConfig } from "vitest/config";

// The root project is the player only. Vitest sees just the player's unit and
// property tests (test/*.test.ts) and any colocated src tests, and is kept
// well away from the other chats' trees (tests/** is the engine harness,
// packs/* is the pack tools, vendor/** is the pinned ScummVM checkout).
// Playwright specs (test/*.spec.ts) are run by `playwright test`, not vitest.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
    exclude: [
      "test/**/*.spec.ts",
      "tests/**",
      "packs/**",
      "vendor/**",
      "node_modules/**",
      "dist/**",
    ],
    environment: "node",
  },
});
