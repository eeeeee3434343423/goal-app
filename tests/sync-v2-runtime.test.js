"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("existing v2 goal records win over stale legacy payloads during migration", () => {
  const api = fs.readFileSync(path.join(__dirname, "..", "sync-v2-api.js"), "utf8");
  assert.doesNotMatch(api, /Legacy migration conflict/);
  assert.match(api, /if \(existingById\[record\.id\] \|\| trashedById\[record\.id\]\) continue;/);
});

function runtime() {
  const records = { goals: [], hubApps: [], trash: [], changeLog: [], focus: null };
  const listeners = {};
  const document = {
    readyState: "complete",
    documentElement: { setAttribute() {} },
    body: { appendChild() {} },
    getElementById() { return null; },
    createElement() {
      return {
        style: {},
        setAttribute() {},
        appendChild() {},
        addEventListener(type, fn) { listeners[type] = fn; }
      };
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
    async readFocus() {
      return structuredClone(records.focus || { activeGoalId: null, revision: 0 });
    },
    async commitGoalActivation(mutation, expectedGoalRevision, expectedFocusRevision, deviceId) {
      const index = records.goals.findIndex((item) => item.id === mutation.id);
      const current = index < 0 ? null : records.goals[index];
      const goalRevision = current ? current.revision : 0;
      const focusRevision = records.focus ? records.focus.revision : 0;
      if (records.focus && records.focus.activeGoalId !== null && records.focus.activeGoalId !== mutation.id) {
        const error = new Error("Complete the current active goal before activating another.");
        error.code = "FOCUS_LOCKED";
        error.activeGoalId = records.focus.activeGoalId;
        throw error;
      }
      if (goalRevision !== expectedGoalRevision || focusRevision !== expectedFocusRevision) {
        const error = new Error("conflict"); error.code = "REVISION_CONFLICT"; throw error;
      }
      const goal = { id: mutation.id, payload: structuredClone(mutation.payload), schemaVersion: 2, revision: goalRevision + 1, updatedBy: deviceId };
      const focus = { activeGoalId: mutation.id, revision: focusRevision + 1, updatedBy: deviceId };
      if (index < 0) records.goals.push(goal); else records.goals[index] = goal;
      records.focus = focus;
      records.changeLog.push({ operation: current ? "update" : "create", recordType: "goal", recordId: mutation.id });
      return { goal: structuredClone(goal), focus: structuredClone(focus) };
    },
    async commitGoalCompletion(mutation, expectedGoalRevision, expectedFocusRevision, deviceId) {
      const index = records.goals.findIndex((item) => item.id === mutation.id);
      const current = index < 0 ? null : records.goals[index];
      const goalRevision = current ? current.revision : 0;
      const focusRevision = records.focus ? records.focus.revision : 0;
      if (!mutation.payload || (mutation.payload.achievedAt == null && mutation.payload.outcome == null)) {
        throw new TypeError("Goal completion requires achievedAt or outcome.");
      }
      if (!records.focus || records.focus.activeGoalId !== mutation.id) {
        const error = new Error("Only the current active goal can be completed.");
        error.code = "FOCUS_MISMATCH";
        error.activeGoalId = records.focus ? records.focus.activeGoalId : null;
        throw error;
      }
      if (goalRevision !== expectedGoalRevision || focusRevision !== expectedFocusRevision) {
        const error = new Error("conflict"); error.code = "REVISION_CONFLICT"; throw error;
      }
      const goal = { id: mutation.id, payload: structuredClone(mutation.payload), schemaVersion: 2, revision: goalRevision + 1, updatedBy: deviceId };
      const focus = { activeGoalId: null, revision: focusRevision + 1, updatedBy: deviceId };
      records.goals[index] = goal;
      records.focus = focus;
      records.changeLog.push({ operation: "update", recordType: "goal", recordId: mutation.id });
      return { goal: structuredClone(goal), focus: structuredClone(focus) };
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

function appClient(port, localGoals, revisions) {
  const html = fs.readFileSync(path.join(__dirname, "..", "goal-app.html"), "utf8");
  const inline = html.match(/<script>([\s\S]*)<\/script>/);
  assert.ok(inline);
  const elements = {};
  const element = () => ({ value: "", checked: false, innerHTML: "", textContent: "", style: {}, files: [],
    classList: { add() {}, remove() {}, toggle() { return false; }, contains() { return false; } },
    click() {}, focus() {}, appendChild() {}, removeChild() {} });
  const localStorage = { getItem() { return "[]"; }, setItem() {} };
  const window = { __SKIP_CLOUD_SAVE: true, __V2_SYNC_ACTIVE: true, addEventListener() {}, scrollTo() {},
    readGoalFocus: () => port.readFocus(),
    commitGoalActivation: (mutation, goalRevision, focusRevision) => port.commitGoalActivation(mutation, goalRevision, focusRevision, "client"),
    commitGoalCompletion: (mutation, goalRevision, focusRevision) => port.commitGoalCompletion(mutation, goalRevision, focusRevision, "client"),
    getV2RecordRevision: (_, id) => revisions[id] };
  const context = { window, console, Date, Math, Blob: class Blob {}, URL: { createObjectURL() { return "blob:test"; } },
    FileReader: class FileReader {}, setTimeout() { return 0; }, clearTimeout() {}, setInterval() { return 0; }, clearInterval() {},
    alert() {}, confirm() { return true; }, prompt() { return null; }, localStorage,
    navigator: { clipboard: { writeText() { return Promise.resolve(); } } },
    document: { getElementById(id) { return elements[id] || (elements[id] = element()); }, createElement: element },
    GoalReformCore: require("../goal-reform-core.js") };
  Object.assign(window, { window, document: context.document, localStorage, navigator: context.navigator, GoalReformCore: context.GoalReformCore });
  vm.createContext(context);
  vm.runInContext(inline[1], context, { filename: "goal-app.html" });
  context.goals = localGoals.map((goal) => context.normalize(goal));
  context.cloudSave.ready = true;
  context.cloudSave.user = { uid: "u1" };
  context.cloudSave.initialReadDone = true;
  context.cloudSave.startupPending = false;
  context.authoritativeStateReady = true;
  return context;
}

function readyGoal(id, status) {
  const core = require("../goal-reform-core.js");
  const plan = { whyLayers: ["Build income", "Create independence", "Work on my own terms"],
    costOfInaction: "Another year without independent income", definition: "Earn $500 in a calendar month",
    successEvidence: "Stripe export shows $500 in one month", exclusions: "No mobile app",
    research: [1, 2, 3].map((n) => ({ source: `Interview ${n}`, insight: `Customer ${n} would pay $20` })),
    campaigns: [1, 2, 3].map((n) => ({ id: `c${n}`, title: `Campaign ${n}`,
      result: `${n} validated customer outcomes recorded`, estimate: { best: 5, likely: 8, worst: 13 },
      operations: [{ title: `Operation ${n}`, missions: [{ text: `Publish deliverable ${n}` }] }] })),
    capacity: { hoursPerWeek: 10, constraints: "Two hours weekdays" },
    nextAction: { text: "Write the first draft", minutes: 20 },
    obstacles: [{ if: "I miss a session", then: "I reschedule within 24 hours" }],
    growth: { income: 5, skill: 4, health: 1, relationships: 2, freedom: 5 } };
  plan.deadlineDecision = { inputMode: "date", date: core.calculateDeadlineForecast(plan, "2026-09-23").dates.p50,
    rationale: "A coin-flip date sharpens focus", assumptions: "Ten hours weekly" };
  return { id, title: id, goalType: status === "active" ? "active" : "future", status, goalPlan: plan };
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

test("activation atomically records one canonical focus and its goal mutation", async () => {
  const { context, records, port } = runtime();
  records.goals.push({ id: "planned", payload: { id: "planned", title: "Plan" }, schemaVersion: 2, revision: 4 });
  await context.configureV2Sync({ uid: "u1", deviceId: "d1", port });
  await context.loadV2Records("goals");

  assert.deepEqual(await context.readGoalFocus(), { activeGoalId: null, revision: 0 });
  const result = await context.commitGoalActivation(
    { recordType: "goal", id: "planned", payload: { id: "planned", title: "Plan", status: "active" } },
    4,
    0
  );

  assert.equal(result.goal.revision, 5);
  assert.deepEqual(result.focus, { activeGoalId: "planned", revision: 1, updatedBy: "d1" });
  assert.equal(records.goals[0].payload.status, "active");
  assert.equal(records.focus.activeGoalId, "planned");
  assert.equal(records.changeLog.at(-1).recordId, "planned");
});

test("a second client is refused while another goal owns canonical focus", async () => {
  const { context, records, port } = runtime();
  records.goals.push(
    { id: "first", payload: { id: "first", title: "First" }, schemaVersion: 2, revision: 1 },
    { id: "second", payload: { id: "second", title: "Second" }, schemaVersion: 2, revision: 1 }
  );
  await context.configureV2Sync({ uid: "u1", deviceId: "d1", port });
  await context.loadV2Records("goals");
  await context.readGoalFocus();
  await context.commitGoalActivation({ recordType: "goal", id: "first", payload: { id: "first", status: "active" } }, 1, 0);

  await assert.rejects(
    context.commitGoalActivation({ recordType: "goal", id: "second", payload: { id: "second", status: "active" } }, 1, 0),
    (error) => error && error.code === "FOCUS_LOCKED" && error.activeGoalId === "first"
  );
  assert.equal(records.focus.activeGoalId, "first");
  assert.equal(records.goals.find((goal) => goal.id === "second").revision, 1);
});

test("completion atomically records completion and releases canonical focus", async () => {
  const { context, records, port } = runtime();
  records.goals.push(
    { id: "first", payload: { id: "first", status: "active" }, schemaVersion: 2, revision: 1 },
    { id: "second", payload: { id: "second", status: "future" }, schemaVersion: 2, revision: 1 }
  );
  records.focus = { activeGoalId: "first", revision: 4 };
  await context.configureV2Sync({ uid: "u1", deviceId: "d1", port });
  await context.loadV2Records("goals");

  const completed = await context.commitGoalCompletion(
    { recordType: "goal", id: "first", payload: { id: "first", status: "done", achievedAt: "2026-09-23" } },
    1,
    4
  );
  assert.equal(completed.goal.revision, 2);
  assert.equal(completed.focus.activeGoalId, null);
  assert.equal(records.focus.activeGoalId, null);

  const activated = await context.commitGoalActivation(
    { recordType: "goal", id: "second", payload: { id: "second", status: "active" } },
    1,
    5
  );
  assert.equal(activated.focus.activeGoalId, "second");
});

test("app clients enforce canonical focus, roll back failed completion, then permit the next goal", async () => {
  const { records, port } = runtime();
  const x = readyGoal("X", "future");
  const y = readyGoal("Y", "future");
  records.goals.push(
    { id: "X", payload: structuredClone(x), revision: 1, schemaVersion: 2 },
    { id: "Y", payload: structuredClone(y), revision: 1, schemaVersion: 2 }
  );
  const aRevisions = { X: 1, Y: 1 };
  const a = appClient(port, [x, y], aRevisions);
  const b = appClient(port, [x, y], { X: 2, Y: 1 });
  assert.equal((await a.reformActivate("X", { today: "2026-09-23" })).ok, true);
  aRevisions.X = 2;
  assert.equal(records.focus.activeGoalId, "X");
  const yBefore = JSON.stringify(b.goals.find((goal) => goal.id === "Y"));
  const refused = await b.reformActivate("Y", { today: "2026-09-23" });
  assert.equal(refused.ok, false);
  assert.match(refused.message, /Complete "X" first/);
  assert.equal(JSON.stringify(b.goals.find((goal) => goal.id === "Y")), yBefore);
  assert.equal(records.goals.find((goal) => goal.id === "Y").revision, 1);

  let ordinarySyncCalls = 0;
  a.syncV2Records = async () => { ordinarySyncCalls++; };
  const completedBefore = JSON.stringify(a.goals.find((goal) => goal.id === "X"));
  const originalCommit = a.window.commitGoalCompletion;
  a.window.commitGoalCompletion = async () => { throw new Error("offline"); };
  assert.equal((await a.reformComplete("X")).ok, false);
  assert.equal(JSON.stringify(a.goals.find((goal) => goal.id === "X")), completedBefore, "local goal must roll back byte-identically");
  assert.equal(records.focus.activeGoalId, "X");
  assert.equal(ordinarySyncCalls, 0, "completion must not start an ordinary goal sync while the focus transaction is pending");
  a.window.commitGoalCompletion = originalCommit;
  assert.equal((await a.reformComplete("X")).ok, true);
  assert.equal(records.goals.find((goal) => goal.id === "X").payload.outcome, "completed");
  assert.ok(records.goals.find((goal) => goal.id === "X").payload.achievedAt);
  assert.equal(records.focus.activeGoalId, null);
  assert.equal(ordinarySyncCalls, 0);
  assert.equal((await b.reformActivate("Y", { today: "2026-09-23" })).ok, true);
  assert.equal(records.focus.activeGoalId, "Y");
});

test("completion cannot release another goal's canonical focus", async () => {
  const { context, records, port } = runtime();
  records.goals.push(
    { id: "first", payload: { id: "first", status: "active" }, schemaVersion: 2, revision: 1 },
    { id: "second", payload: { id: "second", status: "future" }, schemaVersion: 2, revision: 1 }
  );
  records.focus = { activeGoalId: "first", revision: 1 };
  await context.configureV2Sync({ uid: "u1", deviceId: "d1", port });

  await assert.rejects(
    context.commitGoalCompletion(
      { recordType: "goal", id: "second", payload: { id: "second", achievedAt: "2026-09-23" } },
      1,
      1
    ),
    { code: "FOCUS_MISMATCH" }
  );
  assert.equal(records.focus.activeGoalId, "first");
  assert.equal(records.goals.find((goal) => goal.id === "second").revision, 1);
});

test("activation rejects unavailable and malformed focus adapters without locally changing a goal", async () => {
  const { context, records, port } = runtime();
  records.goals.push({ id: "planned", payload: { id: "planned" }, schemaVersion: 2, revision: 1 });
  delete port.commitGoalActivation;
  await context.configureV2Sync({ uid: "u1", deviceId: "d1", port });
  await assert.rejects(
    context.commitGoalActivation({ recordType: "goal", id: "planned", payload: { id: "planned", status: "active" } }, 1, 0),
    /does not support atomic goal activation/
  );
  assert.equal(records.goals[0].revision, 1);
  assert.equal(records.focus, null);
});

test("a malformed focus read is rejected before activation", async () => {
  const { context, port } = runtime();
  port.readFocus = async () => ({ activeGoalId: "", revision: 1 });
  await context.configureV2Sync({ uid: "u1", deviceId: "d1", port });
  await assert.rejects(context.readGoalFocus(), /Invalid cloud goal focus/);
});

test("Goal runtime authenticates into modern v2 and does not invoke legacy startup", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "goal-app.html"), "utf8");
  const modernPort = fs.readFileSync(path.join(__dirname, "..", "sync-v2-firestore-modern.js"), "utf8");
  assert.match(html, /createModernV2Port/);
  assert.match(html, /startGoalV2Sync\(\)\.catch\(handleInitialCloudSyncFailure\)/);
  assert.doesNotMatch(html, /await startGoalSync\(\)/);
  assert.match(html, /moveRecordToTrash\("goal"/);
  assert.match(modernPort, /recordType === "goal" \? ref\("appdata", "achieve\.goals\.v1"\) : null/);
  assert.match(modernPort, /durableTombstones\[recordId\] = Date\.now\(\)/);
  assert.match(modernPort, /tx\.set\(legacyRef, \{ tombstones: durableTombstones, updatedAt: Date\.now\(\) \}, \{ merge: true \}\)/);
});

test("Goal Recovery lists deleted goals without depending on Hub app access", async () => {
  const { context, records, port } = runtime();
  records.trash.push(
    { id: "goal__deleted", recordType: "goal", recordId: "deleted", payload: { id: "deleted", title: "Deleted goal" }, revision: 2 },
    { id: "hubApp__app", recordType: "hubApp", recordId: "app", payload: { id: "app", name: "App" }, revision: 1 },
    { id: "goal__live", recordType: "goal", recordId: "live", payload: { id: "live", title: "Old copy" }, revision: 1 }
  );
  records.goals.push({ id: "live", payload: { id: "live", title: "Live goal" }, schemaVersion: 2, revision: 2 });
  port.list = async (name) => {
    if (name === "hubApps") throw new Error("Goal Recovery must not query Hub apps");
    return records[name].map((item) => structuredClone(item));
  };
  await context.configureV2Sync({ uid: "u1", deviceId: "d1", port });

  const restorable = await context.loadRestorableV2Trash();

  assert.deepEqual(restorable.map((entry) => entry.recordId), ["deleted"]);
});

test("a stale second device cannot remigrate a goal that already exists in cloud Trash", async () => {
  const { context, records, port } = runtime();
  await context.configureV2Sync({ uid: "u1", deviceId: "device-a", port });
  await context.migrateLegacyEnvelopeOnce([{ id: "major-1", title: "Major goal" }], "goal");
  await context.loadV2Records("goals");
  await context.moveRecordToTrash("goal", "major-1", 1);
  assert.equal(records.goals.length, 0);
  assert.equal(records.trash.length, 1);

  await context.configureV2Sync({ uid: "u1", deviceId: "stale-device-b", port });
  const secondMigration = await context.migrateLegacyEnvelopeOnce([{ id: "major-1", title: "Major goal" }], "goal");

  assert.equal(secondMigration.migrated, 0);
  assert.equal(secondMigration.alreadyComplete, true);
  assert.equal(records.goals.length, 0);
  assert.equal(records.trash.length, 1);
});
