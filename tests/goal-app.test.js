const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const htmlPath = path.join(__dirname, "..", "goal-app.html");

function luminance(hex) {
  const channels = hex.match(/[0-9a-f]{2}/gi).map((value) => {
    const channel = parseInt(value, 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(foreground, background) {
  const light = Math.max(luminance(foreground), luminance(background));
  const dark = Math.min(luminance(foreground), luminance(background));
  return (light + 0.05) / (dark + 0.05);
}

test("dark theme gives controls explicit readable foregrounds", () => {
  const html = fs.readFileSync(htmlPath, "utf8");
  assert.match(html, /button\s*\{[^}]*color:var\(--text\)/s);
  assert.match(html, /\.mode-tabs\s+button\.active\s*\{[^}]*color:var\(--text\)/s);
  assert.match(html, /\.view-tabs\s+button\.active\s*\{[^}]*color:var\(--text\)/s);
  assert.match(html, /--soft:#030712/);
  assert.match(html, /--canvas:#07111F/);
  assert.match(html, /--soft2:#0B1728/);
  assert.match(html, /--text:#F5F7FA/);
  assert.match(html, /--text2:#9AA4B2/);
  assert.match(html, /\.primary\s*\{[^}]*color:var\(--soft\)/s);
  assert.ok(contrast("#030712", "#4DA3FF") >= 4.5);
});

test("legacy injected goals are removed by reserved ID without deleting user goals with matching titles", () => {
  const html = fs.readFileSync(htmlPath, "utf8");
  const start = html.indexOf("function normalizedGoalTitle");
  const end = html.indexOf("function goalPayloadEmpty", start);
  assert.ok(start >= 0 && end > start);
  const context = { Date };
  vm.createContext(context);
  vm.runInContext(html.slice(start, end), context);
  const current = [
    { id: "mine", title: "Belgian Malinois", custom: 42 },
    { id: "requested-belgian-malinois", title: "Belgian Malinois", goalType: "future" },
    { id: "requested-get-contacts", title: "Get Contacts", goalType: "future" },
    { id: "requested-paint-room", title: "Paint Room", achievedAt: 1 },
  ];
  const cleaned = context.removeRetiredSeedGoals(current);
  assert.deepEqual(JSON.parse(JSON.stringify(cleaned)), [{ id: "mine", title: "Belgian Malinois", custom: 42 }]);
  assert.doesNotMatch(html, /function ensureRequestedGoals/);
});

test("v2 startup moves only retired injected goal records to Trash before projecting goals", () => {
  const html = fs.readFileSync(htmlPath, "utf8");
  const startup = html.slice(html.indexOf("async function startGoalV2Sync"), html.indexOf("async function startGoalSync"));
  assert.match(startup, /var retiredRecords = retiredSeedGoalRecords\(cloudRecords\)/);
  assert.match(startup, /moveRecordToTrash\("goal", retiredRecords\[retiredIndex\]\.id, retiredRecords\[retiredIndex\]\.revision\)/);
  assert.match(startup, /migrationGoals = removeRetiredSeedGoals\(migrationGoals\)/);
  assert.doesNotMatch(startup, /ensureRequestedGoals/);
});

test("production demo loader is absent", () => {
  const html = fs.readFileSync(htmlPath, "utf8");
  assert.doesNotMatch(html, /onclick="loadDemoGoals\(\)"/);
  assert.doesNotMatch(html, /function loadDemoGoals\s*\(/);
  assert.doesNotMatch(html, /function demoGoals\s*\(/);
});

test("new goal form removes Steps 9 through 15 and combines milestone planning", () => {
  const html = fs.readFileSync(htmlPath, "utf8");
  const activeFields = html.slice(html.indexOf('<div id="activeFields">'), html.indexOf('<div class="modal-btns">'));

  assert.match(activeFields, /Milestones and small goals/);
  assert.match(activeFields, /id="fMilestones"/);
  assert.match(activeFields, /id="formSmallGoalsList"/);
  assert.match(activeFields, /addFormSmallGoal\(\)/);
  [
    "fEvidenceLog", "fExperimentHypothesis", "fExperimentMethod", "fExperimentMeasurement",
    "fExperimentDecision", "fWeakestPoint", "fWeakestPointDrill", "fFeedbackExpected",
    "fFeedbackActual", "fFeedbackCorrection", "fIdentityStatement", "fIdentityEvidence",
    "fThought", "fFact", "fReframe", "fRecoveryTrigger", "fRecoveryReset", "fRecoveryNextStep",
  ].forEach((id) => {
    assert.doesNotMatch(activeFields, new RegExp(`id="${id}"`));
    assert.doesNotMatch(html, new RegExp(`getElementById\\(["']${id}["']\\)`));
  });
  for (let step = 9; step <= 15; step += 1) assert.doesNotMatch(activeFields, new RegExp(`>${step} -`));
});

test("planning textareas have explicit accessible labels", () => {
  const html = fs.readFileSync(htmlPath, "utf8");
  assert.match(html, /<label[^>]*for="fSmallMilestones"[^>]*>Steps for this small goal<\/label>/);
  assert.match(html, /<label[^>]*for="fMilestones"[^>]*>Milestone goals<\/label>/);
  assert.match(html, /Small goals to create/);
  assert.match(html, /Steps for this child small goal/);
});

test("Active Goal cards show every child Small Goal with its own parent and step checkboxes", () => {
  const html = fs.readFileSync(htmlPath, "utf8");
  const card = html.slice(html.indexOf("function smallGoalsSummaryHtml"), html.indexOf("function victoryCardHtml"));
  assert.match(card, /Small Goal #/);
  assert.match(card, /toggleSmallGoal\(/);
  assert.match(card, /childSmallGoalStepsHtml\(g, item\)/);
});

test("mobile sign-in uses popup instead of cross-domain redirect", () => {
  const html = fs.readFileSync(htmlPath, "utf8");
  assert.match(html, /signInWithPopup\(cloudSave\.auth, provider\)/);
  assert.doesNotMatch(html, /signInWithRedirect\(cloudSave\.auth, provider\)/);
  assert.match(html, /auth\/popup-blocked/);
});

function extractScript() {
  const html = fs.readFileSync(htmlPath, "utf8");
  const match = html.match(/<script>([\s\S]*)<\/script>/);
  assert.ok(match, "goal-app.html should contain one script block");
  return match[1];
}

function createElement(id) {
  return {
    id,
    value: "",
    checked: false,
    innerHTML: "",
    textContent: "",
    style: {},
    files: [],
    classList: {
      values: new Set(),
      add(name) { this.values.add(name); },
      remove(name) { this.values.delete(name); },
      toggle(name, force) {
        const shouldAdd = force === undefined ? !this.values.has(name) : !!force;
        if (shouldAdd) this.values.add(name);
        else this.values.delete(name);
        return shouldAdd;
      },
      contains(name) { return this.values.has(name); },
    },
    click() {},
  };
}

function createHarness(seedGoals = []) {
  const elements = {};
  const ids = [
    "banner",
    "saveStatus",
    "viewToday",
    "viewDaily",
    "viewVictories",
    "activeList",
    "smallList",
    "dailyList",
    "futureList",
    "doneWrap",
    "overlay",
    "smallGoalsOverlay",
    "smallGoalsTitle",
    "smallGoalsHint",
    "newSmallGoalText",
    "newSmallGoalSteps",
    "smallGoalsList",
    "formTitle",
    "formHint",
    "modeTabs",
    "tabActive",
    "tabDaily",
    "tabSmall",
    "tabFuture",
    "titleHelp",
    "fTitle",
    "fFutureMonth",
    "fDescription",
    "smallFields",
    "dailyFields",
    "fDailyNotes",
    "fDailyMinimum",
    "fDailyStandard",
    "fDailyMax",
    "fTargetDate",
    "fSmallAbout",
    "fSmallMilestones",
    "activeFields",
    "futureFields",
    "fMdp",
    "fWhy",
    "fDeadline",
    "fStart",
    "fObstacles",
    "fSkills",
    "fMilestones",
    "formSmallGoalsList",
    "fEvidenceLog",
    "fExperimentHypothesis",
    "fExperimentMethod",
    "fExperimentMeasurement",
    "fExperimentDecision",
    "fWeakestPoint",
    "fWeakestPointDrill",
    "fFeedbackExpected",
    "fFeedbackActual",
    "fFeedbackCorrection",
    "fIdentityStatement",
    "fIdentityEvidence",
    "fThought",
    "fFact",
    "fReframe",
    "fRecoveryTrigger",
    "fRecoveryReset",
    "fRecoveryNextStep",
    "btnDelete",
    "saveButton",
    "importFile",
  ];
  ids.forEach((id) => {
    elements[id] = createElement(id);
  });

  const storage = {
    "achieve.goals.v1": JSON.stringify(seedGoals),
  };
  const context = {
    console,
    Date,
    Math,
    Blob: class Blob {
      constructor(parts, options) {
        this.parts = parts;
        this.options = options;
      }
    },
    URL: { createObjectURL() { return "blob:test"; } },
    FileReader: class FileReader {},
    alert(message) { context.lastAlert = message; },
    prompt() { return context.nextPromptValue; },
    confirm() { return context.confirmValue !== false; },
    localStorage: {
      getItem(key) {
        return Object.prototype.hasOwnProperty.call(storage, key) ? storage[key] : null;
      },
      setItem(key, value) {
        storage[key] = String(value);
      },
    },
    document: {
      getElementById(id) {
        if (!elements[id]) elements[id] = createElement(id);
        return elements[id];
      },
      createElement(tag) {
        return createElement(tag);
      },
    },
    window: {
      __storage: storage,
      __SKIP_CLOUD_SAVE: true,
      addEventListener() {},
      scrollTo() {},
    },
    prompt() { return context.promptValue ?? context.nextPromptValue; },
  };
  context.window.window = context.window;
  context.window.document = context.document;
  context.window.localStorage = context.localStorage;
  vm.createContext(context);
  vm.runInContext(extractScript(), context, { filename: "goal-app.html" });
  return { context, elements, storage };
}

test("save falls back to localStorage when Firebase is unavailable", () => {
  const { context, storage, elements } = createHarness([]);
  context.goals = [
    context.normalize({ id: "local", title: "Local fallback", goalType: "small" }),
  ];
  context.cloudSave.ready = false;

  assert.doesNotThrow(() => context.save());

  const saved = JSON.parse(storage["achieve.goals.v1"]);
  assert.equal(saved[0].title, "Local fallback");
  assert.equal(elements.saveStatus.textContent, "Cloud: sign in - saved here");
});

test("normalization preserves current exported milestone-only data", () => {
  const { context } = createHarness([]);
  const goal = context.normalize({
    id: "g1",
    title: "Old goal",
    milestones: [{ text: "Launch", done: true }, "Second step"],
  });

  assert.equal(goal.goalType, "active");
  assert.equal(goal.futureMonth, "");
  assert.deepEqual(JSON.parse(JSON.stringify(goal.milestones)), [
    { text: "Launch", done: true },
    { text: "Second step", done: false },
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(goal.smallGoals)), []);
});

test("normalization accepts lightweight future goals", () => {
  const { context } = createHarness([]);
  const goal = context.normalize({
    id: "f1",
    title: "Write a book",
    goalType: "future",
    futureMonth: "2027-03",
    description: "A longer-term writing idea.",
  });

  assert.equal(goal.goalType, "future");
  assert.equal(goal.futureMonth, "2027-03");
  assert.equal(goal.description, "A longer-term writing idea.");
});

test("normalization accepts standalone one-day small goals", () => {
  const { context } = createHarness([]);
  const goal = context.normalize({
    id: "s1",
    title: "Send the invoice",
    goalType: "small",
    description: "Quick admin win.",
    targetDate: "2026-07-12",
  });

  assert.equal(goal.goalType, "small");
  assert.equal(goal.title, "Send the invoice");
  assert.equal(goal.description, "Quick admin win.");
  assert.equal(goal.targetDate, "2026-07-12");
  assert.equal(goal.futureMonth, "");
  assert.deepEqual(JSON.parse(JSON.stringify(goal.smallGoals)), []);
});

test("normalization preserves standalone small goal milestones", () => {
  const { context } = createHarness([]);
  const goal = context.normalize({
    id: "s1",
    title: "Send the invoice",
    goalType: "small",
    milestones: [{ text: "Draft invoice", done: true }, "Send invoice"],
  });

  assert.equal(goal.goalType, "small");
  assert.deepEqual(JSON.parse(JSON.stringify(goal.milestones)), [
    { text: "Draft invoice", done: true },
    { text: "Send invoice", done: false },
  ]);
});

test("daily goals normalize with editable levels and empty completions", () => {
  const { context } = createHarness([]);
  const goal = context.normalize({
    id: "daily",
    title: "Complete Morning Routine",
    goalType: "daily",
    notes: "Anchor the day.",
    dailyMinimum: "Water",
    dailyStandard: "Water and cleanup",
    dailyMax: "Full routine",
  });

  assert.equal(goal.goalType, "daily");
  assert.equal(goal.notes, "Anchor the day.");
  assert.equal(goal.dailyMinimum, "Water");
  assert.equal(goal.dailyStandard, "Water and cleanup");
  assert.equal(goal.dailyMax, "Full routine");
  assert.deepEqual(JSON.parse(JSON.stringify(goal.dailyCompletions)), []);
});

test("progress counts milestone goals and small goals together", () => {
  const { context } = createHarness([]);
  const goal = context.normalize({
    milestones: [{ text: "M1", done: true }, { text: "M2", done: false }],
    smallGoals: [{ text: "S1", done: true }, { text: "S2", done: false }],
  });

  assert.equal(context.progress(goal), 50);
});

test("old string small goals normalize into ID-backed small goals", () => {
  const { context } = createHarness([]);
  const goal = context.normalize({ title: "Goal", smallGoals: ["Do thing"] });

  assert.equal(goal.smallGoals.length, 1);
  assert.equal(goal.smallGoals[0].text, "Do thing");
  assert.equal(goal.smallGoals[0].done, false);
  assert.equal(typeof goal.smallGoals[0].id, "string");
  assert.equal(typeof goal.smallGoals[0].createdAt, "number");
  assert.equal(goal.smallGoals[0].completedAt, null);
});

test("old object small goals preserve completion status", () => {
  const { context } = createHarness([]);
  const goal = context.normalize({ title: "Goal", smallGoals: [{ text: "Done thing", done: true }] });

  assert.equal(goal.smallGoals[0].text, "Done thing");
  assert.equal(goal.smallGoals[0].done, true);
  assert.equal(typeof goal.smallGoals[0].completedAt, "number");
});

test("new small goal objects preserve ID and dates", () => {
  const { context } = createHarness([]);
  const goal = context.normalize({
    title: "Goal",
    smallGoals: [{ id: "sg1", text: "Preserve me", done: true, createdAt: 111, completedAt: 222 }],
  });

  assert.deepEqual(JSON.parse(JSON.stringify(goal.smallGoals[0])), {
    id: "sg1",
    text: "Preserve me",
    done: true,
    createdAt: 111,
    completedAt: 222,
    steps: [],
  });
});

test("legacy child small goals normalize with empty nested steps", () => {
  const { context } = createHarness([]);
  const goal = context.normalize({ id: "active", title: "Active", smallGoals: [{ id: "child", text: "Legacy child", done: true, custom: "keep" }] });

  assert.deepEqual(JSON.parse(JSON.stringify(goal.smallGoals[0].steps)), []);
  assert.equal(goal.smallGoals[0].done, true);
  assert.equal(goal.smallGoals[0].custom, "keep");
});

test("child small goal can be added with Khan Academy steps without changing active progress", () => {
  const { context, storage } = createHarness([{ id: "active", title: "Finish Algebra 2", milestones: [{ text: "Enroll", done: true }] }]);
  const steps = ["Finish Unit 4 & 5", "Finish Unit 6 & 7", "Review Both", "Finish Unit 8"];

  context.addSmallGoal("active", "Finish Khan Academy Algebra 2", steps.join("\n"));

  let saved = JSON.parse(storage["achieve.goals.v1"])[0];
  assert.deepEqual(saved.smallGoals[0].steps.map((step) => step.text), steps);
  assert.equal(context.progress(context.goals[0]), 50);
  const childId = saved.smallGoals[0].id;
  const stepIds = saved.smallGoals[0].steps.map((step) => step.id);
  assert.equal(new Set(stepIds).size, 4);

  saved.smallGoals[0].steps.forEach((step) => context.toggleSmallGoalStep("active", childId, step.id));
  saved = JSON.parse(storage["achieve.goals.v1"])[0];
  assert.equal(saved.smallGoals[0].steps.every((step) => step.done), true);
  assert.equal(saved.smallGoals[0].done, false);
  assert.equal(context.progress(context.goals[0]), 50);

  context.toggleSmallGoal("active", childId);
  assert.equal(context.progress(context.goals[0]), 100);
  context.toggleSmallGoal("active", childId);
  assert.equal(context.progress(context.goals[0]), 50);
  assert.equal(context.goals[0].smallGoals[0].steps.every((step) => step.done), true);
});

test("standalone small-goal progress uses only its own milestone-backed steps", () => {
  const { context } = createHarness([]);
  const goal = context.normalize({
    id: "standalone",
    title: "Standalone",
    goalType: "small",
    milestones: [{ text: "First", done: true }, { text: "Second", done: false }],
    smallGoals: [{ id: "legacy-child", text: "Must not count", done: true, steps: [{ text: "Nested", done: true }] }],
  });

  assert.equal(context.progress(goal), 50);
});

test("small-goals manager exposes labeled title and nested-step editors", () => {
  const html = fs.readFileSync(htmlPath, "utf8");
  assert.match(html, /for="newSmallGoalSteps">Steps for this small goal<\/label>/);
  assert.match(html, /for="childTitle-/);
  assert.match(html, /for="childSteps-/);
  assert.match(html, /saveChildSmallGoalFromManager/);
});

test("nested child steps render only under their own child goal", () => {
  const { context, elements } = createHarness([{
    id: "active", title: "Active", smallGoals: [
      { id: "one", text: "First child", steps: [{ id: "one-step", text: "Only first", done: true }] },
      { id: "two", text: "Second child", steps: [{ id: "two-step", text: "Only second", done: false }] },
    ],
  }]);

  context.openSmallGoals("active");
  context.selectChildSmallGoal("active", "one");
  const html = elements.smallGoalsList.innerHTML;
  assert.match(html, /First child[\s\S]*Only first/);
  assert.doesNotMatch(html, /Only second/);
  assert.match(html, /1\/1 steps/);
  assert.match(html, /0\/1 steps/);
});

test("editing nested steps preserves duplicate IDs, independent states, and unknown fields", () => {
  const { context, storage } = createHarness([{
    id: "active", title: "Active", smallGoals: [{
      id: "child", text: "Practice", customChild: { keep: true }, steps: [
        { id: "step-a", text: "Review", done: true, createdAt: 1, completedAt: 2, source: "first" },
        { id: "step-b", text: "Review", done: false, createdAt: 3, completedAt: null, source: "second" },
        null,
      ],
    }],
  }]);

  context.saveChildSmallGoal("active", "child", "Practice updated", "Review\nReview\nNew step");
  let child = JSON.parse(storage["achieve.goals.v1"])[0].smallGoals[0];
  assert.equal(child.customChild.keep, true);
  assert.deepEqual(child.steps.map((step) => [step.id, step.done, step.source || null]), [
    ["step-a", true, "first"], ["step-b", false, "second"], [child.steps[2].id, false, null],
  ]);

  context.toggleSmallGoalStep("active", "child", "step-b");
  child = JSON.parse(storage["achieve.goals.v1"])[0].smallGoals[0];
  assert.deepEqual(child.steps.slice(0, 2).map((step) => step.done), [true, true]);
  assert.equal(typeof child.steps[1].completedAt, "number");
  assert.equal(child.done, false);
});

test("malformed nested steps fail closed and duplicate unsafe IDs normalize uniquely", () => {
  const { context } = createHarness([]);
  const goal = context.normalize({ id: "active", title: "Active", smallGoals: [{
    id: "child",
    text: "Child",
    steps: [null, 17, {}, { id: "x');bad", text: "Valid one", done: true }, { id: "x');bad", text: "Valid two", done: false }],
  }] });
  const steps = goal.smallGoals[0].steps;

  assert.deepEqual(steps.map((step) => step.text), ["Valid one", "Valid two"]);
  assert.equal(new Set(steps.map((step) => step.id)).size, 2);
  steps.forEach((step) => assert.match(step.id, /^[A-Za-z0-9_-]+$/));
  assert.deepEqual(steps.map((step) => step.done), [true, false]);
});

test("toggleSmallGoal flips one small goal by ID and persists timestamps", () => {
  const { context, storage } = createHarness([
    { id: "g1", title: "Goal", smallGoals: [{ id: "sg1", text: "Tiny step", done: false, createdAt: 100, completedAt: null }] },
  ]);

  context.toggleSmallGoal("g1", "sg1");

  let saved = JSON.parse(storage["achieve.goals.v1"]);
  assert.equal(saved[0].smallGoals[0].done, true);
  assert.equal(typeof saved[0].smallGoals[0].completedAt, "number");

  context.toggleSmallGoal("g1", "sg1");
  saved = JSON.parse(storage["achieve.goals.v1"]);
  assert.equal(saved[0].smallGoals[0].done, false);
  assert.equal(saved[0].smallGoals[0].completedAt, null);
});

test("addSmallGoal appends one goal and preserves existing goals", () => {
  const { context, storage } = createHarness([
    { id: "g1", title: "Goal", smallGoals: [{ id: "sg1", text: "Existing", done: false, createdAt: 100, completedAt: null }] },
  ]);

  context.addSmallGoal("g1", "New action");

  const saved = JSON.parse(storage["achieve.goals.v1"]);
  assert.equal(saved[0].smallGoals.length, 2);
  assert.equal(saved[0].smallGoals[0].id, "sg1");
  assert.equal(saved[0].smallGoals[1].text, "New action");
});

test("deleteSmallGoal removes only the selected small goal", () => {
  const { context, storage } = createHarness([
    { id: "g1", title: "Goal", smallGoals: [{ id: "sg1", text: "Keep", done: false }, { id: "sg2", text: "Delete", done: false }] },
  ]);

  context.deleteSmallGoal("g1", "sg2");

  const saved = JSON.parse(storage["achieve.goals.v1"]);
  assert.deepEqual(saved[0].smallGoals.map((item) => item.text), ["Keep"]);
  assert.equal(saved[0].smallGoalsTrash[0].text, "Delete");
  assert.equal(typeof saved[0].smallGoalsTrash[0].deletedAt, "number");
});

test("child small-goal deletion is confirmed, recoverable, and survives reload", () => {
  const seed = [{ id: "g1", title: "Goal", smallGoals: [{ id: "child", text: "Recover me", done: true, custom: { keep: 1 }, steps: [{ id: "step", text: "Nested", done: true, source: "legacy" }] }] }];
  const first = createHarness(seed);
  first.context.confirmValue = false;
  first.context.deleteSmallGoal("g1", "child");
  assert.equal(first.context.goals[0].smallGoals.length, 1);

  first.context.confirmValue = true;
  first.context.deleteSmallGoal("g1", "child");
  let saved = JSON.parse(first.storage["achieve.goals.v1"])[0];
  assert.equal(saved.smallGoals.length, 0);
  assert.equal(saved.smallGoalsTrash[0].id, "child");
  assert.equal(saved.smallGoalsTrash[0].steps[0].source, "legacy");
  assert.equal(saved.smallGoalsTrash[0].custom.keep, 1);

  const reloaded = createHarness(JSON.parse(first.storage["achieve.goals.v1"]));
  reloaded.context.restoreSmallGoal("g1", "child");
  saved = JSON.parse(reloaded.storage["achieve.goals.v1"])[0];
  assert.equal(saved.smallGoalsTrash.length, 0);
  assert.equal(saved.smallGoals[0].id, "child");
  assert.equal(saved.smallGoals[0].steps[0].done, true);
  assert.equal(saved.smallGoals[0].custom.keep, 1);
});

test("smallGoalSummary handles hundreds of items", () => {
  const { context } = createHarness([]);
  const smallGoals = Array.from({ length: 250 }, (_, i) => ({ id: `sg${i}`, text: `Goal ${i}`, done: i < 40 }));
  const goal = context.normalize({ title: "Large", smallGoals });

  assert.deepEqual(JSON.parse(JSON.stringify(context.smallGoalSummary(goal))), { total: 250, done: 40, open: 210 });
  assert.equal(context.recentSmallGoals(goal, 4).length, 4);
});

test("activateFutureGoal moves a future goal into active state and keeps description as why", () => {
  const { context, storage } = createHarness([
    { id: "f1", title: "Future", goalType: "future", futureMonth: "2027-01", description: "Useful later" },
  ]);

  context.activateFutureGoal("f1");

  const saved = JSON.parse(storage["achieve.goals.v1"]);
  assert.equal(saved[0].goalType, "active");
  assert.equal(saved[0].why, "Useful later");
  assert.equal(saved[0].description, "Useful later");
});

test("editing an existing future idea cannot switch modes and lose hidden fields", () => {
  const { context, elements, storage } = createHarness([
    { id: "f1", title: "Future", goalType: "future", futureMonth: "2027-01", description: "Useful later" },
  ]);

  context.openForm("f1");
  context.setFormMode("active");
  elements.fTitle.value = "Future updated";
  elements.fDescription.value = "Still useful later";
  context.saveForm();

  const saved = JSON.parse(storage["achieve.goals.v1"]);
  assert.equal(saved[0].goalType, "future");
  assert.equal(saved[0].title, "Future updated");
  assert.equal(saved[0].description, "Still useful later");
  assert.equal(saved[0].futureMonth, "2027-01");
});

test("reopening an accidentally achieved active goal restores child checklist state", () => {
  const { context, storage } = createHarness([
    {
      id: "g1",
      title: "Active",
      milestones: [{ text: "M1", done: true }, { text: "M2", done: false }],
      smallGoals: [
        { id: "sg1", text: "Done", done: true, createdAt: 1, completedAt: 2 },
        { id: "sg2", text: "Open", done: false, createdAt: 3, completedAt: null },
      ],
    },
  ]);

  context.achieveGoal("g1");
  context.reopenGoal("g1");

  const saved = JSON.parse(storage["achieve.goals.v1"]);
  assert.equal(saved[0].achievedAt, null);
  assert.deepEqual(saved[0].milestones.map((item) => item.done), [true, false]);
  assert.equal(saved[0].smallGoals[0].done, true);
  assert.equal(saved[0].smallGoals[0].completedAt, 2);
  assert.equal(saved[0].smallGoals[1].done, false);
  assert.equal(saved[0].smallGoals[1].completedAt, null);
});

test("array-based imports remain normalized through load/save compatibility", () => {
  const { context, storage } = createHarness([
    { id: "old", goal: "Legacy", milestones: ["First"], tasks: ["Small"] },
    { id: "future", title: "Later", type: "future", estimatedMonth: "2028-05", desc: "Maybe" },
  ]);

  context.save();

  const saved = JSON.parse(storage["achieve.goals.v1"]);
  assert.equal(Array.isArray(saved), true);
  assert.equal(saved[0].title, "Legacy");
  assert.equal(saved[0].smallGoals[0].text, "Small");
  assert.equal(saved[0].smallGoals[0].done, false);
  assert.equal(typeof saved[0].smallGoals[0].id, "string");
  assert.equal(saved[1].goalType, "future");
  assert.equal(saved[1].futureMonth, "2028-05");
  assert.equal(saved[1].description, "Maybe");
});

test("victory rendering includes achieved goals and excludes active and future goals", () => {
  const { elements } = createHarness([
    { id: "active", title: "Active", smallGoals: ["Open"] },
    { id: "future", title: "Future", goalType: "future", futureMonth: "2028-05", description: "Later" },
    { id: "win", title: "Won goal", achievedAt: 1780000000000, milestones: [{ text: "M", done: true }], smallGoals: [{ id: "sg1", text: "S", done: true, createdAt: 1, completedAt: 2 }] },
  ]);

  assert.match(elements.doneWrap.innerHTML, /Victories \/ wins - 1/);
  assert.match(elements.doneWrap.innerHTML, /Won goal/);
  assert.doesNotMatch(elements.doneWrap.innerHTML, /Active/);
  assert.doesNotMatch(elements.doneWrap.innerHTML, /Future/);
});

test("render places active, standalone small, future, and won goals in separate sections", () => {
  const { elements } = createHarness([
    { id: "active", title: "Active goal", goalType: "active" },
    { id: "small", title: "One day task", goalType: "small", description: "One day", targetDate: "2026-07-12" },
    { id: "future", title: "Future goal", goalType: "future", futureMonth: "2028-05", description: "Later" },
    { id: "win", title: "Won goal", achievedAt: 1780000000000 },
  ]);

  assert.match(elements.activeList.innerHTML, /Active goal/);
  assert.doesNotMatch(elements.activeList.innerHTML, /One day task/);
  assert.match(elements.smallList.innerHTML, /Today's small goals - 1 day or less - 1/);
  assert.match(elements.smallList.innerHTML, /One day task/);
  assert.doesNotMatch(elements.smallList.innerHTML, /Active goal/);
  assert.match(elements.futureList.innerHTML, /Future goal/);
  assert.doesNotMatch(elements.futureList.innerHTML, /One day task/);
  assert.match(elements.doneWrap.innerHTML, /Won goal/);
});

test("daily goals render in daily section and not active or small", () => {
  const { context, elements } = createHarness([
    { id: "daily", title: "Complete Morning Routine", goalType: "daily", dailyMinimum: "Water", dailyStandard: "Routine", dailyMax: "Routine plus run" },
    { id: "active", title: "Active goal", goalType: "active" },
    { id: "small", title: "One day task", goalType: "small" },
  ]);

  assert.match(elements.dailyList.innerHTML, /Daily tracker - 1 goals/);
  assert.equal(elements.dailyList.style.display, "none");
  assert.doesNotMatch(elements.activeList.innerHTML, /Complete Morning Routine/);
  assert.doesNotMatch(elements.smallList.innerHTML, /Complete Morning Routine/);

  context.setView("daily");

  assert.match(elements.dailyList.innerHTML, /Daily tracker - 1 goals/);
  assert.match(elements.dailyList.innerHTML, /Complete Morning Routine/);
  assert.equal(elements.viewDaily.classList.contains("active"), true);
  assert.equal(elements.dailyList.style.display, "");
  assert.equal(elements.activeList.style.display, "none");
  assert.equal(elements.smallList.style.display, "none");
});

test("focus limits split active and standalone small goals into today and next sections", () => {
  const active = Array.from({ length: 7 }, (_, i) => ({ id: `a${i}`, title: `Active ${i}`, goalType: "active", focusOrder: i + 1, createdAt: i + 1 }));
  const small = Array.from({ length: 22 }, (_, i) => ({ id: `s${i}`, title: `Small ${i}`, goalType: "small", focusOrder: i + 1, createdAt: i + 1, targetDate: "2026-07-13" }));
  const { elements } = createHarness([...active, ...small, { id: "daily", title: "Daily", goalType: "daily" }]);

  assert.match(elements.activeList.innerHTML, /Today's active focus - 5/);
  assert.match(elements.activeList.innerHTML, /Next active goals - 2/);
  assert.match(elements.smallList.innerHTML, /Today's small goals - 1 day or less - 20/);
  assert.match(elements.smallList.innerHTML, /Next small goals - 2/);
  assert.equal(elements.dailyList.style.display, "none");
});

test("deferred goals move between next and today without data loss", () => {
  const { context, elements, storage } = createHarness([
    { id: "a1", title: "Active one", goalType: "active", focusOrder: 1 },
    { id: "a2", title: "Active two", goalType: "active", focusOrder: 2 },
  ]);

  context.deferGoalToTomorrow("a1");
  let saved = JSON.parse(storage["achieve.goals.v1"]);
  assert.match(saved[0].deferredUntil, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(elements.activeList.innerHTML, /Next active goals - 1/);

  context.moveGoalToToday("a1");
  saved = JSON.parse(storage["achieve.goals.v1"]);
  assert.equal(saved[0].deferredUntil, "");
  assert.match(elements.activeList.innerHTML, /Today's active focus - 2/);
});

test("reorderGoal changes displayed order and persists through save", () => {
  const { context, elements, storage } = createHarness([
    { id: "a1", title: "Active one", goalType: "active", focusOrder: 1, createdAt: 1 },
    { id: "a2", title: "Active two", goalType: "active", focusOrder: 2, createdAt: 2 },
  ]);

  context.reorderGoal("a2", "up");

  const html = elements.activeList.innerHTML;
  assert.ok(html.indexOf("Active two") < html.indexOf("Active one"));
  const saved = JSON.parse(storage["achieve.goals.v1"]);
  assert.equal(saved.find((g) => g.id === "a2").focusOrder, 1);
});

test("daily completions record wins without removing the daily goal", () => {
  const { context, elements, storage } = createHarness([
    { id: "daily", title: "Complete Morning Routine", goalType: "daily", dailyMinimum: "Water", dailyStandard: "Routine", dailyMax: "Routine plus run" },
  ]);

  context.completeDailyGoal("daily", "minimum");
  context.completeDailyGoal("daily", "standard");
  context.completeDailyGoal("daily", "max");

  const saved = JSON.parse(storage["achieve.goals.v1"]);
  assert.equal(saved[0].achievedAt, null);
  assert.deepEqual(saved[0].dailyCompletions.map((item) => item.level), ["minimum", "standard", "max"]);
  assert.equal(elements.dailyList.style.display, "none");
  assert.match(elements.doneWrap.innerHTML, /Daily win/);
  assert.match(elements.doneWrap.innerHTML, /Complete Morning Routine - Standard/);

  context.setView("daily");

  assert.match(elements.dailyList.innerHTML, /Complete Morning Routine/);
});

test("daily tracker can remove a mistaken completion and sync victories", () => {
  const { context, elements, storage } = createHarness([
    { id: "daily", title: "Complete Morning Routine", goalType: "daily", dailyMinimum: "Water", dailyStandard: "Routine", dailyMax: "Routine plus run" },
  ]);

  context.setView("daily");
  context.completeDailyGoal("daily", "standard");
  let saved = JSON.parse(storage["achieve.goals.v1"]);
  const completionId = saved[0].dailyCompletions[0].id;

  assert.match(elements.dailyList.innerHTML, /Recent completions/);
  assert.match(elements.dailyList.innerHTML, /Standard/);
  assert.match(elements.doneWrap.innerHTML, /Complete Morning Routine - Standard/);

  context.removeDailyCompletion("daily", completionId);

  saved = JSON.parse(storage["achieve.goals.v1"]);
  assert.deepEqual(saved[0].dailyCompletions, []);
  assert.match(elements.dailyList.innerHTML, /No completions yet/);
  assert.doesNotMatch(elements.doneWrap.innerHTML, /Complete Morning Routine - Standard/);
});

test("daily fields survive editing and save compatibility", () => {
  const { context, elements, storage } = createHarness([
    { id: "daily", title: "Daily", goalType: "daily", notes: "Old", dailyMinimum: "Min", dailyStandard: "Std", dailyMax: "Max" },
  ]);

  context.openForm("daily");
  elements.fTitle.value = "Daily updated";
  elements.fDailyNotes.value = "New notes";
  elements.fDailyMinimum.value = "New min";
  elements.fDailyStandard.value = "New standard";
  elements.fDailyMax.value = "New max";
  context.saveForm();
  context.save();

  const saved = JSON.parse(storage["achieve.goals.v1"]);
  assert.equal(saved[0].goalType, "daily");
  assert.equal(saved[0].title, "Daily updated");
  assert.equal(saved[0].notes, "New notes");
  assert.equal(saved[0].dailyMinimum, "New min");
  assert.equal(saved[0].dailyStandard, "New standard");
  assert.equal(saved[0].dailyMax, "New max");
});

test("daily goal saves do not capture hidden small-goal milestones", () => {
  const { context, elements, storage } = createHarness([
    { id: "daily", title: "Daily", goalType: "daily", milestones: [] },
  ]);

  context.openForm("daily");
  elements.fSmallMilestones.value = "Should not become a daily milestone";
  context.saveForm();

  const saved = JSON.parse(storage["achieve.goals.v1"]);
  assert.equal(saved[0].goalType, "daily");
  assert.deepEqual(JSON.parse(JSON.stringify(saved[0].milestones)), []);
});

test("winGoal moves a standalone small goal into victories", () => {
  const { context, elements, storage } = createHarness([
    { id: "small", title: "One day task", goalType: "small", description: "One day", targetDate: "2026-07-12" },
  ]);

  context.winGoal("small");

  const saved = JSON.parse(storage["achieve.goals.v1"]);
  assert.equal(saved[0].goalType, "small");
  assert.equal(typeof saved[0].achievedAt, "number");
  assert.doesNotMatch(elements.smallList.innerHTML, /One day task/);
  assert.match(elements.doneWrap.innerHTML, /Victories \/ wins - 1/);
  assert.match(elements.doneWrap.innerHTML, /One day task/);
});

test("winning a standalone small goal shows milestone count in victories", () => {
  const { context, elements } = createHarness([
    {
      id: "small",
      title: "Milestoned small",
      goalType: "small",
      milestones: [{ text: "First", done: true }, { text: "Second", done: false }],
    },
  ]);

  context.winGoal("small");

  assert.match(elements.doneWrap.innerHTML, /Milestoned small/);
  assert.match(elements.doneWrap.innerHTML, /Milestones: <b>2\/2<\/b>/);
});

test("editing a standalone small goal preserves type and about text", () => {
  const { context, elements, storage } = createHarness([
    { id: "small", title: "Small goal", goalType: "small", description: "Old note", targetDate: "2026-07-12" },
  ]);

  context.openForm("small");
  elements.fTitle.value = "Updated small goal";
  elements.fSmallAbout.value = "New note";
  elements.fTargetDate.value = "2026-07-13";
  context.saveForm();

  const saved = JSON.parse(storage["achieve.goals.v1"]);
  assert.equal(saved[0].goalType, "small");
  assert.equal(saved[0].title, "Updated small goal");
  assert.equal(saved[0].description, "New note");
  assert.equal(saved[0].targetDate, "2026-07-13");
});

test("standalone small goal milestones render progress and can be toggled", () => {
  const { context, elements, storage } = createHarness([
    {
      id: "small",
      title: "Small goal",
      goalType: "small",
      description: "One day",
      milestones: [{ text: "First checkpoint", done: false }, { text: "Second checkpoint", done: false }],
    },
  ]);

  assert.match(elements.smallList.innerHTML, /Step progress/);
  assert.match(elements.smallList.innerHTML, /0%/);
  assert.match(elements.smallList.innerHTML, /First checkpoint/);

  context.toggleMs("small", 0);

  const saved = JSON.parse(storage["achieve.goals.v1"]);
  assert.deepEqual(saved[0].milestones.map((item) => item.done), [true, false]);
  assert.match(elements.smallList.innerHTML, /50%/);
});

test("editing a standalone small goal preserves unchanged milestone completion states", () => {
  const { context, elements, storage } = createHarness([
    {
      id: "small",
      title: "Small goal",
      goalType: "small",
      description: "Old note",
      targetDate: "2026-07-12",
      milestones: [{ text: "Keep done", done: true }, { text: "Keep open", done: false }],
    },
  ]);

  context.openForm("small");
  elements.fTitle.value = "Updated small goal";
  elements.fSmallAbout.value = "New note";
  elements.fSmallMilestones.value = "Keep done\nKeep open\nNew checkpoint";
  context.saveForm();

  const saved = JSON.parse(storage["achieve.goals.v1"]);
  assert.equal(saved[0].title, "Updated small goal");
  assert.deepEqual(saved[0].milestones.map((item) => [item.text, item.done]), [
    ["Keep done", true],
    ["Keep open", false],
    ["New checkpoint", false],
  ]);
});

test("array-based export compatibility keeps standalone small goals intact", () => {
  const { context, storage } = createHarness([
    { id: "small", title: "Small goal", goalType: "small", description: "One day", targetDate: "2026-07-12" },
    { id: "future", title: "Later", type: "future", estimatedMonth: "2028-05", desc: "Maybe" },
  ]);

  context.save();

  const saved = JSON.parse(storage["achieve.goals.v1"]);
  assert.equal(Array.isArray(saved), true);
  assert.equal(saved[0].goalType, "small");
  assert.equal(saved[0].description, "One day");
  assert.equal(saved[0].targetDate, "2026-07-12");
  assert.equal(saved[1].goalType, "future");
});

test("normalize gives old standalone small goals empty timer sessions", () => {
  const { context } = createHarness([]);
  const goal = context.normalize({
    id: "small",
    title: "One day task",
    goalType: "small",
    description: "No timers yet",
  });

  assert.deepEqual(JSON.parse(JSON.stringify(goal.timerSessions)), []);
});

test("normalize preserves valid timer sessions and drops invalid minutes", () => {
  const { context } = createHarness([]);
  const goal = context.normalize({
    id: "small",
    title: "One day task",
    goalType: "small",
    timerSessions: [
      { id: "t1", minutes: 30, startedAt: 1000, completedAt: 2000 },
      { id: "bad", minutes: 0, startedAt: 3000, completedAt: 3000 },
    ],
  });

  assert.deepEqual(JSON.parse(JSON.stringify(goal.timerSessions)), [
    { id: "t1", minutes: 30, startedAt: 1000, completedAt: 2000 },
  ]);
});

test("addTimerSession appends 30 and 60 minute sessions without winning the small goal", () => {
  const { context, storage } = createHarness([
    { id: "small", title: "One day task", goalType: "small" },
  ]);

  context.addTimerSession("small", 30);
  context.addTimerSession("small", 60);

  const saved = JSON.parse(storage["achieve.goals.v1"]);
  assert.deepEqual(saved[0].timerSessions.map((session) => session.minutes), [30, 60]);
  assert.equal(saved[0].achievedAt, null);
  assert.equal(context.totalTimerMinutes(saved[0]), 90);
  assert.equal(context.formatMinutes(context.totalTimerMinutes(saved[0])), "1 h 30 min");
});

test("addCustomTimerSession validates positive integer minutes", () => {
  const { context, storage } = createHarness([
    { id: "small", title: "One day task", goalType: "small" },
  ]);

  context.promptValue = "45";
  context.addCustomTimerSession("small");
  context.promptValue = "0";
  context.addCustomTimerSession("small");

  const saved = JSON.parse(storage["achieve.goals.v1"]);
  assert.deepEqual(saved[0].timerSessions.map((session) => session.minutes), [45]);
});

test("invalid timer values and non-small goals do not create sessions", () => {
  const { context, storage } = createHarness([
    { id: "small", title: "One day task", goalType: "small" },
    { id: "active", title: "Active", goalType: "active" },
    { id: "future", title: "Future", goalType: "future" },
  ]);

  context.addTimerSession("small", -15);
  context.addTimerSession("active", 30);
  context.addTimerSession("future", 60);

  const saved = JSON.parse(storage["achieve.goals.v1"]);
  assert.deepEqual(saved[0].timerSessions ?? [], []);
  assert.deepEqual(saved[1].timerSessions ?? [], []);
  assert.deepEqual(saved[2].timerSessions ?? [], []);
});

test("winning a standalone small goal preserves timer history in victory rendering", () => {
  const { context, elements, storage } = createHarness([
    { id: "small", title: "One day task", goalType: "small", timerSessions: [{ id: "t1", minutes: 30, startedAt: 1000, completedAt: 2000 }] },
  ]);

  context.addTimerSession("small", 60);
  context.winGoal("small");

  const saved = JSON.parse(storage["achieve.goals.v1"]);
  assert.equal(saved[0].timerSessions.length, 2);
  assert.deepEqual(saved[0].timerSessions.map((session) => session.minutes), [30, 60]);
  assert.match(elements.doneWrap.innerHTML, /Time: <b>1 h 30 min<\/b>/);
});

test("editing a standalone small goal preserves timer sessions", () => {
  const { context, elements, storage } = createHarness([
    { id: "small", title: "Small goal", goalType: "small", description: "Old note", targetDate: "2026-07-12", timerSessions: [{ id: "t1", minutes: 30, startedAt: 1000, completedAt: 2000 }] },
  ]);

  context.openForm("small");
  elements.fTitle.value = "Updated small goal";
  elements.fSmallAbout.value = "New note";
  context.saveForm();

  const saved = JSON.parse(storage["achieve.goals.v1"]);
  assert.deepEqual(saved[0].timerSessions.map((session) => session.minutes), [30]);
});

test("old standalone small goals normalize with empty timer sessions", () => {
  const { context } = createHarness([]);
  const goal = context.normalize({ id: "small", title: "Small", goalType: "small" });

  assert.deepEqual(JSON.parse(JSON.stringify(goal.timerSessions)), []);
});

test("normalize preserves valid timer sessions and drops invalid sessions", () => {
  const { context } = createHarness([]);
  const goal = context.normalize({
    id: "small",
    title: "Small",
    goalType: "small",
    timerSessions: [
      { id: "t1", minutes: 30, startedAt: 10, completedAt: 20 },
      { id: "bad", minutes: 0, startedAt: 10, completedAt: 20 },
    ],
  });

  assert.deepEqual(JSON.parse(JSON.stringify(goal.timerSessions)), [
    { id: "t1", minutes: 30, startedAt: 10, completedAt: 20 },
  ]);
});

test("addTimerSession appends time without winning the small goal", () => {
  const { context, storage } = createHarness([
    { id: "small", title: "Small", goalType: "small", timerSessions: [] },
  ]);

  context.addTimerSession("small", 30);

  const saved = JSON.parse(storage["achieve.goals.v1"]);
  assert.equal(saved[0].achievedAt, null);
  assert.equal(saved[0].timerSessions.length, 1);
  assert.equal(saved[0].timerSessions[0].minutes, 30);
});

test("multiple timer sessions accumulate total minutes", () => {
  const { context } = createHarness([
    { id: "small", title: "Small", goalType: "small", timerSessions: [] },
  ]);

  context.addTimerSession("small", 30);
  context.addTimerSession("small", 60);

  assert.equal(context.totalTimerMinutes(context.goals[0]), 90);
  assert.equal(context.formatMinutes(90), "1 h 30 min");
});

test("invalid timer values do not create sessions", () => {
  const { context, storage } = createHarness([
    { id: "small", title: "Small", goalType: "small", timerSessions: [] },
  ]);

  context.addTimerSession("small", 0);
  context.addTimerSession("small", -5);
  context.addTimerSession("small", "nope");

  const saved = JSON.parse(storage["achieve.goals.v1"]);
  assert.equal(saved[0].timerSessions.length, 0);
});

test("custom timer session logs prompted minutes", () => {
  const { context, storage } = createHarness([
    { id: "small", title: "Small", goalType: "small", timerSessions: [] },
  ]);
  context.nextPromptValue = "45";

  context.addCustomTimerSession("small");

  const saved = JSON.parse(storage["achieve.goals.v1"]);
  assert.equal(saved[0].timerSessions[0].minutes, 45);
});

test("winning a small goal preserves timer history in victory rendering", () => {
  const { context, elements, storage } = createHarness([
    { id: "small", title: "Timed small", goalType: "small", timerSessions: [{ id: "t1", minutes: 60, startedAt: 10, completedAt: 20 }] },
  ]);

  context.addTimerSession("small", 30);
  context.winGoal("small");

  const saved = JSON.parse(storage["achieve.goals.v1"]);
  assert.equal(saved[0].timerSessions.length, 2);
  assert.match(elements.doneWrap.innerHTML, /Timed small/);
  assert.match(elements.doneWrap.innerHTML, /1 h 30 min/);
});

test("save writes localStorage before cloud save", async () => {
  const { context, storage, elements } = createHarness([
    { id: "small", title: "Small", goalType: "small" },
  ]);
  let cloudCalled = false;
  context.cloudSave.ready = true;
  context.cloudSave.user = { displayName: "Joel" };
  context.cloudSave.docRef = {};
  context.cloudSave.setDoc = async () => { cloudCalled = true; };

  context.goals[0].title = "Saved locally first";
  context.save();
  await new Promise((resolve) => setImmediate(resolve));

  const saved = JSON.parse(storage["achieve.goals.v1"]);
  assert.equal(saved[0].title, "Saved locally first");
  assert.equal(cloudCalled, true);
  assert.match(elements.saveStatus.textContent, /^Cloud: synced Joel/);
});

test("save does not throw when cloud save fails", async () => {
  const { context, storage, elements } = createHarness([
    { id: "small", title: "Small", goalType: "small" },
  ]);
  context.cloudSave.ready = true;
  context.cloudSave.user = { displayName: "Joel" };
  context.cloudSave.docRef = {};
  context.cloudSave.setDoc = async () => { throw new Error("offline"); };

  assert.doesNotThrow(() => context.save());
  await new Promise((resolve) => setImmediate(resolve));

  const saved = JSON.parse(storage["achieve.goals.v1"]);
  assert.equal(saved[0].title, "Small");
  assert.equal(elements.saveStatus.textContent, "Cloud unavailable - saved here");
});

test("loadCloudGoals normalizes cloud-loaded arrays", async () => {
  const { context } = createHarness([]);
  context.cloudSave.ready = true;
  context.cloudSave.docRef = {};
  context.cloudSave.getDoc = async () => ({
    exists: () => true,
    data: () => ({ value: JSON.stringify([{ id: "future", type: "future", title: "Later", desc: "Cloud", estimatedMonth: "2028-05" }]) }),
  });

  const loaded = await context.loadCloudGoals();

  assert.equal(loaded[0].goalType, "future");
  assert.equal(loaded[0].description, "Cloud");
  assert.equal(loaded[0].futureMonth, "2028-05");
});

test("advanced practice fields normalize into stable backward-compatible shapes", () => {
  const { context } = createHarness([]);
  const goal = context.normalize({
    id: "advanced",
    title: "Deliberate goal",
    evidence: ["Asked for feedback", { id: "e2", text: "Shipped draft", createdAt: 42 }],
    experiment: { hypothesis: "Short calls convert", method: "Run five calls", measurement: "Bookings", decision: "Continue" },
    weakestPoint: "Opening question",
    drill: "Practice ten openings",
    expectedFeedback: "Three bookings",
    actualFeedback: "One booking",
    feedbackCorrection: "Rewrite opening",
    identity: "I finish what I start",
    identityProof: "Published twice",
    negativeThought: "I always freeze",
    objectiveFact: "I completed two calls",
    thoughtReframe: "Practice makes the next call easier",
    recovery: { trigger: "Missed day", reset: "Take a walk", nextStep: "Do five minutes" },
  });

  assert.deepEqual(JSON.parse(JSON.stringify(goal.evidenceLog)).map((entry) => entry.text), ["Asked for feedback", "Shipped draft"]);
  assert.equal(goal.experiment.measurement, "Bookings");
  assert.equal(goal.weakestPointDrill, "Practice ten openings");
  assert.equal(goal.feedback.actual, "One booking");
  assert.equal(goal.identityStatement, "I finish what I start");
  assert.equal(goal.identityEvidence, "Published twice");
  assert.equal(goal.thoughtToFact.fact, "I completed two calls");
  assert.equal(goal.recoveryProtocol.nextStep, "Do five minutes");
});

test("legacy goals receive empty advanced practice fields without losing old data", () => {
  const { context } = createHarness([]);
  const goal = context.normalize({ id: "legacy", title: "Legacy", why: "Keep this", milestones: ["First"] });

  assert.equal(goal.why, "Keep this");
  assert.equal(goal.milestones[0].text, "First");
  assert.deepEqual(JSON.parse(JSON.stringify(goal.evidenceLog)), []);
  assert.deepEqual(JSON.parse(JSON.stringify(goal.experiment)), { hypothesis: "", method: "", measurement: "", decision: "" });
  assert.deepEqual(JSON.parse(JSON.stringify(goal.feedback)), { expected: "", actual: "", correction: "" });
  assert.deepEqual(JSON.parse(JSON.stringify(goal.thoughtToFact)), { thought: "", fact: "", reframe: "" });
  assert.deepEqual(JSON.parse(JSON.stringify(goal.recoveryProtocol)), { trigger: "", reset: "", nextStep: "" });
});

test("addEvidence records proof and preserves completion state", () => {
  const { context, storage } = createHarness([{ id: "g1", title: "Goal", achievedAt: null }]);

  context.addEvidence("g1", "Completed the hard rehearsal");
  context.addEvidence("g1", "   ");

  const saved = JSON.parse(storage["achieve.goals.v1"]);
  assert.equal(saved[0].evidenceLog.length, 1);
  assert.equal(saved[0].evidenceLog[0].text, "Completed the hard rehearsal");
  assert.equal(typeof saved[0].evidenceLog[0].createdAt, "number");
  assert.equal(saved[0].achievedAt, null);
});

test("editing an old active goal preserves hidden advanced and unknown fields unchanged", () => {
  const advanced = {
    evidenceLog: [{ id: "e1", text: "Completed the hard rehearsal", createdAt: 10 }],
    experiment: { hypothesis: "A focused offer wins", method: "Send five messages", measurement: "Replies", decision: "Keep if two reply" },
    weakestPoint: "Opening",
    weakestPointDrill: "Ten repetitions",
    feedback: { expected: "Two replies", actual: "One reply", correction: "Shorten message" },
    identityStatement: "I am a consistent builder",
    identityEvidence: "I shipped yesterday",
    thoughtToFact: { thought: "Nobody will answer", fact: "One person answered", reframe: "Keep testing" },
    recoveryProtocol: { trigger: "Missed session", reset: "Review", nextStep: "Five minutes" },
    pluginData: { source: "legacy", nested: { score: 9 } },
  };
  const { context, elements, storage } = createHarness([{ id: "g1", title: "Goal", ...advanced }]);
  context.openForm("g1");
  elements.fTitle.value = "Goal updated";
  context.saveForm();

  const saved = JSON.parse(storage["achieve.goals.v1"])[0];
  assert.equal(saved.title, "Goal updated");
  Object.entries(advanced).forEach(([key, value]) => assert.deepEqual(saved[key], value));
});

test("normalization and editing preserve unknown keys nested in advanced objects", () => {
  const { context, elements, storage } = createHarness([{
    id: "nested-advanced",
    title: "Nested metadata",
    experiment: { hypothesis: 42, method: "Try", measurement: "Count", decision: "Keep", modelVersion: 3 },
    feedback: { expected: "Two", actual: "One", correction: "Adjust", reviewer: { id: "coach" } },
    thoughtToFact: { thought: "Hard", fact: "Started", reframe: "Continue", confidence: 0.8 },
    recoveryProtocol: { trigger: "Pause", reset: "Breathe", nextStep: "Resume", owner: "me" },
  }]);

  assert.equal(context.goals[0].experiment.hypothesis, "");
  assert.equal(context.goals[0].experiment.modelVersion, 3);
  assert.deepEqual(JSON.parse(JSON.stringify(context.goals[0].feedback.reviewer)), { id: "coach" });
  assert.equal(context.goals[0].thoughtToFact.confidence, 0.8);
  assert.equal(context.goals[0].recoveryProtocol.owner, "me");

  context.openForm("nested-advanced");
  elements.fTitle.value = "Nested metadata updated";
  context.saveForm();

  const saved = JSON.parse(storage["achieve.goals.v1"])[0];
  assert.equal(saved.experiment.modelVersion, 3);
  assert.deepEqual(saved.feedback.reviewer, { id: "coach" });
  assert.equal(saved.thoughtToFact.confidence, 0.8);
  assert.equal(saved.recoveryProtocol.owner, "me");
});

test("duplicate checklist text consumes old matches once and keeps independent states", () => {
  const { context, elements, storage } = createHarness([{
    id: "duplicates",
    title: "Duplicates",
    goalType: "active",
    milestones: [{ text: "Practice", done: true }, { text: "Practice", done: false }],
    smallGoals: [
      { id: "sg-first", text: "Review", done: true, createdAt: 1, completedAt: 2 },
      { id: "sg-second", text: "Review", done: false, createdAt: 3, completedAt: null },
    ],
  }]);

  context.openForm("duplicates");
  elements.fMilestones.value = "Practice\nPractice";
  context.saveForm();

  let saved = JSON.parse(storage["achieve.goals.v1"])[0];
  assert.deepEqual(saved.milestones.map((item) => item.done), [true, false]);
  assert.deepEqual(saved.smallGoals.map((item) => [item.id, item.done]), [["sg-first", true], ["sg-second", false]]);

  context.toggleSmallGoal("duplicates", "sg-second");
  saved = JSON.parse(storage["achieve.goals.v1"])[0];
  assert.deepEqual(saved.smallGoals.map((item) => [item.id, item.done]), [["sg-first", true], ["sg-second", true]]);
});

test("Khan Academy Algebra 2 small-goal steps stay specific and preserve completion on edit", () => {
  const steps = ["Finish Unit 4 & 5", "Finish Unit 6 & 7", "Review Both", "Finish Unit 8"];
  const { context, elements, storage } = createHarness([
    { id: "khan", title: "Finish Khan Academy Algebra 2", goalType: "small", milestones: steps.map((text, index) => ({ text, done: index === 1 })) },
    { id: "other", title: "Clean room", goalType: "small", milestones: [{ text: "Put clothes away", done: false }] },
  ]);

  assert.match(elements.smallList.innerHTML, /Steps for this small goal/);
  context.openForm("khan");
  assert.equal(elements.fSmallMilestones.value, steps.join("\n"));
  elements.fSmallMilestones.value = `${steps.join("\n")}\nTake course challenge`;
  context.saveForm();

  const saved = JSON.parse(storage["achieve.goals.v1"]);
  const khan = saved.find((goal) => goal.id === "khan");
  const other = saved.find((goal) => goal.id === "other");
  assert.deepEqual(khan.milestones.map((item) => [item.text, item.done]), [
    [steps[0], false], [steps[1], true], [steps[2], false], [steps[3], false], ["Take course challenge", false],
  ]);
  assert.deepEqual(other.milestones, [{ text: "Put clothes away", done: false }]);
});

test("editing active planning preserves child small goals while saving milestones", () => {
  const { context, elements, storage } = createHarness([{
    id: "active-plan",
    title: "Complete a course",
    goalType: "active",
    milestones: [{ text: "Finish first half", done: true }, { text: "Finish second half", done: false }],
    smallGoals: [{ id: "sg-review", text: "Review today", done: true, createdAt: 1, completedAt: 2 }],
  }]);

  context.openForm("active-plan");
  elements.fMilestones.value = "Finish first half\nFinish second half\nTake final";
  context.saveForm();

  const saved = JSON.parse(storage["achieve.goals.v1"])[0];
  assert.deepEqual(saved.milestones.map((item) => [item.text, item.done]), [
    ["Finish first half", true], ["Finish second half", false], ["Take final", false],
  ]);
  assert.deepEqual(saved.smallGoals.map((item) => [item.id, item.text, item.done]), [["sg-review", "Review today", true]]);
});

test("other active edits preserve nested child order, steps, and unknown fields", () => {
  const children = [
    { id: "first", text: "First", done: false, custom: "keep", steps: [{ id: "s1", text: "Step", done: true, extra: 9 }] },
    { id: "second", text: "Second", done: true, steps: [] },
  ];
  const { context, elements, storage } = createHarness([{ id: "active", title: "Before", why: "Why", smallGoals: children }]);
  context.openForm("active");
  elements.fTitle.value = "After";
  elements.fWhy.value = "Updated why";
  context.saveForm();

  const saved = JSON.parse(storage["achieve.goals.v1"])[0];
  assert.equal(saved.title, "After");
  assert.deepEqual(saved.smallGoals.map((child) => child.id), ["first", "second"]);
  assert.equal(saved.smallGoals[0].custom, "keep");
  assert.equal(saved.smallGoals[0].steps[0].extra, 9);
});

test("new active goal creates child small goals and their independent steps from the form", () => {
  const { context, elements, storage } = createHarness([]);
  context.openForm(null, "active");
  context.addFormSmallGoal();
  context.addFormSmallGoal();
  assert.match(elements.formSmallGoalsList.innerHTML, /Small Goal #1/);
  assert.match(elements.formSmallGoalsList.innerHTML, /Steps for this child small goal/);
  context.updateFormSmallGoal(context.formChildSmallGoals[0].id, "text", "First child");
  context.updateFormSmallGoal(context.formChildSmallGoals[0].id, "stepsText", "First step\nSecond step");
  context.updateFormSmallGoal(context.formChildSmallGoals[1].id, "text", "Second child");
  context.updateFormSmallGoal(context.formChildSmallGoals[1].id, "stepsText", "Only step");
  elements.fTitle.value = "New active";
  context.saveForm();
  const children = JSON.parse(storage["achieve.goals.v1"])[0].smallGoals;
  assert.deepEqual(children.map((item) => item.text), ["First child", "Second child"]);
  assert.deepEqual(children[0].steps.map((step) => step.text), ["First step", "Second step"]);
  assert.deepEqual(children[1].steps.map((step) => step.text), ["Only step"]);
});

test("small-goals manager is bounded and expands only the selected child", () => {
  const many = Array.from({ length: 120 }, (_, index) => ({ id: `child-${index}`, text: `Child ${index}`, steps: Array.from({ length: 20 }, (_, step) => ({ id: `step-${index}-${step}`, text: `Nested ${index}-${step}` })) }));
  const { context, elements } = createHarness([{ id: "active", title: "Large", smallGoals: many }]);
  context.openSmallGoals("active");
  let html = elements.smallGoalsList.innerHTML;
  assert.ok((html.match(/class="child-small-goal"/g) || []).length <= 40);
  assert.equal((html.match(/class="child-editor"/g) || []).length, 0);
  assert.doesNotMatch(html, /Nested 0-0/);
  assert.match(html, /Showing 40 of 120/);

  context.selectChildSmallGoal("active", "child-0");
  html = elements.smallGoalsList.innerHTML;
  assert.equal((html.match(/class="child-editor"/g) || []).length, 1);
  assert.match(html, /Nested 0-0/);
  assert.doesNotMatch(html, /Nested 1-0/);
});

test("child manager controls have child-specific accessible names", () => {
  const { context, elements } = createHarness([{ id: "active", title: "Goal", smallGoals: [{ id: "child", text: "Read chapter", steps: [] }], smallGoalsTrash: [{ id: "trashed", text: "Old child", deletedAt: 1, steps: [] }] }]);
  context.openSmallGoals("active");
  const html = elements.smallGoalsList.innerHTML;
  assert.match(html, /aria-label="Complete Read chapter"/);
  assert.match(html, /aria-label="Edit Read chapter"/);
  assert.match(html, /aria-label="Delete Read chapter"/);
  assert.match(html, /aria-label="Restore Old child"/);
  assert.match(fs.readFileSync(htmlPath, "utf8"), /<label[^>]*for="newSmallGoalText"/);
  context.selectChildSmallGoal("active", "child");
  assert.match(elements.smallGoalsList.innerHTML, /aria-label="Save Read chapter"/);
});

test("malformed child Trash entries fail closed while valid nested data survives normalization", () => {
  const { context } = createHarness([{
    id: "active", title: "Goal", smallGoalsTrash: [null, 12, {}, {
      id: "trash-child", text: "Valid trash", deletedAt: 55, custom: "keep",
      steps: [null, { id: "trash-step", text: "Valid nested", done: true, extra: 7 }],
    }],
  }]);
  const trash = context.goals[0].smallGoalsTrash;
  assert.equal(trash.length, 1);
  assert.equal(trash[0].deletedAt, 55);
  assert.equal(trash[0].custom, "keep");
  assert.equal(trash[0].steps[0].id, "trash-step");
  assert.equal(trash[0].steps[0].extra, 7);
});

test("malicious and duplicate imported IDs normalize to unique inline-handler-safe IDs", () => {
  const { context, elements, storage } = createHarness([
    { id: "x');alert(1);//", title: "Unsafe", smallGoals: [{ id: "s');alert(2);//", text: "First" }, { id: "s');alert(2);//", text: "Second" }] },
    { id: "safe-id_2", title: "Safe" },
    { id: "safe-id_2", title: "Duplicate" },
  ]);

  const savedGoals = context.goals;
  assert.equal(new Set(savedGoals.map((goal) => goal.id)).size, 3);
  savedGoals.forEach((goal) => assert.match(goal.id, /^[A-Za-z0-9_-]+$/));
  savedGoals[0].smallGoals.forEach((item) => assert.match(item.id, /^[A-Za-z0-9_-]+$/));
  assert.equal(new Set(savedGoals[0].smallGoals.map((item) => item.id)).size, 2);
  assert.doesNotMatch(elements.activeList.innerHTML, /alert\(/);

  context.save();
  JSON.parse(storage["achieve.goals.v1"]).forEach((goal) => assert.match(goal.id, /^[A-Za-z0-9_-]+$/));
});

test("unknown top-level fields survive normalize and type-specific edit round trips", () => {
  const { context, elements, storage } = createHarness([{ id: "g1", title: "Goal", pluginData: { source: "future-tool", score: 9 }, customFlag: true }]);
  assert.deepEqual(JSON.parse(JSON.stringify(context.goals[0].pluginData)), { source: "future-tool", score: 9 });

  context.openForm("g1");
  elements.fTitle.value = "Goal updated";
  context.saveForm();

  const saved = JSON.parse(storage["achieve.goals.v1"])[0];
  assert.equal(saved.title, "Goal updated");
  assert.deepEqual(saved.pluginData, { source: "future-tool", score: 9 });
  assert.equal(saved.customFlag, true);
});

test("mixed valid and malformed child items retain valid milestones and small goals", () => {
  const { context } = createHarness([]);
  const goal = context.normalize({
    id: "mixed",
    title: "Mixed",
    milestones: [null, { text: "Valid milestone", done: true }, 17, {}, "Second milestone"],
    smallGoals: [null, { id: "valid-child", text: "Valid action", done: false }, false, {}, "Second action"],
  });

  assert.deepEqual(JSON.parse(JSON.stringify(goal.milestones)).map((item) => item.text), ["Valid milestone", "Second milestone"]);
  assert.deepEqual(JSON.parse(JSON.stringify(goal.smallGoals)).map((item) => item.text), ["Valid action", "Second action"]);
});
