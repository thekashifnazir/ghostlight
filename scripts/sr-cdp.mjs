// sr-cdp.mjs — evaluate a JS expression (or reload the page) in the Ghostlight
// tab via Chrome's remote-debugging port. Re-implemented for sr-harness from
// Spike 10's cdp.mjs; not copied from reference/. Runs inside the VM via Node.
//
// This is the page bridge: a read/control channel separate from the keyboard
// input path, used to corroborate the focused element and live region and to
// drive page-level actions (reload) the keyboard cannot. It never injects keys.
//
// Usage:
//   node sr-cdp.mjs <expr-file>     evaluate the JS in the file, print the value
//   node sr-cdp.mjs --reload        reload the Ghostlight tab, wait for load

import { readFileSync } from "node:fs";

const PORT = 9222;
const arg = process.argv[2];

const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
const page = list.find((t) => t.type === "page" && t.url.includes("ghostlight"));
if (!page) {
  console.error("sr-cdp: no Ghostlight tab found on the debugging port");
  process.exit(1);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));

let nextId = 1;
function send(method, params) {
  return new Promise((resolve) => {
    const id = nextId++;
    const onMsg = (m) => {
      const d = JSON.parse(m.data);
      if (d.id === id) {
        ws.removeEventListener("message", onMsg);
        resolve(d.result ?? d);
      }
    };
    ws.addEventListener("message", onMsg);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

if (arg === "--reload") {
  await send("Page.enable", {});
  await send("Page.reload", { ignoreCache: false });
  // Give the reload a moment to start, then poll readyState until complete.
  for (let i = 0; i < 60; i++) {
    const r = await send("Runtime.evaluate", {
      expression: "document.readyState",
      returnByValue: true,
    });
    if (r.result?.value === "complete") break;
    await new Promise((r) => setTimeout(r, 500));
  }
  console.log("reloaded");
} else {
  const expression = readFileSync(arg, "utf8");
  const r = await send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  console.log(JSON.stringify(r.result?.value ?? r, null, 1));
}

ws.close();
process.exit(0);
