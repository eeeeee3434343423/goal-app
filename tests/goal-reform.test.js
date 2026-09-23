const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { spawn } = require("node:child_process");
const core = require("../goal-reform-core.js");

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
  context.GoalReformCore = core;
  context.window.GoalReformCore = core;
  vm.createContext(context);
  vm.runInContext(extractScript(), context, { filename: "goal-app.html" });
  return context;
}

function completePlan() {
  const plan = {
    version: 1, whyLayers: ["Build a sustainable income skill", "Earn independent income", "Gain freedom to build full time"],
    costOfInaction: "Another year without a repeatable offer",
    definition: "Earn $500 from one repeatable offer in a calendar month.",
    successEvidence: "A Stripe export for one calendar month shows at least $500.",
    exclusions: "No unrelated product rebuilds.", currentReality: "I have an audience of ten people and no paid offer.",
    research: [
      { question: "Comparable offer one", source: "https://example.com/one", insight: "Took 20 focused hours." },
      { question: "Comparable offer two", source: "https://example.com/two", insight: "Took 30 focused hours." },
      { question: "Comparable offer three", source: "https://example.com/three", insight: "Took 40 focused hours." },
    ],
    capacity: { hoursPerWeek: 10, constraints: "Two focused hours on weekdays." },
    campaigns: ["Validate the offer", "Launch", "Sell"].map((title, i) => ({
      id: `c${i + 1}`, title, result: `${i + 1} verified customer outcomes recorded`,
      estimate: { best: 8 + i * 2, likely: 12 + i * 2, worst: 20 + i * 2 },
      operations: [{ id: `o${i + 1}`, title: `Operation ${i + 1}`, missions: [{ id: `m${i + 1}`, text: `Write and publish deliverable ${i + 1}` }] }],
    })),
    nextAction: { text: "Draft the interview invitation.", minutes: 20 },
    obstacles: [{ if: "I miss a session", then: "I reschedule it within 24 hours" }],
    growth: { income: 5, skill: 4, health: 1, relationships: 2, freedom: 5 },
    deadlineDecision: null,
  };
  plan.deadlineDecision = { inputMode: "date", date: core.calculateDeadlineForecast(plan, "2026-09-23").dates.p50,
    rationale: "A coin-flip deadline creates focus.", assumptions: "Ten focused hours per week." };
  return plan;
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
    campaigns: completePlan().campaigns.concat([null]),
  }) });
  assert.equal(goal.goalPlan.research.length, 4, "empty research is preserved for editing but does not satisfy readiness");
  assert.equal(goal.goalPlan.campaigns.length, 3);
  assert.equal(goal.goalPlan.capacity.hoursPerWeek, 10);
  assert.equal(goal.goalPlan.deadlineDecision.inputMode, "date");
  assert.ok(goal.goalPlan.campaigns.every((campaign) => campaign.id));
});

test("P50 forecast is deterministic and duration-first evaluates the user's requested duration", () => {
  const context = createHarness();
  const plan = core.normalizeGoalPlan(completePlan());
  const first = core.calculateDeadlineForecast(plan, "2026-09-23");
  const second = core.calculateDeadlineForecast(plan, "2026-09-23");
  assert.deepEqual(JSON.parse(JSON.stringify(first)), JSON.parse(JSON.stringify(second)));
  assert.equal(first.ok, true);
  assert.ok(first.dates.p10 <= first.dates.p50 && first.dates.p50 <= first.dates.p90);
  plan.deadlineDecision = { ...plan.deadlineDecision, inputMode: "duration", requestedDurationDays: first.band.earliestDays };
  assert.deepEqual(core.validateDeadlineDecision(plan.deadlineDecision, first, "2026-09-23"), []);
  assert.equal(typeof context.normalize, "function", "the app delegates plan normalization to the injected core");
});

test("date-first validation permits only a calculated P40-P60 deadline", () => {
  const context = createHarness();
  const plan = core.normalizeGoalPlan(completePlan());
  const forecast = core.calculateDeadlineForecast(plan, "2026-09-23");
  plan.deadlineDecision.date = forecast.dates.p50;
  assert.deepEqual(core.validateDeadlineDecision(plan.deadlineDecision, forecast, "2026-09-23"), []);
  plan.deadlineDecision.date = "2026-09-24";
  assert.match(core.validateDeadlineDecision(plan.deadlineDecision, forecast, "2026-09-23").join(" "), /too aggressive/);
});

test("P50 forecasting fails closed when any planned operation lacks a valid estimate", () => {
  const context = createHarness();
  const raw = completePlan();
  raw.campaigns[1].estimate.likely = "";
  const plan = core.normalizeGoalPlan(raw);
  assert.equal(core.calculateDeadlineForecast(plan, "2026-09-23").ok, false);
  assert.ok(core.goalPlanReadiness(plan, { today: "2026-09-23" }).missing.some((item) => item.key === "campaigns"));
});

test("date-first forecast reports the pace required by the selected deadline", () => {
  const context = createHarness();
  const plan = core.normalizeGoalPlan(completePlan());
  const forecast = core.calculateDeadlineForecast(plan, "2026-09-23");
  const long = core.requiredHoursPerWeek(forecast, "2026-09-23", "2026-11-09");
  const short = core.requiredHoursPerWeek(forecast, "2026-09-23", "2026-10-20");
  assert.ok(short > long, "a shorter selected deadline must require a faster pace");
});

test("readiness blocks activation until the user supplies the full clarity plan", () => {
  const context = createHarness();
  const incomplete = context.normalize({ id: "draft", title: "Draft", goalPlan: { whyLayers: ["A reason."] } });
  const readiness = core.goalPlanReadiness(incomplete.goalPlan, { today: "2026-09-23" });
  assert.equal(readiness.ready, false);
  assert.ok(readiness.missing.some((item) => item.key === "definition"));
  assert.ok(readiness.missing.some((item) => item.key === "research"));
  const complete = context.normalize({ id: "ready", title: "Ready", goalPlan: completePlan() });
  assert.equal(core.goalPlanReadiness(complete.goalPlan, { today: "2026-09-23" }).ready, true);
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

test("reform activation leaves a draft unchanged when the focus transaction fails", async () => {
  const context = createHarness();
  const draft = readyFuture(context, "draft-1");
  draft.status = "draft";
  context.goals = [draft];
  const before = JSON.stringify(context.goals[0]);

  enableAtomicActivation(context, async () => { throw new Error("offline"); });
  assert.equal((await context.reformActivate("draft-1")).ok, false);
  assert.equal(JSON.stringify(context.goals[0]), before);
  assert.match(context.document.getElementById("saveStatus").textContent, /Activation blocked/);
});

test("isolated demo serves a signed-out 24-record copy without exposing other files", async () => {
  const child = spawn(process.execPath, [path.join(__dirname, "..", "scripts", "launch-reform-demo.js")], { stdio: ["ignore", "pipe", "pipe"] });
  try {
    const address = await new Promise((resolve, reject) => {
      let output = "";
      const timeout = setTimeout(() => reject(new Error("Demo did not start")), 5000);
      child.once("error", reject);
      child.once("exit", (code) => reject(new Error(`Demo exited ${code}: ${output}`)));
      child.stdout.on("data", (chunk) => {
        output += chunk;
        const match = output.match(/http:\/\/127\.0\.0\.1:\d+\//);
        if (match) { clearTimeout(timeout); resolve(match[0]); }
      });
    });
    const response = await fetch(address);
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(html, /window\.__SKIP_CLOUD_SAVE=true/);
    assert.match(html, /achieve\.goals\.v1/);
    assert.match(html, /goal-reform-ui\.js/);
    assert.equal((await fetch(new URL("/private.json", address))).status, 404);
  } finally {
    child.kill();
  }
});
