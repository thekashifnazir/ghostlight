import { defineConfig, devices } from "@playwright/test";

// The LIVE Playwright check (web-build Requirement 6). It boots the REAL ScummVM
// wasm build and asserts the engine reaches room 62 — a separate project from
// the replay-based player tests (test/*.spec.ts), so the player suite still runs
// green on a machine with no wasm build (R6.5).
//
// The webServer builds the player page (`vite build` → dist/) and serves it
// merged with the engine build output (vendor/scummvm-web/build-emscripten/) at
// one origin, so the page and engine are same-origin and boot.ts's default
// baseUrl resolves scummvm.js / scummvm.wasm / /data from the real build.
//
// Run with:  npx playwright test --config test/live/playwright.live.config.ts
// When the wasm build is absent the single spec test.skip()s with a message
// pointing at scripts/build-web.sh and scripts/fetch.sh.
export default defineConfig({
  testDir: ".",
  // The live boot check (live.spec.ts), the save-progress continue-after-reload
  // and save-key checks, the broad live sweep (sweep.spec.ts: every tester key,
  // the chapter 1 -> 2 crossing, and C/O save-load), and the chapter-2 inn-bar
  // -> street exit regression (ch2-exit.spec.ts). All need the real wasm build
  // and skip with a clear message when it is absent. Per-project testMatch below
  // narrows WebKit to the sweep (the other specs are Chrome).
  testMatch: /(live|save-continue|save-key|sweep|ch2-exit|choice-linger)\.spec\.ts$/,
  fullyParallel: false,
  reporter: "list",
  // A cold wasm instantiation plus the game-data fetch can take well over the
  // 30s Playwright default, so give the single live test a generous budget that
  // comfortably exceeds the spec's own 60s boot race.
  timeout: 120_000,
  use: {
    baseURL: "http://127.0.0.1:5174",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "live-chromium",
      // Use the locally installed Google Chrome (channel "chrome"), matching the
      // replay config, so the run needs no Playwright browser download. Chrome
      // runs all the live specs (boot, save-key, save-continue, sweep).
      use: { ...devices["Desktop Chrome"], channel: "chrome" },
    },
    {
      // WebKit (Safari's engine). The sweep runs on BOTH engines so a bug that
      // only shows under WebKit's key/focus/audio handling is caught; the other
      // live specs stay Chrome-only (they were tuned for it), so this project is
      // narrowed to the sweep. WebKit is the bundled Playwright browser (no
      // system channel), so the runner needs `npx playwright install webkit`.
      name: "live-webkit",
      testMatch: /sweep\.spec\.ts$/,
      use: { ...devices["Desktop Safari"] },
    },
  ],
  webServer: {
    // Build the page, then serve dist/ + the engine build at one origin.
    command:
      "npm run build && node test/live/serve-live.mjs 5174",
    url: "http://127.0.0.1:5174/index.html",
    reuseExistingServer: !process.env.CI,
    // vite build can take a while on a cold machine.
    timeout: 120_000,
    cwd: process.cwd(),
  },
});
