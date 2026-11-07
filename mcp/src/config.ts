// Configuration (Requirements 1.3, 1.4, 1.6, 6.1, 9.3, 9.4).
//
// Resolves, from environment variables and/or CLI flags, which transport to
// run and how to launch the native engine, with safe defaults:
//   - transport defaults to "replay", so the server starts with no native
//     build present (Req 1.3, 9.3);
//   - the native launch config defaults match scripts/build-engine.sh.
// No secret is ever read or printed; config references values by name only
// (Req 1.6, 9.4). An unresolvable selection throws here with a message naming
// the cause, so the server fails to start rather than erroring on every call
// (Req 1.4).

import { existsSync } from "node:fs";

export type TransportKind = "replay" | "native";

export interface NativeConfig {
  /** The native ScummVM binary built by scripts/build-engine.sh. */
  binary: string;
  /** The Drascula game data directory (fetch.sh output). */
  gamePath: string;
  /** Where drascula.dat lives (--extrapath). */
  extraPath: string;
  /** Save path; also where the a11y command file lives. MCP owns this dir. */
  savePath: string;
  /** Optional save slot to load on start (Req 6.2); undefined = game start. */
  slot?: number;
}

export interface Config {
  transport: TransportKind;
  /** Replay fixture name under tests/engine/fixtures (replay transport). */
  fixture: string;
  /** Native launch config (always resolved; only used by the native transport). */
  native: NativeConfig;
}

/** The MCP session's own save path, never shared with another chat (Req 6.3). */
export const MCP_SAVE_PATH = "/tmp/ghostlight-mcp";

/** Defaults mirror scripts/build-engine.sh's documented run command. */
const DEFAULTS = {
  fixture: "tavern",
  binary: "vendor/scummvm/scummvm",
  gamePath: "vendor/game/drascula",
  extraPath: "vendor/scummvm/dists/engine-data",
} as const;

/** Parse `--key value` and `--key=value` flags into a map. */
function parseFlags(argv: string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const eq = arg.indexOf("=");
    if (eq !== -1) {
      out.set(arg.slice(2, eq), arg.slice(eq + 1));
    } else {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        out.set(arg.slice(2), next);
        i++;
      } else {
        out.set(arg.slice(2), "true");
      }
    }
  }
  return out;
}

function pick(
  flags: Map<string, string>,
  flagName: string,
  envName: string,
  fallback?: string,
): string | undefined {
  return flags.get(flagName) ?? process.env[envName] ?? fallback;
}

/**
 * Resolve config from the environment and CLI flags. Throws a clear, named
 * error for an unresolvable selection (Req 1.4). Does not read any key.
 */
export function resolveConfig(
  argv: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): Config {
  const flags = parseFlags(argv);

  const rawTransport =
    flags.get("transport") ?? env.DRASCULA_MCP_TRANSPORT ?? "replay";
  if (rawTransport !== "replay" && rawTransport !== "native") {
    throw new Error(
      `drascula-mcp: unknown transport "${rawTransport}". ` +
        `Set DRASCULA_MCP_TRANSPORT (or --transport) to "replay" or "native".`,
    );
  }
  const transport: TransportKind = rawTransport;

  const fixture =
    flags.get("fixture") ?? env.DRASCULA_MCP_FIXTURE ?? DEFAULTS.fixture;
  if (fixture.trim() === "") {
    throw new Error(
      `drascula-mcp: empty fixture name. Set DRASCULA_MCP_FIXTURE (or ` +
        `--fixture) to a fixture under tests/engine/fixtures/ (e.g. "tavern").`,
    );
  }

  const slotRaw = pick(flags, "save-slot", "DRASCULA_MCP_SLOT");
  let slot: number | undefined;
  if (slotRaw !== undefined && slotRaw !== "") {
    const n = Number.parseInt(slotRaw, 10);
    if (!Number.isInteger(n) || n < 0) {
      throw new Error(
        `drascula-mcp: invalid --save-slot "${slotRaw}"; expected a ` +
          `non-negative integer.`,
      );
    }
    slot = n;
  }

  const native: NativeConfig = {
    binary: pick(flags, "scummvm", "DRASCULA_MCP_SCUMMVM", DEFAULTS.binary)!,
    gamePath: pick(flags, "game", "DRASCULA_MCP_GAME", DEFAULTS.gamePath)!,
    extraPath: pick(flags, "extra", "DRASCULA_MCP_EXTRA", DEFAULTS.extraPath)!,
    savePath: pick(flags, "savepath", "DRASCULA_MCP_SAVEPATH", MCP_SAVE_PATH)!,
    slot,
  };

  // For the native transport, fail loud now if the binary is absent, rather
  // than spawning a missing file on the first tool call (Req 1.4). The replay
  // transport validates its fixture at construction, so it needs no check here.
  if (transport === "native" && !existsSync(native.binary)) {
    throw new Error(
      `drascula-mcp: native transport selected but the ScummVM binary was not ` +
        `found at "${native.binary}". Build it with scripts/build-engine.sh, ` +
        `or set DRASCULA_MCP_SCUMMVM to its path.`,
    );
  }

  return { transport, fixture, native };
}
