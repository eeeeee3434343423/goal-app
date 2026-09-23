"use strict";

/*
 * Release safety: the app ships before the Firestore focus-record rules.
 * Until they are deployed, the focus transaction is denied; activation and
 * completion must fall back to the ordinary record sync (the one-goal rule is
 * still enforced against the synced goals), and pick the atomic path up
 * automatically once the rules exist.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const core = require("../goal-reform-core.js");

function element() {
  return {
    value: "", checked: false, innerHTML: "", textContent: "", style: {}, files: [],
    classList: { add() {}, remove() {}, toggle() { return false; }, contains() { return false; } },
    click() {}, focus() {}, appendChild() {}, removeChild() {}, setAttribute() {}, getAttribute() { return null; },
  };
}

function createHarness() {
  const elements = {};
  const context = {
    console: { log() {}, warn() {}, error() {} }, Date, Math, Blob: class Blob {}, URL: { createObjectURL() { return "blob:test"; } },
    FileReader: class FileReader {}, setTimeout() { return 0; }, clearTimeout() {}, setInterval() { return 0; }, clearInterval() {},
    alert() {}, confirm() { return true; }, prompt() { return null; },
    localStorage: { getItem() { return "[]"; }, setItem() {} },
    navigator: { clipboard: { writeText() { return Promise.resolve(); } } },
    document: { getElementById(id) { return elements[id] || (elements[id] = element()); }, createElement() { return element(); } },
    window: { __SKIP_CLOUD_SAVE: true, addEventListener() {}, scrollTo() {} },
  };
  Object.assign(context.window, { window: context.window, document: context.document, localStorage: context.localStorage, navigator: context.navigator, GoalReformCore: core });
  context.GoalReformCore = core;
  vm.createContext(context);
  const html = fs.readFileSync(path.join(__dirname, "..", "goal-app.html"), "utf8");
  vm.runInContext(html.match(/<script>([\s\S]*)<\/script>/)[1], context, { filename: "goal-app.html" });
  return { context, elements };
}

function readyPlan(today) {
  const plan = {
    whyLayers: ["one reason", "a deeper reason", "the deepest reason"], costOfInaction: "A lost year",
    definition: "Earn $500 in one calendar month", successEvidence: "Stripe report of $500", exclusions: "No ads",
    research: [1, 2, 3].map((i) => ({ question: "Q" + i, source: "https://example.com/" + i, insight: "Took 4 months" })),
    campaigns: [1, 2, 3].map((i) => ({ id: "c" + i, title: "Campaign " + i, result: i + " paying customers",
      estimate: { best: 6, likely: 10, worst: 20 }, operations: [{ id: "o" + i, title: "Op", missions: [{ id: "m" + i, text: "Do it" }] }] })),
    capacity: { hoursPerWeek: 14 }, nextAction: { text: "Open Stripe", minutes: 20 },
    obstacles: [{ if: "I skip", then: "I do 25 minutes" }], growth: { income: 5, skill: 4, health: 1, relationships: 2, freedom: 5 },
  };
  plan.deadlineDecision = { inputMode: "date", date: core.calculateDeadlineForecast(plan, today).dates.p50, rationale: "r", assumptions: "a" };
  return plan;
}

function signedIn(context) {
  Object.assign(context.cloudSave, { ready: true, user: { uid: "u1" }, initialReadDone: true, startupPending: false });
  context.authoritativeStateReady = true;
  context.window.__V2_SYNC_ACTIVE = true;
  context.window.getV2RecordRevision = () => 3;
}

function denied() {
  const e = new Error("Missing or insufficient permissions.");
  e.code = "permission-denied";
  return e;
}

test("before the focus rules are deployed, activation falls back to the synced one-goal lock", async () => {
  const { context, elements } = createHarness();
  const today = context.activationToday();
  context.goals = [context.normalize({ id: "g1", title: "Ready goal", goalType: "future", status: "future", goalPlan: readyPlan(today) })];
  signedIn(context);
  context.window.readGoalFocus = async () => { throw denied(); };
  context.window.commitGoalActivation = async () => { throw denied(); };
  assert.equal(await context.activatePlannedGoal("g1"), true);
  assert.equal(context.goals[0].goalType, "active");
  assert.equal(context.goals[0].status, "active");
  assert.match(elements.saveStatus.textContent, /focus lock via goal sync/);
});

test("the fallback still refuses a second goal while one is active", async () => {
  const { context } = createHarness();
  const today = context.activationToday();
  context.goals = [
    context.normalize({ id: "a", title: "Current focus", goalType: "active", status: "active" }),
    context.normalize({ id: "g2", title: "Second", goalType: "future", status: "future", goalPlan: readyPlan(today) }),
  ];
  signedIn(context);
  let transactions = 0;
  context.window.readGoalFocus = async () => { transactions++; throw denied(); };
  context.window.commitGoalActivation = async () => { transactions++; throw denied(); };
  const res = await context.reformActivate("g2", { today });
  assert.equal(res.ok, false);
  assert.match(res.message, /Complete "Current focus" first/);
  assert.equal(context.goals[1].goalType, "future");
  assert.equal(transactions, 0, "refused before touching the cloud");
});

test("other activation failures are still refused, not silently activated", async () => {
  const { context } = createHarness();
  const today = context.activationToday();
  context.goals = [context.normalize({ id: "g1", title: "Ready goal", goalType: "future", status: "future", goalPlan: readyPlan(today) })];
  signedIn(context);
  context.window.readGoalFocus = async () => ({ activeGoalId: null, revision: 0 });
  context.window.commitGoalActivation = async () => { throw new Error("offline"); };
  assert.equal(await context.activatePlannedGoal("g1"), false);
  assert.equal(context.goals[0].goalType, "future");
});

test("completion without a focus record falls back to the ordinary completion", async () => {
  for (const failure of [denied(), Object.assign(new Error("no focus"), { code: "FOCUS_MISMATCH", activeGoalId: null })]) {
    const { context } = createHarness();
    context.goals = [context.normalize({ id: "a", title: "Active goal", goalType: "active", status: "active" })];
    signedIn(context);
    context.window.readGoalFocus = async () => ({ activeGoalId: null, revision: 0 });
    context.window.commitGoalCompletion = async () => { throw failure; };
    const res = await context.reformComplete("a");
    assert.equal(res.ok, true, failure.code);
    assert.ok(context.goals[0].achievedAt, "completed through the ordinary path");
    assert.equal(context.goals[0].outcome, "completed");
    assert.equal(context.goals.filter(context.holdsFocus).length, 0, "the slot is free");
  }
});

test("a focus record held by a different goal still blocks completion and rolls back", async () => {
  const { context } = createHarness();
  context.goals = [context.normalize({ id: "a", title: "Active goal", goalType: "active", status: "active" })];
  signedIn(context);
  context.window.readGoalFocus = async () => ({ activeGoalId: "other", revision: 4 });
  context.window.commitGoalCompletion = async () => { throw Object.assign(new Error("mismatch"), { code: "FOCUS_MISMATCH", activeGoalId: "other" }); };
  const before = JSON.stringify(context.goals[0]);
  const res = await context.reformComplete("a");
  assert.equal(res.ok, false);
  assert.equal(JSON.stringify(context.goals[0]), before, "rolled back byte-identical");
});

test("Black and orange is the default theme", () => {
  const { context } = createHarness();
  assert.equal(context.appSettings.theme, "black-orange");
  const html = fs.readFileSync(path.join(__dirname, "..", "goal-app.html"), "utf8");
  assert.match(html, /<html lang="en" data-theme="black-orange">/, "no blue flash before the script runs");
});
