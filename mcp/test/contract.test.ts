import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { ReplayAdapter } from "../../src/engine/replay-adapter.js";
import { serializeCommand } from "../../src/engine/adapter.js";
import { parseA11yLine } from "../../src/engine/a11y-lines.js";

// Contract-sharing guard (Requirements 2.7, 3.7, 5.4).
//
// The MCP server MUST use the one shared contract — serializeCommand and
// parseA11yLine from src/engine/ — never a local copy, so the player, the
// tests and this server cannot drift. This test fails if a future refactor
// copies either function into mcp/ instead of importing it.

const HERE = dirname(fileURLToPath(import.meta.url));
const MCP_SRC = resolve(HERE, "..", "src");

function readAllSources(dir: string): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = resolve(dir, entry.name);
    if (entry.isDirectory()) out.push(...readAllSources(p));
    else if (entry.name.endsWith(".ts")) out.push({ path: p, text: readFileSync(p, "utf8") });
  }
  return out;
}

describe("contract-sharing guard", () => {
  const sources = readAllSources(MCP_SRC);

  it("the shared contract is actually imported from src/engine/", () => {
    // The replay transport reaches serializeCommand + parseA11yLine through the
    // shared ReplayAdapter; something under mcp/src must import from
    // ../../src/engine/ so the contract comes from one place.
    const importsSharedEngine = sources.some((s) =>
      /from\s+["']\.\.\/\.\.\/src\/engine\//.test(s.text),
    );
    expect(importsSharedEngine).toBe(true);
  });

  it("mcp/src defines no local copy of serializeCommand or parseA11yLine", () => {
    // A copy would appear as a declaration of the same name. Catch function,
    // const, and method-ish redeclarations.
    const forbidden = [
      /\b(function|const|let|var)\s+serializeCommand\b/,
      /\b(function|const|let|var)\s+parseA11yLine\b/,
    ];
    for (const s of sources) {
      for (const re of forbidden) {
        expect(
          re.test(s.text),
          `${s.path} appears to redefine a shared-contract function (${re}); import it from src/engine/ instead`,
        ).toBe(false);
      }
    }
  });

  it("the imported shared functions are the real implementations", () => {
    // Sanity: exercise the shared functions so a broken import fails loudly.
    expect(serializeCommand({ verb: "look", target: 52 })).toBe("look 52");
    const ev = parseA11yLine("A11Y_CMD look 52");
    expect(ev).toEqual({ type: "cmd", cmd: "look 52" });
    // ReplayAdapter (the transport's shared engine) is a class we can construct.
    expect(typeof ReplayAdapter).toBe("function");
  });
});
