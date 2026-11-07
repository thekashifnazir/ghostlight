import { defineConfig } from "vitest/config";

// The MCP server is a self-contained package. Its tests live in mcp/test and
// run through this config only (npm --prefix mcp test), never through the root
// vitest.config.ts. A started replay session is a fixture read, so it is fast;
// the generous timeout is headroom for the fast-check property run.
export default defineConfig({
  test: {
    root: __dirname,
    include: ["test/**/*.test.ts"],
    environment: "node",
    testTimeout: 60_000,
  },
});
