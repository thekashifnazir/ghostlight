// Evaluate a JS expression in the Ghostlight tab via Chrome's debugging port. Usage: node cdp.mjs "<expr>"
const list = await (await fetch('http://127.0.0.1:9222/json')).json();
const page = list.find(t => t.type === 'page' && t.url.includes('ghostlight'));
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: (await import('node:fs')).readFileSync(process.argv[2],'utf8'), returnByValue: true, awaitPromise: true } }));
ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id === 1) { console.log(JSON.stringify(d.result.result.value ?? d.result, null, 1)); ws.close(); process.exit(0); } };
