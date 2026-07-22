const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const htmlPath = path.join(__dirname, "..", "goal-app.html");

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
    "fSmallGoals",
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
  });
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

  assert.match(elements.smallList.innerHTML, /Milestone progress/);
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

test("demoGoals includes active, small, future, and achieved goals", () => {
  const { context } = createHarness([]);
  const demo = context.demoGoals();

  assert.equal(demo.some((g) => g.goalType === "active" && !g.achievedAt), true);
  assert.equal(demo.some((g) => g.goalType === "small" && !g.achievedAt), true);
  assert.equal(demo.some((g) => g.goalType === "future"), true);
  assert.equal(demo.some((g) => g.achievedAt), true);
});

test("loadDemoGoals does not replace goals when confirmation is canceled", () => {
  const { context, storage } = createHarness([
    { id: "real", title: "Keep my real goal" },
  ]);
  context.confirmValue = false;

  context.loadDemoGoals();

  const saved = JSON.parse(storage["achieve.goals.v1"]);
  assert.equal(saved[0].title, "Keep my real goal");
});

test("loadDemoGoals replaces, saves, and renders demo goals after confirmation", () => {
  const { context, elements, storage } = createHarness([
    { id: "old", title: "Replace this goal" },
  ]);
  context.confirmValue = true;

  context.loadDemoGoals();

  const saved = JSON.parse(storage["achieve.goals.v1"]);
  assert.notEqual(saved[0].title, "Replace this goal");
  assert.equal(saved.some((g) => g.title.includes("Marcus gets 3 paying tutoring students")), true);
  assert.match(elements.activeList.innerHTML, /Marcus gets 3 paying tutoring students/);
  assert.match(elements.smallList.innerHTML, /Practice the trial-call script/);
  assert.match(elements.futureList.innerHTML, /mini course/);
  assert.match(elements.doneWrap.innerHTML, /first paying tutoring student/);
});
