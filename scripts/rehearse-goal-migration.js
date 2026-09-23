"use strict";

// Read-only rehearsal against a copied production snapshot. No output file is written.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const repo = path.resolve(__dirname, "..");
const backup = process.argv[2] || "C:\\Users\\jmrol\\Projects\\goal-app-demo\\production-backups\\A\\goal-app-prod-raw-20260819T131746Z.json";
const rawBytes = fs.readFileSync(backup);
const source = JSON.parse(rawBytes.toString("utf8"));
assert.ok(Array.isArray(source), "Expected a goal array");
const sha = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const originalHash = sha(rawBytes);
const elements = {};
const element = () => ({ value: "", checked: false, innerHTML: "", textContent: "", style: {}, files: [],
  classList: { add() {}, remove() {}, toggle() { return false; }, contains() { return false; } },
  click() {}, focus() {}, appendChild() {}, removeChild() {} });
const localStorage = { getItem() { return "[]"; }, setItem() {} };
const window = { __SKIP_CLOUD_SAVE: true, addEventListener() {}, scrollTo() {} };
const context = { window, console, Date, Math, Blob: class Blob {}, URL: { createObjectURL() { return "blob:test"; } },
  FileReader: class FileReader {}, setTimeout() { return 0; }, clearTimeout() {}, setInterval() { return 0; }, clearInterval() {},
  alert() {}, confirm() { return true; }, prompt() { return null; }, localStorage,
  navigator: { clipboard: { writeText() { return Promise.resolve(); } } },
  document: { getElementById(id) { return elements[id] || (elements[id] = element()); }, createElement: element },
  GoalReformCore: require(path.join(repo, "goal-reform-core.js")) };
Object.assign(window, { window, document: context.document, localStorage, navigator: context.navigator, GoalReformCore: context.GoalReformCore });
vm.createContext(context);
const html = fs.readFileSync(path.join(repo, "goal-app.html"), "utf8");
const inline = html.match(/<script>([\s\S]*)<\/script>/);
assert.ok(inline, "Expected app inline script");
vm.runInContext(inline[1], context, { filename: "goal-app.html" });
const normalized = source.map((record) => context.normalize(structuredClone(record)));

function droppedPaths(before, after, prefix = "") {
  if (!before || typeof before !== "object") return [];
  return Object.keys(before).flatMap((key) => {
    const name = prefix ? `${prefix}.${key}` : key;
    if (!after || !Object.hasOwn(after, key)) return [name];
    return droppedPaths(before[key], after[key], name);
  });
}

function changedValues(before, after) {
  if (before && typeof before === "object") {
    return Object.keys(before).reduce((count, key) => count + changedValues(before[key], after && after[key]), 0);
  }
  return Object.is(before, after) ? 0 : 1;
}

const stages = {};
let activeStatusRecords = 0;
let unknownDropped = 0;
let daily = 0;
let dailyDropped = 0;
let dailyValuesChanged = 0;
for (let i = 0; i < source.length; i++) {
  const before = source[i], after = normalized[i];
  const stage = context.GoalReformCore.pipelineStage(after, { today: "2026-09-23" });
  stages[stage] = (stages[stage] || 0) + 1;
  if (after.goalType === "active" || after.status === "active") activeStatusRecords++;
  const dropped = droppedPaths(before, after);
  unknownDropped += dropped.length;
  if (before.goalType === "daily") { daily++; dailyDropped += dropped.length; dailyValuesChanged += changedValues(before, after); }
}
assert.equal(normalized.length, source.length, "No records may be lost");
assert.equal(sha(fs.readFileSync(backup)), originalHash, "Backup bytes must remain untouched");
console.log(JSON.stringify({ recordsBefore: source.length, recordsAfter: normalized.length,
  recordsLost: source.length - normalized.length, stages, activeMainGoals: stages.active || 0,
  activeStatusRecords, unknownFieldsDropped: unknownDropped,
  dailyRecords: daily, dailyFieldsDropped: dailyDropped, dailyValuesChanged, backupUnchanged: true }, null, 2));
if (unknownDropped || dailyDropped || dailyValuesChanged) process.exitCode = 1;
