// Ghostlight hosting Worker (web-build Requirement 5).
//
// Serves the Ghostlight page and the ScummVM wasm build at near-zero cost:
//   * Packet.001 (32.8 MB, over Cloudflare's 25 MiB static-asset limit) is
//     streamed from the R2 bucket binding with a binary content type and a
//     long-lived immutable cache (R5.2, R5.3).
//   * everything else — the page, scummvm.js, scummvm.wasm, translations.dat,
//     themes, the index.json listings and the small game-data files — is served
//     by the static-assets binding. The Worker overrides the content type where
//     the asset layer gets it wrong, notably application/wasm for the wasm
//     (R5.1, R5.4).
//
// No secret lives here. Cloudflare credentials are supplied at deploy time and
// referenced by name only (R5.7).

export interface Env {
  /** Static-assets binding (the ./public build output, minus Packet.001). */
  ASSETS: Fetcher;
  /** R2 bucket holding the one oversized game-data file, Packet.001. */
  GAME_DATA: R2Bucket;
}

/**
 * The HTTP-filesystem path the ScummVM Emscripten build requests for the game
 * data blob. The build lays the game out under /data/games/drascula, so the
 * loader fetches this exact path. The file is fetched whole (no range
 * requests), so the Worker does a plain bucket.get and streams the body.
 */
const PACKET_PATH = "/data/games/drascula/Packet.001";

/** The R2 object key Packet.001 is stored under (see web/DEPLOY.md). */
const PACKET_KEY = "data/games/drascula/Packet.001";

/** A long-lived immutable cache for the big, never-changing game-data blob. */
const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";

/** Content type for the wasm, which the static-assets layer may mislabel. */
const WASM_CONTENT_TYPE = "application/wasm";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // 1. Packet.001 comes from R2, not static assets (it is over the 25 MiB
    //    static-asset limit). Stream the whole object with a binary content
    //    type and a long immutable cache so repeat loads are cheap.
    if (url.pathname === PACKET_PATH) {
      // GET/HEAD only; the HTTP filesystem never mutates it.
      if (request.method !== "GET" && request.method !== "HEAD") {
        return new Response("Method Not Allowed", {
          status: 405,
          headers: { Allow: "GET, HEAD" },
        });
      }

      const object = await env.GAME_DATA.get(PACKET_KEY);
      if (object === null) {
        // A clear, specific error — not a static 404 that looks like a routing
        // bug — so a missing R2 upload is obvious (design: error handling).
        return new Response(
          `Game data not found in R2 (key "${PACKET_KEY}"). ` +
            `Upload it with the deploy step in web/DEPLOY.md.`,
          { status: 502, headers: { "Content-Type": "text/plain; charset=utf-8" } },
        );
      }

      const headers = new Headers();
      // Carry R2's stored metadata (etag etc.), then set the content type and
      // cache policy we want for this blob.
      object.writeHttpMetadata(headers);
      headers.set("etag", object.httpEtag);
      headers.set("Content-Type", "application/octet-stream");
      headers.set("Cache-Control", IMMUTABLE_CACHE);

      // HEAD gets the headers with no body.
      const body = request.method === "HEAD" ? null : object.body;
      return new Response(body, { headers });
    }

    // 2. Everything else is a static asset. Forward to the asset layer, then
    //    fix up the content type where it matters (the wasm).
    const response = await env.ASSETS.fetch(request);

    if (url.pathname.endsWith(".wasm")) {
      const headers = new Headers(response.headers);
      headers.set("Content-Type", WASM_CONTENT_TYPE);
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    }

    return response;
  },
} satisfies ExportedHandler<Env>;
