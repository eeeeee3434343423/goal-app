"use strict";

// Local-only, signed-out rehearsal. The source backup is read, never edited.
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const repo = path.resolve(__dirname, "..");
const backup = "C:\\Users\\jmrol\\Projects\\goal-app-demo\\production-backups\\A\\goal-app-prod-raw-20260819T131746Z.json";
const raw = fs.readFileSync(backup, "utf8");
const goals = JSON.parse(raw);
if (!Array.isArray(goals) || goals.length !== 24) throw new Error("Expected the verified 24-record backup; demo not started.");
const safeSeed = JSON.stringify(raw).replace(/</g, "\\u003c");
const bootstrap = `<script>window.__SKIP_CLOUD_SAVE=true;if(localStorage.getItem("achieve.goals.v1")===null)localStorage.setItem("achieve.goals.v1",${safeSeed});</script>`;
const allowed = new Map([
  ["/sync-safety-v2.js", "sync-safety-v2.js"],
  ["/sync-v2-api.js", "sync-v2-api.js"],
  ["/sync-v2-firestore-modern.js", "sync-v2-firestore-modern.js"],
  ["/goal-reform-core.js", "goal-reform-core.js"],
  ["/goal-reform-ui.js", "goal-reform-ui.js"],
]);
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  res.setHeader("Cache-Control", "no-store");
  if (url.pathname === "/" || url.pathname === "/goal-app.html") {
    const html = fs.readFileSync(path.join(repo, "goal-app.html"), "utf8");
    const marker = '<script src="./sync-safety-v2.js"></script>';
    if (!html.includes(marker)) { res.writeHead(500); res.end("Demo bootstrap marker missing"); return; }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html.replace(marker, bootstrap + "\n" + marker));
    return;
  }
  const file = allowed.get(url.pathname);
  if (!file) { res.writeHead(404); res.end("Not found"); return; }
  res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" });
  fs.createReadStream(path.join(repo, file)).pipe(res);
});
// A fixed port keeps the same browser storage between runs, so demo progress
// survives a restart. Set REFORM_DEMO_PORT to change it.
const port = process.env.REFORM_DEMO_PORT !== undefined ? Number(process.env.REFORM_DEMO_PORT) : 4190;
server.on("error", (e) => { console.error(e.code === "EADDRINUSE" ? `Port ${port} is busy. Close the other demo window, or set REFORM_DEMO_PORT.` : e.message); process.exit(1); });
server.listen(port, "127.0.0.1", () => {
  console.log(`Signed-out Goal Reform demo: http://127.0.0.1:${server.address().port}/`);
  console.log("Using an in-browser copy of 24 records. Cloud sync is disabled; source backup is read-only. Press Ctrl+C to stop.");
});
