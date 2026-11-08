# Deploying Ghostlight hosting

The Ghostlight page and the ScummVM wasm build are hosted on a Cloudflare Worker
with static assets, with the one oversized game-data file (`Packet.001`, 32.8 MB,
over Cloudflare's 25 MiB static-asset limit) served from R2 through the Worker.

**Nothing here embeds a secret, and no game data is committed.** Cloudflare
credentials are supplied at deploy time and referenced by name only; the build
output and game data live under gitignored paths and are assembled at deploy
time from `vendor/` (produced by `scripts/fetch.sh` + `scripts/build-web.sh`).

## Files

- `wrangler.jsonc` — the Worker config: the `ASSETS` static-assets binding and
  the `GAME_DATA` R2 bucket binding. Reviewable text, no secret.
- `src/index.ts` — the Worker: serves `Packet.001` from R2 (binary type, long
  immutable cache) and everything else from static assets, overriding the wasm
  content type to `application/wasm`.
- `public/` — **gitignored.** The static assets, assembled at deploy time from
  two builds: the ScummVM wasm output of `scripts/build-web.sh` plus the
  Ghostlight player page from `npm run build` at the repo root (dist/). Never
  committed.

## Credentials (by name only)

Authenticate Wrangler once, interactively:

```sh
npx wrangler login
```

or supply a scoped API token by name in the environment (never in a file):

```sh
export CLOUDFLARE_API_TOKEN=…   # a Workers + R2 scoped token; not committed
export CLOUDFLARE_ACCOUNT_ID=…
```

## One-time: create the R2 bucket

```sh
npx wrangler r2 bucket create ghostlight-game-data
```

(The name must match `r2_buckets[0].bucket_name` in `wrangler.jsonc`.)

## Each deploy

Run from the repo root. `BUILD` is the output of `scripts/build-web.sh`.

Use the project-local wrangler (`web/node_modules/.bin/wrangler`), not `npx
wrangler`. wrangler is a devDependency of `web/`, not of the repo root, so `npx
wrangler` run from the root does not find it and stops on an interactive "Ok to
proceed?" install prompt — which hangs a non-interactive deploy. The local
binary is the same pinned version (4.158.0) and needs no prompt.

```sh
BUILD=vendor/scummvm-web/build-emscripten
WRANGLER=web/node_modules/.bin/wrangler

# 1. Build the Ghostlight player (the typed/keyboard page) with Vite. This is a
#    separate build from the ScummVM wasm: `scripts/build-web.sh` only produces
#    the ScummVM output in $BUILD (scummvm.html/js/wasm + data/), not the page.
#    `npm run build` at the repo root emits the page to the gitignored dist/
#    (index.html + assets/index-<hash>.js, hash-stamped with the short git HEAD).
#    Shipping a player-code change (anything under src/) means running this so a
#    fresh bundle lands in dist/; skipping it ships a stale page.
npm run build

# 2. Assemble the static assets (gitignored path): the ScummVM build output,
#    then the player page overlaid on top. Both are needed — $BUILD alone is the
#    raw ScummVM shell with no Ghostlight page; dist/ alone has no wasm or data.
mkdir -p web/public && find web/public -mindepth 1 -delete
cp -R "$BUILD"/* web/public/
cp -R dist/*     web/public/

# 3. Move the oversized game-data blob out of static assets and into R2.
#    (Static assets cannot hold a file over 25 MiB; the Worker serves it from R2.)
#    --remote is REQUIRED: without it wrangler 4.x writes to the LOCAL simulated
#    R2 (it prints "Resource location: local") and the live bucket is untouched.
"$WRANGLER" r2 object put --remote \
  ghostlight-game-data/data/games/drascula/Packet.001 \
  --file "web/public/data/games/drascula/Packet.001" \
  --content-type application/octet-stream
rm -f web/public/data/games/drascula/Packet.001

# 4. Ship the game readme and a modified-data notice alongside the data
#    (R5.6). The readme comes from the fetched game; MODIFIED.txt is written here.
cp vendor/game/drascula/readme.txt web/public/data/games/drascula/readme.txt 2>/dev/null || true
cat > web/public/data/games/drascula/MODIFIED.txt <<'NOTE'
This copy of the Drascula: The Vampire Strikes Back freeware data is served by
Ghostlight, an accessibility front-end for ScummVM. The ScummVM engine running
it is modified (a small accessibility patch in engine/, GPL-3.0-or-later); the
game data itself is the unmodified ScummVM freeware distribution. See the
game's own readme.txt in this folder, and https://www.scummvm.org/ for ScummVM.

The complete corresponding source for the modified GPL ScummVM build (the
engine/ files, hooks.patch, the pinned ScummVM commit, the build script and the
GPL text) is served on the live site at /source/.
NOTE

# 5. GPL source offer. The served scummvm.wasm is a modified GPL ScummVM build,
#    so the corresponding source must be offered alongside it. Assemble /source/
#    from the committed landing page (web/source/) plus the actual modification
#    source and the GPL text (copied from the real repo files, so they never
#    drift from what built the wasm).
mkdir -p web/public/source
cp web/source/index.html         web/public/source/index.html
cp engine/a11y.cpp               web/public/source/a11y.cpp
cp engine/a11y.h                 web/public/source/a11y.h
cp engine/hooks.patch            web/public/source/hooks.patch
cp engine/COPYING                web/public/source/COPYING
cp scripts/build-web.sh          web/public/source/build-web.sh

# 6. Deploy the Worker + static assets.
"$WRANGLER" deploy --config web/wrangler.jsonc
```

Wrangler prints the deployed URL (a `*.workers.dev` subdomain unless a custom
route is configured). Opening it boots the live build; `Packet.001` is fetched
from R2 on first load.

## Notes

- **Whole-file R2 reads.** The Emscripten HTTP filesystem fetches whole files,
  so the Worker does a plain `bucket.get` and streams the body; no `Range`
  handling is needed.
- **Licensing.** The served wasm is ScummVM (GPL-3.0-or-later); the hosted copy
  carries ScummVM's notices and the game readme plus the `MODIFIED.txt` notice
  above. The GPL's corresponding-source requirement is met by serving the
  modification source at `/source/` (step 5 above): the `engine/` files,
  `hooks.patch`, the pinned ScummVM commit (`ad351d1e`) with a GitHub link, the
  `build-web.sh` script, short build steps and the GPL text. The page footer
  links to it. The Ghostlight page, Worker and config are MIT.
- **No committed game data, no committed key.** `web/public/` is gitignored and
  rebuilt each deploy; credentials are supplied at deploy time by name.

## Custom domain

The Worker is served on a custom domain **in addition to** its default
`*.workers.dev` URL:

- Live: <https://ghostlight.kashifnazir.com> (custom domain)
- Also live: <https://ghostlight.kash-553.workers.dev> (default workers.dev URL)

The custom domain is declared in `wrangler.jsonc`:

```jsonc
"routes": [
  { "pattern": "ghostlight.kashifnazir.com", "custom_domain": true }
],
"workers_dev": true
```

- `custom_domain: true` makes Cloudflare create and manage the DNS record and
  the edge TLS certificate for the hostname. The `kashifnazir.com` zone must be
  on the same Cloudflare account; `wrangler deploy` provisions the record and
  cert on first deploy (DNS + cert take a short while to go live).
- `workers_dev: true` is required to **keep the default `*.workers.dev` URL
  working once any `routes` are declared** — otherwise wrangler disables
  workers.dev for the deployment (it warns about this). Both URLs then serve the
  same Worker, including `Packet.001` from R2.
- No secret or DNS token is committed; the domain is managed by Cloudflare from
  the account the deploy authenticates against (by name, as above).
