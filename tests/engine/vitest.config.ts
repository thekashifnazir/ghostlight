import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["**/*.test.ts"],
    // Replaying against the real native engine (once wired) is slower than a
    // fixture read, so give each test room. Fixture replay is fast and well
    // under this.
    testTimeout: 120_000,
  },
});
