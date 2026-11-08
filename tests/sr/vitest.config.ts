import { defineConfig } from "vitest/config";

// Self-contained Vitest config for the sr-harness unit tests only.
//
// The root vitest.config.ts deliberately excludes tests/** (that tree is the
// engine harness, owned by another chat), so the sr-harness ships its own
// config scoped to tests/sr. This keeps every sr-harness file inside the owned
// tests/sr/ tree and touches no shared config.
//
// Run with:  npx vitest run --config tests/sr/vitest.config.ts
//
// These tests cover the pure scenario parser and the speech-log matcher on
// recorded NVDA logs. They need no VM, prlctl, NVDA, or network.
export default defineConfig({
  test: {
    root: __dirname,
    include: ["**/*.test.ts"],
    environment: "node",
  },
});
