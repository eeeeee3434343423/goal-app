"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const html = fs.readFileSync(require("node:path").join(__dirname, "..", "goal-app.html"), "utf8");
const start = html.indexOf("function parseGoalSyncArray");
const end = html.indexOf("function setSaveStatus", start);
assert.ok(start >= 0 && end > start, "Goal repair helpers must exist");
const context = {};
vm.createContext(context);
vm.runInContext(html.slice(start, end), context);

test("merges goals by ID and preserves one-sided and unknown fields", () => {
  const local = JSON.stringify([{ id: "a", title: "Local", localOnly: true }, { id: "won", achievedAt: 9 }]);
  const remote = JSON.stringify([{ id: "a", futureMonth: "2029-01", remoteOnly: true }, { id: "future", goalType: "future" }]);
  const result = context.mergeGoalSyncValues(local, remote, 20, 10, {});
  const byId = Object.fromEntries(result.items.map((item) => [item.id, item]));
  assert.equal(byId.a.title, "Local");
  assert.equal(byId.a.futureMonth, "2029-01");
  assert.equal(byId.a.localOnly, true);
  assert.equal(byId.a.remoteOnly, true);
  assert.ok(byId.won);
  assert.ok(byId.future);
});

test("missing remote records survive unless tombstoned", () => {
  const remote = JSON.stringify([{ id: "keep" }, { id: "remove" }]);
  assert.equal(context.mergeGoalSyncValues("[]", remote, 20, 10, {}).items.length, 2);
  assert.deepEqual(Array.from(context.mergeGoalSyncValues("[]", remote, 20, 10, { remove: 30 }).items, (x) => x.id), ["keep"]);
});

test("cloud save backs up the remote document before primary write", () => {
  const save = html.slice(html.indexOf("async function saveCloudGoals"), html.indexOf("async function startGoalSync"));
  assert.ok(save.indexOf("await backupGoalRemoteBeforeWrite()") < save.indexOf("await cloudSave.setDoc(cloudSave.docRef"));
  assert.match(save, /try \{ await backupGoalRemoteBeforeWrite\(\); \} catch\(e\)\{\}/);
});

test("live remote tombstones are retained for the next local save", () => {
  const listener = html.slice(html.indexOf("cloudSave.unsubscribe = cloudSave.onSnapshot"), html.indexOf("function applyCloudEnvelope"));
  assert.match(listener, /localStorage\.setItem\(KEY \+ "\.tombstones", JSON\.stringify\(marks\)\)/);
});

test("import explicitly revives IDs that were deleted earlier", () => {
  assert.match(html, /goals = normalizeGoals\(arr\);\s*reviveImportedGoalIds\(goals\);\s*save\(\)/);
});
