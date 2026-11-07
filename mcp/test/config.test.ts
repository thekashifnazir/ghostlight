import { describe, expect, it } from "vitest";

import { MCP_SAVE_PATH, resolveConfig } from "../src/config.js";

describe("resolveConfig", () => {
  it("defaults to the replay transport and the tavern fixture", () => {
    const cfg = resolveConfig([], {});
    expect(cfg.transport).toBe("replay");
    expect(cfg.fixture).toBe("tavern");
    expect(cfg.native.savePath).toBe(MCP_SAVE_PATH);
  });

  it("reads the transport and fixture from the environment", () => {
    const cfg = resolveConfig([], {
      DRASCULA_MCP_TRANSPORT: "replay",
      DRASCULA_MCP_FIXTURE: "ch2-handbag",
    });
    expect(cfg.fixture).toBe("ch2-handbag");
  });

  it("reads flags, with --key=value and --key value forms", () => {
    const cfg = resolveConfig(["--fixture=leave-tavern", "--save-slot", "3"], {});
    expect(cfg.fixture).toBe("leave-tavern");
    expect(cfg.native.slot).toBe(3);
  });

  it("flags win over the environment", () => {
    const cfg = resolveConfig(["--fixture", "tavern"], {
      DRASCULA_MCP_FIXTURE: "ch2-handbag",
    });
    expect(cfg.fixture).toBe("tavern");
  });

  it("rejects an unknown transport by name", () => {
    expect(() => resolveConfig([], { DRASCULA_MCP_TRANSPORT: "carrier-pigeon" })).toThrow(
      /unknown transport "carrier-pigeon"/,
    );
  });

  it("rejects an empty fixture name, naming it", () => {
    expect(() => resolveConfig([], { DRASCULA_MCP_FIXTURE: "   " })).toThrow(
      /empty fixture name/,
    );
  });

  it("rejects a non-integer save slot", () => {
    expect(() => resolveConfig(["--save-slot", "left"], {})).toThrow(/invalid --save-slot/);
  });

  it("fails loud when native is selected but the binary is absent", () => {
    expect(() =>
      resolveConfig([], {
        DRASCULA_MCP_TRANSPORT: "native",
        DRASCULA_MCP_SCUMMVM: "/no/such/scummvm-binary",
      }),
    ).toThrow(/native transport selected but the ScummVM binary was not found/);
  });
});
