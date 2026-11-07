import { defineConfig, devices } from "@playwright/test";

// Playwright specs (test/*.spec.ts) drive the page through the replay adapter
// (?replay=<fixture>), with no live engine. The dev server is started for the
// run and torn down after. Specs are kept separate from vitest unit/property
// tests (test/*.test.ts), which vitest owns.
export default defineConfig({
  testDir: "test",
  testMatch: /.*\.spec\.ts$/,
  // The live wasm check (test/live/) is a separate project with its own config
  // (test/live/playwright.live.config.ts); keep it out of the replay suite so
  // the player tests run green on a machine with no wasm build.
  testIgnore: /live\//,
  fullyParallel: true,
  reporter: "list",
  use: {
    baseURL: "http://localhost:5173",
  },
  projects: [
    {
      name: "chromium",
      // Use the locally installed Google Chrome (channel "chrome") so the run
      // needs no Playwright browser download. Swap to the bundled "chromium"
      // once `playwright install chromium` has fully fetched the browser.
      use: { ...devices["Desktop Chrome"], channel: "chrome" },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
