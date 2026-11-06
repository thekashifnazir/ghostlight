import { defineConfig } from "vite";

// The player is a static, framework-free page. Vite serves src/ in dev and
// builds a static bundle. index.html is the entry; main.ts is loaded as a
// module from it. The replay adapter is selected at runtime via ?replay=,
// so no build-time flag is needed to run the tests against recorded logs.
export default defineConfig({
  root: "src",
  publicDir: false,
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    target: "es2022",
  },
  server: {
    // Deterministic port so Playwright's webServer can wait on it.
    port: 5173,
    strictPort: true,
  },
  preview: {
    port: 5173,
    strictPort: true,
  },
});
