// serve-live.mjs — a tiny static server for the web-build live Playwright check.
//
// It serves two roots merged at one origin, so the page and the engine are
// same-origin and boot.ts's default baseUrl ("/") resolves scummvm.js,
// scummvm.wasm and /data from the real build output:
//
//   1. the built Ghostlight page   (dist/, produced by `vite build`)
//   2. the ScummVM wasm build       (vendor/scummvm-web/build-emscripten/)
//
// A request is served from the page build first; if not found there, from the
// engine build. This mirrors the web/ hosting shape (page + small assets as
// "static assets", the engine tree alongside) without needing Cloudflare.
//
// Usage: node test/live/serve-live.mjs [port]
// It is started by test/live/playwright.live.config.ts as the Playwright
// webServer. It is NOT part of the replay suite.

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, normalize, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");

// Root 1: the built player page. Root 2: the engine build output.
const PAGE_ROOT = join(repoRoot, "dist");
const ENGINE_ROOT = join(repoRoot, "vendor", "scummvm-web", "build-emscripten");

const PORT = Number(process.argv[2] ?? process.env.PORT ?? 5174);

const TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".wasm", "application/wasm"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".ico", "image/x-icon"],
  [".dat", "application/octet-stream"],
  [".ogg", "audio/ogg"],
]);

function contentType(path) {
  const dot = path.lastIndexOf(".");
  const ext = dot === -1 ? "" : path.slice(dot).toLowerCase();
  return TYPES.get(ext) ?? "application/octet-stream";
}

/** Resolve a URL path to a file inside one of the roots, guarding traversal. */
async function resolveFile(urlPath) {
  // Normalize and strip any leading slash; block path traversal out of a root.
  let rel = normalize(decodeURIComponent(urlPath)).replace(/^(\.\.(\/|\\|$))+/, "");
  rel = rel.replace(/^[/\\]+/, "");
  if (rel === "" || rel.endsWith("/")) rel = join(rel, "index.html");

  for (const root of [PAGE_ROOT, ENGINE_ROOT]) {
    const candidate = join(root, rel);
    // Ensure the resolved path stays within the root.
    if (!resolve(candidate).startsWith(resolve(root))) continue;
    try {
      const s = await stat(candidate);
      if (s.isFile()) return candidate;
    } catch {
      /* not in this root; try the next */
    }
  }
  return null;
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
    const file = await resolveFile(url.pathname);
    if (!file) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end(`not found: ${url.pathname}`);
      return;
    }
    const body = await readFile(file);
    res.writeHead(200, {
      "Content-Type": contentType(file),
      "Cache-Control": "no-store",
    });
    res.end(body);
  } catch (err) {
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end(`server error: ${String(err)}`);
  }
});

server.listen(PORT, "127.0.0.1", () => {
  // eslint-disable-next-line no-console
  console.log(`[serve-live] http://127.0.0.1:${PORT}  page=${PAGE_ROOT}  engine=${ENGINE_ROOT}`);
});
