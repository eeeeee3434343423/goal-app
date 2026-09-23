const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const htmlPath = path.join(__dirname, "..", "goal-app.html");

function extractScript() {
  const html = fs.readFileSync(htmlPath, "utf8");
  const match = html.match(/<script>([\s\S]*)<\/script>/);
  assert.ok(match, "goal-app.html should contain one inline script block");
  return match[1];
}

function element() {
  return {
    value: "", checked: false, innerHTML: "", textContent: "", style: {}, files: [],
    classList: { add() {}, remove() {}, toggle() { return false; }, contains() { return false; } },
    click() {}, focus() {}, appendChild() {}, removeChild() {},
  };
}

function createHarness() {
  const elements = {};
  const context = {
    console, Date, Math, Blob: class Blob {}, URL: { createObjectURL() { return "blob:test"; } },
    FileReader: class FileReader {}, setTimeout() { return 0; }, clearTimeout() {}, setInterval() { return 0; }, clearInterval() {},
    alert() {}, confirm() { return true; }, prompt() { return null; },
    localStorage: { getItem() { return "[]"; }, setItem() {} },
    navigator: { clipboard: { writeText() { return Promise.resolve(); } } },
    document: {
      getElementById(id) { return elements[id] || (elements[id] = element()); },
      createElement() { return element(); },
    },
    window: { __SKIP_CLOUD_SAVE: true, addEventListener() {}, scrollTo() {} },
  };
  context.window.window = context.window;
  context.window.document = context.document;
  context.window.localStorage = context.localStorage;
  context.window.navigator = context.navigator;
  vm.createContext(context);
  vm.runInContext(extractScript(), context, { filename: "goal-app.html" });
  return context;
}

function completePlan() {
  return {
    version: 1,
    purpose: "Build a sustainable income skill.",
    definition: "Earn $500 from one repeatable offer in a calendar month.",
    lifeGrowth: "It builds an independent source of income.",
    successEvidence: "A Stripe export for one calendar month shows at least $500.",
    exclusions: "No unrelated product rebuilds.",
    currentReality: "I have an audience of ten people and no paid offer.",
    research: [
      { question: "Comparable offer one", source: "https://example.com/one", insight: "Took 20 focused hours." },
      { question: "Comparable offer two", source: "https://example.com/two", insight: "Took 30 focused hours." },
      { question: "Comparable offer three", source: "https://example.com/three", insight: "Took 40 focused hours." },
    ],
    capacity: { hoursPerWeek: 10, constraints: "Two focused hours on weekdays." },
    operations: [
      { title: "Validate the offer", result: "Three qualified conversations complete.", estimate: { optimisticHours: 8, likelyHours: 12, pessimisticHours: 20 }, missions: [{ text: "Write the interview invitation." }] },
      { title: "Launch", result: "Offer page is live.", estimate: { optimisticHours: 12, likelyHours: 18, pessimisticHours: 30 }, missions: [{ text: "Publish the offer page." }] },
      { title: "Sell", result: "First payment received.", estimate: { optimisticHours: 10, likelyHours: 16, pessimisticHours: 28 }, missions: [{ text: "Send five tailored offers." }] },
    ],
    nextAction: { text: "Draft the interview invitation.", scheduledFor: "2026-09-23" },
    deadlineDecision: { inputMode: "duration", requestedDurationDays: 35, rationale: "This is a credible stretch at ten focused hours per week.", assumptions: "I protect two focused hours on weekdays." },
  };
}

test("legacy goals remain unchanged when no reform plan exists", () => {
  const context = createHarness();
  const legacy = context.normalize({ id: "legacy", title: "Existing goal", unknown: { preserve: true } });
  assert.equal(legacy.goalPlan, null);
  const normalizedCollection = context.normalizeGoals([{ id: "legacy", title: "Existing goal" }]);
  assert.equal(Object.hasOwn(normalizedCollection[0], "goalPlan"), false, "legacy records are not rewritten just to add a null plan");
  assert.deepEqual(JSON.parse(JSON.stringify(legacy.unknown)), { preserve: true });
});

test("normalize preserves every Workshop plan field through a save round trip", () => {
  const context = createHarness();
  context.GoalReformCore = require("../goal-reform-core.js");
  const plan = context.GoalReformCore.normalizeGoalPlan({
    whyLayers: ["one", "two", "three"], costOfInaction: "A real cost.",
    campaigns: [{ title: "Campaign", result: "A measurable result of 10.", estimate: { best: 2, likely: 3, worst: 5 }, operations: [{ title: "Operation", missions: [{ text: "Mission" }] }] }],
    growth: { income: 5, skill: 4, health: 1, relationships: 1, freedom: 5 },
    obstacles: [{ if: "blocked", then: "ask for help" }], nextAction: { text: "Open the document", minutes: 10 }
  });
  const goal = context.normalize({ id: "workshop", title: "Workshop", goalPlan: plan });
  assert.deepEqual(JSON.parse(JSON.stringify(goal.goalPlan.whyLayers)), ["one", "two", "three"]);
  assert.equal(goal.goalPlan.campaigns.length, 1);
  assert.equal(goal.goalPlan.growth.income, 5);
  assert.equal(goal.goalPlan.obstacles.length, 1);
  assert.equal(goal.goalPlan.nextAction.minutes, 10);
});

test("goal plan normalization preserves valid planning inputs and removes malformed entries", () => {
  const context = createHarness();
  const goal = context.normalize({ id: "planned", title: "Planned", goalPlan: Object.assign(completePlan(), {
    research: completePlan().research.concat([null, { question: "", source: "", insight: "" }]),
    operations: completePlan().operations.concat([null]),
  }) });
  assert.equal(goal.goalPlan.research.length, 3);
  assert.equal(goal.goalPlan.operations.length, 3);
  assert.equal(goal.goalPlan.capacity.hoursPerWeek, 10);
  assert.equal(goal.goalPlan.deadlineDecision.inputMode, "duration");
  assert.ok(goal.goalPlan.operations.every((operation) => operation.id));
});

test("P50 forecast is deterministic and duration-first evaluates the user's requested duration", () => {
  const context = createHarness();
  const plan = context.normalizeGoalPlan(completePlan(), { goalIds: {} });
  const first = context.calculateDeadlineForecast(plan, "2026-09-22", "planned");
  const second = context.calculateDeadlineForecast(plan, "2026-09-22", "planned");
  assert.deepEqual(JSON.parse(JSON.stringify(first)), JSON.parse(JSON.stringify(second)));
  assert.ok(first.p10Date <= first.p50Date && first.p50Date <= first.p90Date);
  assert.equal(first.selectedDate, context.planningAddDays("2026-09-22", 35));
  assert.ok(Number.isInteger(first.selectedDatePercentile));
  assert.ok(first.requiredHoursPerWeek > 0);
});

test("date-first validation permits only a calculated P40-P60 deadline", () => {
  const context = createHarness();
  const plan = context.normalizeGoalPlan(completePlan(), { goalIds: {} });
  const midpoint = context.calculateDeadlineForecast(plan, "2026-09-22", "planned");
  plan.deadlineDecision = Object.assign({}, plan.deadlineDecision, { inputMode: "date", date: midpoint.p50Date });
  const forecast = context.calculateDeadlineForecast(plan, "2026-09-22", "planned");
  assert.deepEqual(JSON.parse(JSON.stringify(context.validateDeadlineDecision(plan.deadlineDecision, forecast, "2026-09-22"))), []);
  plan.deadlineDecision.date = "2026-09-23";
  const impossible = context.calculateDeadlineForecast(plan, "2026-09-22", "planned");
  assert.match(context.validateDeadlineDecision(plan.deadlineDecision, impossible, "2026-09-22").join(" "), /P40-P60/);
});

test("P50 forecasting fails closed when any planned operation lacks a valid estimate", () => {
  const context = createHarness();
  const raw = completePlan();
  raw.operations[1].estimate.likelyHours = "";
  const plan = context.normalizeGoalPlan(raw, { goalIds: {} });
  assert.equal(context.calculateDeadlineForecast(plan, "2026-09-22", "planned"), null);
  assert.ok(context.goalPlanReadiness(context.normalize({ id: "draft", title: "Draft", goalPlan: raw }), "2026-09-22").missing.includes("P50 deadline"));
});

test("date-first forecast reports the pace required by the selected deadline", () => {
  const context = createHarness();
  const plan = context.normalizeGoalPlan(completePlan(), { goalIds: {} });
  plan.deadlineDecision = Object.assign({}, plan.deadlineDecision, { inputMode: "date", date: "2026-11-09" });
  const long = context.calculateDeadlineForecast(plan, "2026-09-22", "planned");
  plan.deadlineDecision.date = "2026-10-20";
  const short = context.calculateDeadlineForecast(plan, "2026-09-22", "planned");
  assert.ok(short.requiredHoursPerWeek > long.requiredHoursPerWeek, "a shorter selected deadline must require a faster pace");
});

test("readiness blocks activation until the user supplies the full clarity plan", () => {
  const context = createHarness();
  const incomplete = context.normalize({ id: "draft", title: "Draft", goalPlan: { purpose: "A reason." } });
  const readiness = context.goalPlanReadiness(incomplete);
  assert.equal(readiness.ready, false);
  assert.ok(readiness.missing.includes("definition"));
  assert.ok(readiness.missing.includes("research"));
  const complete = context.normalize({ id: "ready", title: "Ready", goalPlan: completePlan() });
  assert.equal(context.goalPlanReadiness(complete, "2026-09-22").ready, true);
});

function readyFuture(context, id) {
  return context.normalize({
    id, title: "Launch the focused offer", goalType: "future", status: "future",
    deadline: "2027-01-30", goalPlan: completePlan(), why: "Build a focused income skill.",
    smallGoals: [
      { what: "Interview three buyers", why: "Evidence beats guesses." },
      { what: "Publish the offer", why: "A real offer makes feedback possible." },
      { what: "Send five proposals", why: "Direct outreach creates the first sales conversations." },
    ],
  });
}

function enableAtomicActivation(context, commit) {
  context.cloudSave.ready = true;
  context.cloudSave.user = { uid: "u1" };
  context.cloudSave.initialReadDone = true;
  context.cloudSave.startupPending = false;
  context.authoritativeStateReady = true;
  context.window.__V2_SYNC_ACTIVE = true;
  context.window.getV2RecordRevision = () => 3;
  context.window.readGoalFocus = async () => ({ activeGoalId: null, revision: 2 });
  context.window.commitGoalActivation = commit;
}

test("Future activation uses the atomic focus mutation and installs only its returned goal", async () => {
  const context = createHarness();
  context.goals = [readyFuture(context, "future-1")];
  let submitted;
  enableAtomicActivation(context, async (mutation, goalRevision, focusRevision) => {
    submitted = { mutation, goalRevision, focusRevision };
    return {
      goal: { id: "future-1", payload: mutation.payload, schemaVersion: 2, revision: 4 },
      focus: { activeGoalId: "future-1", revision: 3 },
    };
  });

  assert.equal(await context.activateFutureGoal("future-1"), true);
  assert.equal(submitted.goalRevision, 3);
  assert.equal(submitted.focusRevision, 2);
  assert.equal(submitted.mutation.recordType, "goal");
  assert.equal(context.goals[0].status, "active");
  assert.equal(context.goals[0].goalType, "active");
  assert.equal(context.goalFocus.activeGoalId, "future-1");
});

test("active finalization uses atomic activation and signed-out or focus-read failures leave the goal unchanged", async () => {
  const context = createHarness();
  const draft = readyFuture(context, "draft-1");
  draft.status = "draft";
  context.goals = [draft];
  const before = JSON.stringify(context.goals[0]);

  assert.equal(await context.finalizeGoal("draft-1", "active"), false);
  assert.equal(JSON.stringify(context.goals[0]), before);

  enableAtomicActivation(context, async () => { throw new Error("offline"); });
  assert.equal(await context.finalizeGoal("draft-1", "active"), false);
  assert.equal(JSON.stringify(context.goals[0]), before);
  assert.match(context.document.getElementById("saveStatus").textContent, /Activation blocked/);
});
