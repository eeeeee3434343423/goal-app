"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function runtime() {
  const records = { goals: [], hubApps: [], trash: [], changeLog: [] };
  const listeners = {};
  const document = {
    readyState: "complete",
    documentElement: { setAttribute() {} },
    body: { appendChild() {} },
    getElementById() { return null; },
    createElement() {
      return { style: {}, addEventListener(type, fn) { listeners[type] = fn; } };
    },
    addEventListener() {}
  };
  const context = {
    window: null, document, Blob, URL, console,
    alert() {}, prompt() { return null; },
    SyncSafetyV2: require("../sync-safety-v2.js")
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "sync-v2-api.js"), "utf8"), context);
  const port = {
    async list(name) { return records[name].map((item) => structuredClone(item)); },
    async commit(name, mutation, expectedRevision, deviceId) {
      const index = records[name].findIndex((item) => item.id === mutation.id);
      const current = index < 0 ? null : records[name][index];
      const revision = current ? current.revision : 0;
      if (revision !== expectedRevision) {
        const error = new Error("conflict"); error.code = "REVISION_CONFLICT"; throw error;
      }
      const next = { id: mutation.id, payload: structuredClone(mutation.payload), schemaVersion: 2, revision: revision + 1, updatedBy: deviceId };
      if (index < 0) records[name].push(next); else records[name][index] = next;
      records.changeLog.push({ operation: current ? "update" : "create", recordId: next.id });
      return structuredClone(next);
    },
    async trash(name, type, id, expectedRevision) {
      const index = records[name].findIndex((item) => item.id === id);
      const current = records[name][index];
      if (!current || current.revision !== expectedRevision) { const error = new Error("conflict"); error.code = "REVISION_CONFLICT"; throw error; }
      const entry = { id: type + "__" + id, recordType: type, recordId: id, payload: current.payload, revision: current.revision };
      records[name].splice(index, 1); records.trash.push(entry); return structuredClone(entry);
    },
    async restore(trashId, expectedRevision) {
      const index = records.trash.findIndex((item) => item.id === trashId);
      const entry = records.trash[index];
      if (!entry || entry.revision !== expectedRevision) throw new Error("conflict");
      const next = { id: entry.recordId, recordType: entry.recordType, payload: entry.payload, schemaVersion: 2, revision: entry.revision + 1 };
      records.trash.splice(index, 1); records.goals.push({ ...next, recordType: undefined }); return next;
    }
  };
  return { context, records, port };
}

test("runtime migrates legacy goals once and later syncs only changed records", async () => {
  const { context, records, port } = runtime();
  await context.configureV2Sync({ uid: "u1", deviceId: "d1", port });
  const legacy = [{ id: "a", title: "A", unknown: { preserved: true } }, { id: "b", title: "B" }];
  const report = await context.migrateLegacyEnvelopeOnce(legacy, "goal");
  assert.equal(report.migrated, 2);
  assert.equal(records.goals.length, 2);
  assert.deepEqual(records.goals[0].payload.unknown, { preserved: true });
  const again = await context.migrateLegacyEnvelopeOnce(legacy, "goal");
  assert.equal(again.alreadyComplete, true);
  await context.syncV2Records("goals", [{ ...legacy[0], title: "A2" }, legacy[1]], "goal");
  assert.equal(records.goals.find((item) => item.id === "a").revision, 2);
  assert.equal(records.goals.find((item) => item.id === "b").revision, 1);
});

test("an interrupted migration resumes missing records instead of accepting a partial collection", async () => {
  const { context, records, port } = runtime();
  records.goals.push({ id: "a", payload: { id: "a", title: "A" }, schemaVersion: 2, revision: 1 });
  await context.configureV2Sync({ uid: "u1", deviceId: "d1", port });
  const report = await context.migrateLegacyEnvelopeOnce([
    { id: "a", title: "A" },
    { id: "b", title: "B" },
    { id: "c", title: "C" }
  ], "goal");
  assert.equal(report.migrated, 2);
  assert.deepEqual(new Set(records.goals.map((record) => record.id)), new Set(["a", "b", "c"]));
});

test("pending mutations remain visible to polling guards until the transaction settles", async () => {
  const { context, port } = runtime();
  let release;
  const originalCommit = port.commit;
  port.commit = async (...args) => {
    await new Promise((resolve) => { release = resolve; });
    return originalCommit(...args);
  };
  await context.configureV2Sync({ uid: "u1", deviceId: "d1", port });
  const pending = context.commitRecordMutation(
    { recordType: "goal", id: "a", payload: { id: "a", title: "new" } },
    0
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(context.isV2RecordPending("goals", "a"), true);
  release();
  await pending;
  assert.equal(context.isV2RecordPending("goals", "a"), false);
});

test("short arrays never infer deletion and explicit delete is restorable", async () => {
  const { context, records, port } = runtime();
  records.goals.push(
    { id: "a", payload: { id: "a", title: "A" }, schemaVersion: 2, revision: 1 },
    { id: "b", payload: { id: "b", title: "B" }, schemaVersion: 2, revision: 1 }
  );
  await context.configureV2Sync({ uid: "u1", deviceId: "d1", port });
  await context.loadV2Records("goals");
  await assert.rejects(context.syncV2Records("goals", [{ id: "a", title: "A" }], "goal"), /Blocked abnormal removal/);
  assert.equal(records.goals.length, 2);
  await context.configureV2Sync({ uid: "u1", deviceId: "d1", port });
  await context.loadV2Records("goals");
  const trashed = await context.moveRecordToTrash("goal", "b", 1);
  assert.equal(records.goals.length, 1);
  await context.restoreTrashRecord(trashed.id, trashed.revision);
  assert.equal(records.goals.length, 2);
});

test("stale revisions propagate a controlled conflict", async () => {
  const { context, records, port } = runtime();
  records.goals.push({ id: "a", payload: { id: "a", title: "A" }, schemaVersion: 2, revision: 2 });
  await context.configureV2Sync({ uid: "u1", deviceId: "d1", port });
  await context.loadV2Records("goals");
  records.goals[0].revision = 3;
  await assert.rejects(
    context.commitRecordMutation({ recordType: "goal", id: "a", payload: { id: "a", title: "stale" } }, 2),
    { code: "REVISION_CONFLICT" }
  );
});

test("Goal runtime authenticates into modern v2 and does not invoke legacy startup", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "goal-app.html"), "utf8");
  assert.match(html, /createModernV2Port/);
  assert.match(html, /await startGoalV2Sync\(\)/);
  assert.doesNotMatch(html, /await startGoalSync\(\)/);
  assert.match(html, /moveRecordToTrash\("goal"/);
});
