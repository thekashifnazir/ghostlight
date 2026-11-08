import { execSync } from "node:child_process";
import { defineConfig } from "vite";

// The player is a static, framework-free page. Vite serves src/ in dev and
// builds a static bundle. index.html is the entry; main.ts is loaded as a
// module from it. The replay adapter is selected at runtime via ?replay=,
// so no build-time flag is needed to run the tests against recorded logs.

// Build stamp injected at build/dev-server start so a tester can read which
// build they ran from F1 help. Short git hash plus the date. If git is not
// available (e.g. a source tarball), fall back to "unknown" rather than fail.
function gitShortHash(): string {
  try {
    return execSync("git rev-parse --short HEAD").toString().trim();
  } catch {
    return "unknown";
  }
}
const BUILD_HASH = gitShortHash();
const BUILD_DATE = new Date().toISOString().slice(0, 10);

export default defineConfig({
  define: {
    __BUILD_HASH__: JSON.stringify(BUILD_HASH),
    __BUILD_DATE__: JSON.stringify(BUILD_DATE),
  },
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
    // Allow serving the read-only pack from ../packs (outside the src root).
    fs: { allow: [".."] },
  },
  preview: {
    port: 5173,
    strictPort: true,
  },
});
