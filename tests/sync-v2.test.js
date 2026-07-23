"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const safety = require("../sync-safety-v2.js");

test("validates goal records and rejects executable or malformed data", () => {
  assert.equal(safety.validateCloudRecord({
    id: "goal-1", payload: { title: "Learn algebra", unknown: { kept: true } },
    schemaVersion: 2, revision: 1
  }, "goal").ok, true);
  assert.equal(safety.validateCloudRecord({
    id: "../bad", payload: {}, schemaVersion: 2, revision: 1
  }, "goal").ok, false);
  assert.equal(safety.validateCloudRecord({
    id: "goal-1", payload: { title: "<script>alert(1)</script>" },
    schemaVersion: 2, revision: 1
  }, "goal").ok, true, "payload text is data and must be escaped by renderers, not discarded");
});

test("legacy migration is idempotent and preserves unknown fields", () => {
  const legacy = [
    { id: "a", title: "A", custom: { future: true } },
    { title: "No id", type: "small", milestones: [{ text: "one" }] }
  ];
  const first = safety.migrateLegacyEnvelopeOnce(legacy, "goal");
  const second = safety.migrateLegacyEnvelopeOnce(legacy, "goal");
  assert.deepEqual(first.records, second.records);
  assert.deepEqual(first.records[0].payload.custom, { future: true });
  assert.equal(first.records.length, 2);
  assert.equal(new Set(first.records.map((record) => record.id)).size, 2);
  const reordered = safety.migrateLegacyEnvelopeOnce([legacy[1], legacy[0]], "goal");
  assert.deepEqual(
    new Set(reordered.records.map((record) => record.id)),
    new Set(first.records.map((record) => record.id)),
    "reordering legacy records must not create new cloud identities"
  );
});

test("different records merge while stale same-record writes conflict", () => {
  const store = safety.createMemoryRecordStore([
    { id: "a", payload: { title: "A" }, schemaVersion: 2, revision: 1 },
    { id: "b", payload: { title: "B" }, schemaVersion: 2, revision: 1 }
  ]);
  assert.equal(store.commit({ recordType: "goal", id: "a", payload: { title: "A2" } }, 1).revision, 2);
  assert.equal(store.commit({ recordType: "goal", id: "b", payload: { title: "B2" } }, 1).revision, 2);
  assert.throws(
    () => store.commit({ recordType: "goal", id: "a", payload: { title: "stale" } }, 1),
    { code: "REVISION_CONFLICT" }
  );
  assert.equal(store.get("a").payload.title, "A2");
});

test("delete is recoverable and abnormal shrink locks writes", () => {
  const store = safety.createMemoryRecordStore([
    { id: "a", payload: { title: "A" }, schemaVersion: 2, revision: 3 }
  ]);
  const trash = store.moveToTrash("goal", "a", 3);
  assert.equal(store.get("a"), null);
  assert.equal(trash.recordId, "a");
  const restored = store.restoreTrashRecord(trash.id, trash.revision);
  assert.equal(restored.payload.title, "A");
  assert.equal(restored.revision, 4);

  const previous = Array.from({ length: 10 }, (_, index) => ({ id: String(index) }));
  const risk = safety.computeDangerousChange(previous, [{ id: "0" }]);
  assert.equal(risk.dangerous, true);
  assert.equal(safety.enterReadOnlySafetyMode(risk.reason).readOnly, true);
});

test("recovery export contains records, trash, and audit history", async () => {
  const store = safety.createMemoryRecordStore([
    { id: "a", payload: { title: "A" }, schemaVersion: 2, revision: 1 }
  ]);
  store.moveToTrash("goal", "a", 1);
  const blob = safety.exportRecoveryBundle(store.snapshot());
  const json = JSON.parse(await blob.text());
  assert.equal(json.schemaVersion, 2);
  assert.equal(json.trash.length, 1);
  assert.equal(json.changeLog.length, 1);
});
