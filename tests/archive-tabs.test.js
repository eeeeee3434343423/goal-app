/*
 * Archive + per-type tabs.
 *
 * Two additions, nothing removed:
 *   1. Archive - park an INCOMPLETE Active / Small / Future goal for later.
 *      It leaves every live list, lands in its own Archive tab, and Restore
 *      puts it straight back. Nothing is deleted.
 *   2. Active goals / Small goals / Future goals tabs, plus Future moving out
 *      of Today. Ideas, Alerts, Daily and Victories are untouched.
 */
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

function createElement(id) {
  return {
    id, value: "", checked: false, innerHTML: "", textContent: "", disabled: false,
    title: "", style: {}, files: [],
    classList: {
      values: new Set(),
      add(n) { this.values.add(n); }, remove(n) { this.values.delete(n); },
      toggle(n, f) { const a = f === undefined ? !this.values.has(n) : !!f; if (a) this.values.add(n); else this.values.delete(n); return a; },
      contains(n) { return this.values.has(n); },
    },
    click() {}, focus() {},
  };
}

function createHarness(seedGoals = [], options = {}) {
  const elements = {};
  const live = options.alreadyLive !== false;
  const seeded = live
    ? seedGoals.map((g) => Object.assign({}, g, { lifecycleMigratedVersion: 4 }))
    : seedGoals;
  const storage = { "achieve.goals.v1": JSON.stringify(seeded) };
  const context = {
    console, Date, Math,
    Blob: class Blob {}, URL: { createObjectURL: () => "blob:test" }, FileReader: class FileReader {},
    setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    alert(m) { context.lastAlert = m; },
    prompt() { return context.nextPromptValue; },
    confirm() { return context.confirmValue !== false; },
    localStorage: {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(storage, k) ? storage[k] : null),
      setItem: (k, v) => { storage[k] = String(v); },
    },
    document: {
      getElementById(id) {
        if (!elements[id]) elements[id] = createElement(id);
        return elements[id];
      },
      createElement: (t) => createElement(t),
      querySelectorAll: () => [],
    },
    navigator: { clipboard: { writeText(t) { context.lastCopiedText = t; return Promise.resolve(); } } },
    window: { __storage: storage, __SKIP_CLOUD_SAVE: true, addEventListener() {}, scrollTo() {} },
  };
  context.window.window = context.window;
  context.window.document = context.document;
  context.window.localStorage = context.localStorage;
  context.window.navigator = context.navigator;
  vm.createContext(context);
  vm.runInContext(extractScript(), context, { filename: "goal-app.html" });
  context.cloudSave.user = { uid: "t" };
  context.cloudSave.initialReadDone = true;
  return { context, elements, storage };
}

function reload(storage) {
  return createHarness(JSON.parse(storage["achieve.goals.v1"]));
}
function savedGoals(storage) {
  return JSON.parse(storage["achieve.goals.v1"]);
}

function activeGoal(overrides = {}) {
  return Object.assign({
    id: "a1",
    title: "Earn my first 500 per month from tutoring",
    goalType: "active",
    status: "active",
    deadline: "2099-06-01",
    why: "Proof I can build income from my own skills",
    smallGoals: [
      { id: "s1", what: "Write the one page offer", why: "Nothing sells until it is written", estimateMinutes: 60 },
      { id: "s2", what: "Message ten parents", why: "Direct outreach creates the first clients", estimateMinutes: 45 },
    ],
  }, overrides);
}
function smallGoal(overrides = {}) {
  return Object.assign({
    id: "m1",
    title: "Find and buy a reading lamp",
    goalType: "small",
    targetDate: "2099-01-04",
    description: "Quick win for the desk",
  }, overrides);
}
function futureGoal(overrides = {}) {
  return Object.assign({
    id: "f1",
    title: "Become a mentalist",
    goalType: "future",
    futureMonth: "2027-03",
    description: "Long horizon idea, already captured",
  }, overrides);
}
function dailyGoal(overrides = {}) {
  return Object.assign({
    id: "d1",
    title: "Complete morning routine",
    goalType: "daily",
    dailyStandard: "Teeth, water, ten minute cleanup",
  }, overrides);
}

/* ================================================================== */
/* 1. The archivedAt field                                            */
/* ================================================================== */

test("normalize gives every goal an archivedAt field that defaults to null", () => {
  const { context } = createHarness([]);
  assert.equal(context.normalize({ id: "x", title: "Anything" }).archivedAt, null);
  assert.equal(context.normalize({ id: "x", title: "Parked", archivedAt: 1787000000000 }).archivedAt, 1787000000000);
});

test("a live goal always serializes an explicit null archivedAt", () => {
  const { context, storage } = createHarness([activeGoal()]);
  context.save();
  const saved = savedGoals(storage)[0];
  assert.equal(Object.prototype.hasOwnProperty.call(saved, "archivedAt"), true);
  assert.equal(saved.archivedAt, null,
    "the key is always written, so a per-field cloud merge can never resurrect an old archive");
});

test("archiving writes the field, and it survives a reload and a normalize round trip", () => {
  const { context, storage } = createHarness([smallGoal()]);
  assert.equal(context.archiveGoal("m1"), true);
  assert.equal(Object.prototype.hasOwnProperty.call(savedGoals(storage)[0], "archivedAt"), true);
  const after = reload(storage);
  assert.ok(after.context.goals[0].archivedAt > 0, "archive state survives a reload");
  assert.equal(after.context.isArchivedGoal(after.context.goals[0]), true);
});

test("archivedAt is carried through an ordinary edit of the goal", () => {
  const { context, elements } = createHarness([smallGoal()]);
  context.archiveGoal("m1");
  const stamp = context.goals[0].archivedAt;
  context.openForm("m1");
  elements.fTitle.value = "Find and buy a better reading lamp";
  context.saveForm();
  assert.equal(context.goals[0].title, "Find and buy a better reading lamp");
  assert.equal(context.goals[0].archivedAt, stamp, "editing an archived goal must not un-archive it");
});

/* ================================================================== */
/* 2. What can and cannot be archived                                 */
/* ================================================================== */

test("incomplete active, small and future goals can all be archived", () => {
  const { context } = createHarness([activeGoal(), smallGoal(), futureGoal()]);
  assert.equal(context.archiveGoal("a1"), true);
  assert.equal(context.archiveGoal("m1"), true);
  assert.equal(context.archiveGoal("f1"), true);
  assert.equal(context.archivedGoals().length, 3);
});

test("a draft active goal being planned can be archived", () => {
  const { context } = createHarness([activeGoal({ status: "draft" })]);
  assert.equal(context.archiveGoal("a1"), true);
});

test("daily goals, ideas, completed goals and missed goals cannot be archived", () => {
  const { context } = createHarness([
    dailyGoal(),
    { id: "i1", title: "Maybe learn chess", recordKind: "idea" },
    activeGoal({ id: "won", achievedAt: 1787000000000, outcome: "completed", reflectionStatus: "complete" }),
    activeGoal({ id: "lost", outcome: "missed", missedAt: 1787000000000, reflectionStatus: "pending" }),
  ]);
  ["d1", "i1", "won", "lost"].forEach((id) => {
    assert.equal(context.archiveGoal(id), false, id + " must not be archivable");
  });
  assert.equal(context.archivedGoals().length, 0);
});

test("archiving twice is a no-op and never restamps", () => {
  const { context } = createHarness([smallGoal()]);
  context.archiveGoal("m1");
  const stamp = context.goals[0].archivedAt;
  assert.equal(context.archiveGoal("m1"), false);
  assert.equal(context.goals[0].archivedAt, stamp);
});

test("an archived goal cannot be won, completed or activated behind the tab", () => {
  const { context } = createHarness([smallGoal(), futureGoal({ deadline: "2099-02-02", status: "future" })]);
  context.archiveGoal("m1");
  context.archiveGoal("f1");
  assert.equal(context.achieveGoal("m1"), false);
  assert.ok(!context.goals[0].achievedAt, "it stayed unfinished");
  context.activateFutureGoal("f1");
  assert.equal(context.goals[1].goalType, "future", "activation requires restoring it first");
});

/* ================================================================== */
/* 3. Archived goals leave the live lists and appear in the Archive    */
/* ================================================================== */

test("an archived goal leaves Today and its own tab, and appears in the Archive tab", () => {
  const { context, elements } = createHarness([activeGoal(), smallGoal(), futureGoal()]);
  context.archiveGoal("a1");
  context.archiveGoal("m1");
  context.archiveGoal("f1");
  context.render();
  assert.doesNotMatch(elements.activeList.innerHTML, /Earn my first 500/);
  assert.doesNotMatch(elements.smallList.innerHTML, /reading lamp/);
  assert.doesNotMatch(elements.futureList.innerHTML, /Become a mentalist/);
  assert.match(elements.archiveList.innerHTML, /Earn my first 500/);
  assert.match(elements.archiveList.innerHTML, /reading lamp/);
  assert.match(elements.archiveList.innerHTML, /Become a mentalist/);
  assert.match(elements.archiveList.innerHTML, /Archived active goals/);
  assert.match(elements.archiveList.innerHTML, /Archived small goals/);
  assert.match(elements.archiveList.innerHTML, /Archived future goals/);
});

test("archived goals never leak into Victories or Needs Reflection", () => {
  const { context } = createHarness([activeGoal(), smallGoal()]);
  context.archiveGoal("a1");
  context.archiveGoal("m1");
  assert.equal(context.victoryGoals().length, 0);
  assert.equal(context.needsReflectionGoals().length, 0);
});

test("Restore puts the goal straight back into its live list", () => {
  const { context, elements, storage } = createHarness([smallGoal()]);
  context.archiveGoal("m1");
  assert.equal(context.unarchiveGoal("m1"), true);
  assert.equal(context.goals[0].archivedAt, null);
  context.setView("small");
  assert.match(elements.smallList.innerHTML, /reading lamp/);
  assert.doesNotMatch(elements.archiveList.innerHTML, /reading lamp/);
  assert.equal(savedGoals(storage)[0].archivedAt, null,
    "a restored goal serializes exactly like a goal that was never archived");
});

test("restoring something that is not archived does nothing", () => {
  const { context } = createHarness([smallGoal()]);
  assert.equal(context.unarchiveGoal("m1"), false);
  assert.equal(context.unarchiveGoal("nope"), false);
});

test("the empty Archive tab explains itself instead of showing a blank page", () => {
  const { context, elements } = createHarness([activeGoal()]);
  context.setView("archive");
  assert.match(elements.archiveList.innerHTML, /Nothing archived/);
});

test("archive cards offer Restore, and live cards offer Archive", () => {
  const { context, elements } = createHarness([activeGoal(), smallGoal(), futureGoal(), dailyGoal()]);
  context.render();
  assert.match(elements.activeList.innerHTML, /archiveGoal\('a1'\)/);
  assert.match(elements.smallList.innerHTML, /archiveGoal\('m1'\)/);
  assert.match(elements.futureList.innerHTML, /archiveGoal\('f1'\)/);
  assert.doesNotMatch(elements.dailyList.innerHTML, /archiveGoal/, "daily goals get no Archive button");
  context.archiveGoal("a1");
  context.render();
  assert.match(elements.archiveList.innerHTML, /unarchiveGoal\('a1'\)/);
});

test("a won goal shows no Archive button", () => {
  const { context } = createHarness([]);
  const won = context.normalize(activeGoal({ achievedAt: 1787000000000, outcome: "completed", reflectionStatus: "complete" }));
  assert.equal(context.archiveButtonHtml(won), "");
});

/* ================================================================== */
/* 4. An archived goal is out of execution                            */
/* ================================================================== */

test("an archived goal past its deadline is not marked missed", () => {
  const { context } = createHarness([activeGoal({ deadline: "2099-01-01" })]);
  context.archiveGoal("a1");
  const changed = context.evaluateMissedGoals(Date.parse("2099-06-01T12:00:00Z"));
  assert.equal(changed, 0);
  assert.equal(context.goals[0].outcome, "");
  assert.equal(context.goals[0].reflectionStatus, "");
});

test("restoring a goal whose deadline passed asks for review instead of handing it a miss", () => {
  const { context } = createHarness([activeGoal({ deadline: "2099-01-01" })]);
  context.archiveGoal("a1");
  context.unarchiveGoal("a1", Date.parse("2099-06-01T12:00:00Z"));
  assert.equal(context.goals[0].migrationOverdue, true, "it comes back for review");
  assert.equal(context.goals[0].outcome, "", "it is not silently missed");
  assert.equal(context.goals[0].reflectionStatus, "", "and it owes no reflection");
  assert.equal(context.migrationOverdueGoals().length, 1);
});

test("an archived overdue goal does not sit in the Overdue review banner", () => {
  const { context } = createHarness([activeGoal({ deadline: "2099-01-01", migrationOverdue: true })]);
  assert.equal(context.migrationOverdueGoals().length, 1);
  context.archiveGoal("a1");
  assert.equal(context.migrationOverdueGoals().length, 0);
});

test("an archived goal sends no notifications", () => {
  const { context } = createHarness([
    futureGoal({ id: "f2", status: "future", deadline: "2099-02-01", futureMonth: "",
      smallGoals: [{ id: "x1", what: "Read one book", why: "Foundation" }, { id: "x2", what: "Practice daily", why: "Reps" }] }),
  ]);
  const at = Date.parse("2099-01-25T12:00:00Z");
  assert.ok(context.evaluateNotifications(at) > 0, "a live future goal near its deadline does notify");
  const parked = createHarness([
    futureGoal({ id: "f2", status: "future", deadline: "2099-02-01", futureMonth: "", archivedAt: 1787000000000,
      smallGoals: [{ id: "x1", what: "Read one book", why: "Foundation" }, { id: "x2", what: "Practice daily", why: "Reps" }] }),
  ]);
  assert.equal(parked.context.evaluateNotifications(at), 0, "an archived one stays quiet");
});

/* ================================================================== */
/* 5. The tabs                                                        */
/* ================================================================== */

test("every tab is present in the page, and none of the old ones were removed", () => {
  const html = fs.readFileSync(htmlPath, "utf8");
  ["viewToday", "viewActive", "viewSmall", "viewFuture", "viewIdeas", "viewArchive",
   "viewNotify", "viewDaily", "viewVictories"].forEach((id) => {
    assert.match(html, new RegExp('id="' + id + '"'), id + " should exist");
  });
  assert.match(html, /id="archiveList"/);
});

test("Today shows active and small goals, and no longer shows future goals", () => {
  const { context, elements } = createHarness([activeGoal(), smallGoal(), futureGoal()]);
  context.setView("today");
  assert.equal(elements.activeList.style.display, "");
  assert.equal(elements.smallList.style.display, "");
  assert.equal(elements.futureList.style.display, "none", "Future goals moved to their own tab");
  assert.equal(elements.archiveList.style.display, "none");
});

test("each new tab shows only its own kind of goal", () => {
  const { context, elements } = createHarness([activeGoal(), smallGoal(), futureGoal()]);

  context.setView("active");
  assert.equal(elements.activeList.style.display, "");
  assert.equal(elements.smallList.style.display, "none");
  assert.equal(elements.futureList.style.display, "none");
  assert.match(elements.activeList.innerHTML, /Earn my first 500/);

  context.setView("small");
  assert.equal(elements.smallList.style.display, "");
  assert.equal(elements.activeList.style.display, "none");
  assert.match(elements.smallList.innerHTML, /reading lamp/);

  context.setView("future");
  assert.equal(elements.futureList.style.display, "");
  assert.equal(elements.activeList.style.display, "none");
  assert.equal(elements.smallList.style.display, "none");
  assert.match(elements.futureList.innerHTML, /Become a mentalist/);

  context.setView("archive");
  assert.equal(elements.archiveList.style.display, "");
  assert.equal(elements.activeList.style.display, "none");
  assert.equal(elements.smallList.style.display, "none");
  assert.equal(elements.futureList.style.display, "none");
});

test("the old tabs still work exactly as they did", () => {
  const { context, elements } = createHarness([activeGoal(), dailyGoal()]);

  context.setView("daily");
  assert.equal(elements.dailyList.style.display, "");
  assert.equal(elements.activeList.style.display, "none");

  context.setView("ideas");
  assert.equal(elements.ideasList.style.display, "");

  context.setView("notifications");
  assert.equal(elements.notifyList.style.display, "");

  context.setView("victories");
  assert.equal(elements.doneWrap.style.display, "");
  assert.equal(elements.archiveList.style.display, "none");
});

test("only the selected tab is highlighted", () => {
  const { context, elements } = createHarness([activeGoal()]);
  context.setView("archive");
  assert.equal(elements.viewArchive.classList.contains("active"), true);
  assert.equal(elements.viewToday.classList.contains("active"), false);
  context.setView("future");
  assert.equal(elements.viewFuture.classList.contains("active"), true);
  assert.equal(elements.viewArchive.classList.contains("active"), false);
});

test("an unknown view falls back to Today", () => {
  const { context } = createHarness([activeGoal()]);
  context.setView("nonsense");
  assert.equal(context.currentView, "today");
});

/* ================================================================== */
/* 6. Sync and backup safety                                          */
/* ================================================================== */

test("archive state merges across devices with the newer side winning", () => {
  const { context } = createHarness([]);
  const local = JSON.stringify([{ id: "a1", title: "Tutoring", goalType: "active", archivedAt: 1787000000000 }]);
  const remote = JSON.stringify([{ id: "a1", title: "Tutoring", goalType: "active", archivedAt: null }]);
  const newerLocal = context.mergeGoalSyncValues(local, remote, 2000, 1000, {});
  assert.equal(newerLocal.items[0].archivedAt, 1787000000000, "the newer archive wins");
  const newerRemote = context.mergeGoalSyncValues(local, remote, 1000, 2000, {});
  assert.equal(newerRemote.items[0].archivedAt, null, "the newer restore wins");
});

test("archived goals are included in the backup payload and survive a restore", () => {
  const { context } = createHarness([activeGoal(), smallGoal()]);
  context.archiveGoal("m1");
  const envelope = context.buildBackupEnvelope();
  const restored = createHarness([]);
  assert.equal(restored.context.restoreFromEnvelope(envelope).ok, true);
  const parked = restored.context.goals.find((g) => g.id === "m1");
  assert.ok(parked.archivedAt > 0, "the archive state came back with the backup");
  assert.equal(restored.context.archivedGoals().length, 1);
});

test("exported goals keep their archive state through an export/import round trip", () => {
  const { context, storage } = createHarness([activeGoal(), smallGoal(), futureGoal()]);
  context.archiveGoal("f1");
  const reloaded = reload(storage);
  assert.equal(reloaded.context.archivedGoals().length, 1);
  assert.equal(reloaded.context.liveGoals().length, 2);
  assert.equal(reloaded.context.formalGoals().length, 3, "nothing was ever removed");
});
