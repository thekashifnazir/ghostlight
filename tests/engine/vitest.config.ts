import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["**/*.test.ts"],
    // Fixture replay is fast. Native runs play voiced lines in real time, so a
    // tavern replay takes minutes.
    testTimeout: process.env.GHOSTLIGHT_NATIVE === "1" ? 900_000 : 120_000,
    // Native runs share one save path (its command file and log), so run the
    // files one at a time; fixture runs stay parallel.
    fileParallelism: process.env.GHOSTLIGHT_NATIVE !== "1",
  },
});
