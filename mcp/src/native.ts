// Native transport (Requirement 6) — STUB until task 14.
//
// The native transport spawns the real native ScummVM build from
// scripts/build-engine.sh, drives it through the command file, reads A11Y lines
// off stderr, and settles on log markers with a hard 60 s cap (no fixed
// sleeps). Its full implementation is drascula-mcp task 14, deliberately held
// until the engine-a11y-layer spec's task 19 (save/load) lands, so the
// optional --save-slot start path can be verified against a real build.
//
// Until then this stub exists so the server entrypoint compiles and the native
// transport is SELECTABLE — but constructing it fails loud with a clear
// message, rather than silently no-opping. The replay transport is the
// supported path today (DRASCULA_MCP_TRANSPORT=replay, the default).

import type { NativeConfig } from "./config.js";
import type { Command, CommandResult, RoomState, Transport } from "./transport.js";

export class NativeTransport implements Transport {
  constructor(_config: NativeConfig) {
    throw new Error(
      "drascula-mcp: the native transport is not implemented yet (task 14, " +
        "pending the engine spec's save/load task). Use the replay transport " +
        "(DRASCULA_MCP_TRANSPORT=replay, the default) for now.",
    );
  }

  // The interface methods are unreachable while the constructor throws; they
  // are declared so the stub satisfies Transport and task 14 fills them in.
  async start(): Promise<RoomState> {
    throw new Error("native transport not implemented (task 14).");
  }
  async send(_cmd: Command): Promise<CommandResult> {
    throw new Error("native transport not implemented (task 14).");
  }
  async stop(): Promise<void> {
    /* nothing to release in the stub */
  }
}
