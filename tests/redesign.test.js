/*
 * Goal System Redesign — Demo 1 (PLAN.md Phases 1-2).
 * Covers migration safety, legacy preservation, the new Small Goal model,
 * validation, draft state, the planning timer, copy export, and colors.
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
        if (shouldAdd) this.values.add(name); else this.values.delete(name);
        return shouldAdd;
      },
      contains(name) { return this.values.has(name); },
    },
    click() {},
    focus() {},
  };
}

function createHarness(seedGoals = []) {
  const elements = {};
  const storage = { "achieve.goals.v1": JSON.stringify(seedGoals) };
  const context = {
    console,
    Date,
    Math,
    Blob: class Blob { constructor(parts, options) { this.parts = parts; this.options = options; } },
    URL: { createObjectURL() { return "blob:test"; } },
    FileReader: class FileReader {},
    setTimeout() { return 0; },
    clearTimeout() {},
    setInterval() { return 0; },
    clearInterval() {},
    alert(message) { context.lastAlert = message; },
    prompt() { return context.nextPromptValue; },
    confirm() { return context.confirmValue !== false; },
    localStorage: {
      getItem(key) { return Object.prototype.hasOwnProperty.call(storage, key) ? storage[key] : null; },
      setItem(key, value) { storage[key] = String(value); },
    },
    document: {
      getElementById(id) {
        if (!elements[id]) elements[id] = createElement(id);
        return elements[id];
      },
      createElement(tag) { return createElement(tag); },
    },
    navigator: {
      clipboard: {
        writeText(text) { context.lastCopiedText = text; return Promise.resolve(); },
      },
    },
    window: {
      __storage: storage,
      __SKIP_CLOUD_SAVE: true,
      addEventListener() {},
      scrollTo() {},
    },
  };
  context.window.window = context.window;
  context.window.document = context.document;
  context.window.localStorage = context.localStorage;
  context.window.navigator = context.navigator;
  vm.createContext(context);
  vm.runInContext(extractScript(), context, { filename: "goal-app.html" });
  // The harness is a headless sandbox; cloud gating would otherwise block saves.
  context.cloudSave.user = { uid: "test" };
  context.cloudSave.initialReadDone = true;
  return { context, elements, storage };
}

function savedGoals(storage) {
  return JSON.parse(storage["achieve.goals.v1"]);
}

/* ------------------------------------------------------------------ */
/* 1. Normalization still preserves unknown fields                      */
/* ------------------------------------------------------------------ */

test("normalize still preserves unknown fields on existing goals", () => {
  const { context } = createHarness([]);
  const g = context.normalize({
    id: "keep-me",
    title: "Existing goal",
    someFutureField: { nested: [1, 2, 3] },
    anotherUnknown: "do not drop this",
  });
  assert.deepEqual(g.someFutureField, { nested: [1, 2, 3] });
  assert.equal(g.anotherUnknown, "do not drop this");
});

/* ------------------------------------------------------------------ */
/* 2-3. Legacy future -> needsPlanning migration                        */
/* ------------------------------------------------------------------ */

test("an existing future goal migrates to Needs Planning and keeps every original field", () => {
  const { context } = createHarness([]);
  const original = {
    id: "old-future",
    title: "Launch a private accountability group",
    goalType: "future",
    futureMonth: "2026-10",
    description: "A possible monthly group for people building income.",
    createdAt: 1750000000000,
  };
  const g = context.normalize(original);

  assert.equal(g.status, "needsPlanning", "legacy future records land in Needs Planning");
  assert.equal(g.legacyClassification, "future", "records remember they were classified future");
  // Phase 0B H-4: normalize must NOT invent a migration timestamp - two
  // devices would mint different values. legacyClassification is the durable
  // marker; the timestamp is written once by the controlled migration event.
  assert.equal(g.migratedAt, null, "normalize invents no device-local stamp");

  // Every original field survives byte-for-byte.
  assert.equal(g.goalType, "future", "goalType is not rewritten");
  assert.equal(g.title, original.title);
  assert.equal(g.futureMonth, "2026-10");
  assert.equal(g.description, original.description);
  assert.equal(g.createdAt, 1750000000000);
});

test("legacy future migration is idempotent and never re-stamps or downgrades", () => {
  const { context } = createHarness([]);
  const once = context.normalize({ id: "f", title: "Idea", goalType: "future" });
  const twice = context.normalize(once);
  assert.equal(twice.status, "needsPlanning");
  assert.equal(twice.migratedAt, once.migratedAt, "migratedAt is stable across loads");
  // And a record that ALREADY carries a stamp must never be re-stamped.
  const stamped = context.normalize({ id: "f", title: "Idea", goalType: "future", migratedAt: 1750000000000 });
  assert.equal(context.normalize(stamped).migratedAt, 1750000000000, "an existing stamp is never rewritten");
});

test("a legacy future goal that was already finished planning is not dragged back to Needs Planning", () => {
  const { context } = createHarness([]);
  const g = context.normalize({
    id: "f2", title: "Planned already", goalType: "future",
    status: "future", legacyClassification: "future", migratedAt: 123,
    deadline: "2027-01-01",
  });
  assert.equal(g.status, "future");
});

test("a legacy future goal is not presented as a valid new-format Future goal", () => {
  const { context } = createHarness([]);
  const g = context.normalize({ id: "f3", title: "Old idea", goalType: "future", futureMonth: "2026-10" });
  const result = context.validateFormalGoal(g, "future");
  assert.equal(result.ok, false, "it has no deadline and no Small Goals, so it cannot pass as Future");
});

/* ------------------------------------------------------------------ */
/* 4-5. Legacy #6 and Milestones survive everything                     */
/* ------------------------------------------------------------------ */

test("legacy Knowledge and People (#6) data survives normalization", () => {
  const { context } = createHarness([]);
  const g = context.normalize({ id: "l1", title: "Old goal", skills: "Learn calculus; ask Mr. Reed" });
  assert.equal(g.skills, "Learn calculus; ask Mr. Reed");
});

test("legacy Milestones survive normalization and are not converted into Small Goals", () => {
  const { context } = createHarness([]);
  const g = context.normalize({
    id: "l2", title: "Old goal",
    milestones: [{ text: "First milestone", done: true }, { text: "Second milestone", done: false }],
    smallGoals: [],
  });
  assert.equal(g.milestones.length, 2);
  assert.equal(g.milestones[0].text, "First milestone");
  assert.equal(g.milestones[0].done, true);
  assert.equal(g.smallGoals.length, 0, "milestones must NOT be auto-converted into Small Goals");
});

test("saving a legacy goal through the NEW form does not erase #6 or Milestones", () => {
  // This is the highest-risk regression: saveForm() rebuilds the record.
  const { context, elements } = createHarness([{
    id: "legacy-1",
    title: "A goal planned under the old system",
    goalType: "active",
    skills: "Learn Firebase security rules; ask Dan",
    milestones: [{ text: "Ship v1", done: true }, { text: "First paying user", done: false }],
    deadline: "2027-01-01",
  }]);

  context.openForm("legacy-1");
  elements.fTitle.value = "A goal planned under the old system, now edited";
  elements.fWhy.value = "Because proving I can finish what I plan is the whole point of this.";
  context.saveForm();

  const saved = context.goals.find((x) => x.id === "legacy-1");
  assert.equal(saved.skills, "Learn Firebase security rules; ask Dan", "#6 survived the save");
  assert.equal(saved.milestones.length, 2, "milestones survived the save");
  assert.equal(saved.milestones[0].text, "Ship v1");
  assert.equal(saved.milestones[0].done, true, "milestone completion state survived");
  assert.equal(saved.title, "A goal planned under the old system, now edited", "the edit still applied");
});

test("legacy planning details survive a full localStorage round trip", () => {
  const { context, storage } = createHarness([]);
  context.goals = [context.normalize({
    id: "rt", title: "Round trip", goalType: "active",
    skills: "Old knowledge notes", milestones: [{ text: "Old milestone", done: true }],
  })];
  context.save();
  const reloaded = context.normalizeGoals(savedGoals(storage));
  assert.equal(reloaded[0].skills, "Old knowledge notes");
  assert.equal(reloaded[0].milestones[0].text, "Old milestone");
});

test("the legacy panel is shown only on records that actually have legacy data", () => {
  const { context } = createHarness([]);
  const withLegacy = context.normalize({ id: "a", title: "x", skills: "something" });
  const withMilestones = context.normalize({ id: "b", title: "x", milestones: ["old milestone"] });
  const clean = context.normalize({ id: "c", title: "x" });
  assert.equal(context.hasLegacyPlanningDetails(withLegacy), true);
  assert.equal(context.hasLegacyPlanningDetails(withMilestones), true);
  assert.equal(context.hasLegacyPlanningDetails(clean), false);
});

/* ------------------------------------------------------------------ */
/* 6-7. New Goal creation no longer exposes #6 or Milestones            */
/* ------------------------------------------------------------------ */

test("new Goal creation no longer exposes Knowledge and People (#6)", () => {
  const html = fs.readFileSync(htmlPath, "utf8");
  const activeFields = html.slice(html.indexOf('<div id="activeFields">'), html.indexOf('<div class="modal-btns">'));
  assert.doesNotMatch(activeFields, /id="fSkills"/, "the #6 input is gone from the goal form");
  assert.doesNotMatch(activeFields, /Knowledge and people/i);
});

test("new Goal creation no longer exposes Milestones", () => {
  const html = fs.readFileSync(htmlPath, "utf8");
  const activeFields = html.slice(html.indexOf('<div id="activeFields">'), html.indexOf('<div class="modal-btns">'));
  assert.doesNotMatch(activeFields, /id="fMilestones"/, "the milestone input is gone from the goal form");
  assert.doesNotMatch(activeFields, /Milestone goals/i);
});

test("a newly created goal has no milestones and no skills content", () => {
  const { context, elements } = createHarness([]);
  context.openForm(null, "active");
  elements.fTitle.value = "I earn my first 500 dollars per month from APEX Learning";
  elements.fDeadline.value = "2027-06-01";
  context.saveDraft();
  const created = context.goals[context.goals.length - 1];
  assert.equal(created.skills, "");
  assert.deepEqual(JSON.parse(JSON.stringify(created.milestones)), []);
});

/* ------------------------------------------------------------------ */
/* 8. Deadline validation                                               */
/* ------------------------------------------------------------------ */

test("a formal Goal cannot be finalized without a deadline", () => {
  const { context } = createHarness([]);
  const draft = context.normalize({
    id: "d1", title: "I read twelve books before the year ends", goalType: "active",
    smallGoals: [
      { what: "Pick the first four books from the list", why: "Choosing early removes the excuse to stall", estimateMinutes: 30 },
      { what: "Read thirty pages every weekday morning", why: "A fixed slot is what makes this survive busy weeks", estimateMinutes: 45 },
      { what: "Write one page of notes per finished book", why: "Notes are how I prove I actually absorbed it", estimateMinutes: 60 },
    ],
  });
  const result = context.validateFormalGoal(draft, "active");
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /deadline/i.test(e)), `expected a deadline error, got ${JSON.stringify(result.errors)}`);
});

test("a malformed or past deadline is rejected", () => {
  const { context } = createHarness([]);
  const base = {
    id: "d2", title: "I read twelve books before the year ends", goalType: "active",
    smallGoals: [
      { what: "Pick the first four books from the list", why: "Choosing early removes the excuse to stall", estimateMinutes: 30 },
      { what: "Read thirty pages every weekday morning", why: "A fixed slot is what makes this survive busy weeks", estimateMinutes: 45 },
    ],
  };
  const malformed = context.validateFormalGoal(context.normalize({ ...base, deadline: "not-a-date" }), "future");
  assert.equal(malformed.ok, false);
  assert.ok(malformed.errors.some((e) => /deadline/i.test(e)));

  const past = context.validateFormalGoal(context.normalize({ ...base, deadline: "2020-01-01" }), "future");
  assert.equal(past.ok, false);
  assert.ok(past.errors.some((e) => /deadline/i.test(e)));
});

/* ------------------------------------------------------------------ */
/* 9-10. Small Goal WHAT / WHY validation                               */
/* ------------------------------------------------------------------ */

test("a Small Goal requires a WHAT", () => {
  const { context } = createHarness([]);
  const result = context.validateSmallGoal({ what: "", why: "Because it moves the main goal forward meaningfully", estimateMinutes: 30 });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /what/i.test(e)));
});

test("a Small Goal requires a WHY", () => {
  const { context } = createHarness([]);
  const result = context.validateSmallGoal({ what: "Write the first draft of the offer page", why: "", estimateMinutes: 30 });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /why/i.test(e)));
});

test("a vague Small Goal WHAT is rejected", () => {
  const { context } = createHarness([]);
  const result = context.validateSmallGoal({ what: "Work on math", why: "Because I need to get better at algebra before the exam", estimateMinutes: 30 });
  assert.equal(result.ok, false, "'Work on math' is the exact vagueness PLAN.md calls out");
});

test("filler answers are detected and rejected", () => {
  const { context } = createHarness([]);
  ["idk", "good", "yes", "n/a", "tbd", "stuff", "   ", "asdf"].forEach((filler) => {
    assert.equal(context.isFillerAnswer(filler), true, `${JSON.stringify(filler)} should be treated as filler`);
  });
  assert.equal(context.isFillerAnswer("Because finishing this proves I can build income from my own skills"), false);
});

test("a well-formed Small Goal passes", () => {
  const { context } = createHarness([]);
  const result = context.validateSmallGoal({
    what: "Write the first draft of the offer page",
    why: "Nothing can be sold until the offer is actually written down",
    estimateMinutes: 45,
  });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});

/* ------------------------------------------------------------------ */
/* 11. Estimated duration + effort preservation                         */
/* ------------------------------------------------------------------ */

test("Small Goal estimated duration survives normalization and a save/reload round trip", () => {
  const { context, storage } = createHarness([]);
  context.goals = [context.normalize({
    id: "e1", title: "Effort", goalType: "active",
    estimatedEffortHours: 40,
    smallGoals: [{ id: "sg1", text: "Draft the page", what: "Draft the page", why: "It has to exist first", estimateMinutes: 90 }],
  })];
  context.save();
  const reloaded = context.normalizeGoals(savedGoals(storage));
  assert.equal(reloaded[0].smallGoals[0].estimateMinutes, 90);
  assert.equal(reloaded[0].estimatedEffortHours, 40);
});

test("Small Goal durations roll up as a hint without overwriting the manual effort estimate", () => {
  const { context } = createHarness([]);
  const g = context.normalize({
    id: "e2", title: "Effort", goalType: "active", estimatedEffortHours: 10,
    smallGoals: [
      { text: "a", what: "a", why: "b", estimateMinutes: 60 },
      { text: "b", what: "b", why: "c", estimateMinutes: 30 },
    ],
  });
  assert.equal(context.smallGoalMinutesTotal(g), 90);
  assert.equal(g.estimatedEffortHours, 10, "the manual estimate is never auto-overwritten by the rollup");
});

/* ------------------------------------------------------------------ */
/* 12-13. Minimum Small Goal counts                                     */
/* ------------------------------------------------------------------ */

function draftWithSmallGoals(context, count) {
  const smallGoals = [];
  const seeds = [
    ["Write the first draft of the offer page", "Nothing can be sold until the offer is actually written"],
    ["Ask three people for direct feedback", "Outside feedback catches what I cannot see myself"],
    ["Publish the page and share the link", "Shipping it is the only thing that creates real signal"],
    ["Follow up with everyone who replied", "Momentum dies if I let replies go cold"],
  ];
  for (let i = 0; i < count; i += 1) {
    smallGoals.push({ what: seeds[i][0], why: seeds[i][1], estimateMinutes: 30 });
  }
  return context.normalize({
    id: `c${count}`, title: "I earn my first 500 dollars per month", goalType: "active",
    deadline: "2027-06-01", smallGoals,
  });
}

test("a Future Goal requires at least 2 Small Goals", () => {
  const { context } = createHarness([]);
  const tooFew = context.validateFormalGoal(draftWithSmallGoals(context, 1), "future");
  assert.equal(tooFew.ok, false);
  assert.ok(tooFew.errors.some((e) => /2 small goals/i.test(e)), JSON.stringify(tooFew.errors));

  const enough = context.validateFormalGoal(draftWithSmallGoals(context, 2), "future");
  assert.equal(enough.ok, true, JSON.stringify(enough.errors));
});

test("an Active Goal requires at least 3 Small Goals", () => {
  const { context } = createHarness([]);
  const tooFew = context.validateFormalGoal(draftWithSmallGoals(context, 2), "active");
  assert.equal(tooFew.ok, false);
  assert.ok(tooFew.errors.some((e) => /3 small goals/i.test(e)), JSON.stringify(tooFew.errors));

  const enough = context.validateFormalGoal(draftWithSmallGoals(context, 3), "active");
  assert.equal(enough.ok, true, JSON.stringify(enough.errors));
});

/* ------------------------------------------------------------------ */
/* 14. Draft behaviour                                                  */
/* ------------------------------------------------------------------ */

test("an incomplete Goal can be saved as a Draft without passing validation", () => {
  const { context, elements } = createHarness([]);
  context.openForm(null, "active");
  elements.fTitle.value = "Something I have not finished thinking about";
  context.saveDraft();
  const created = context.goals[context.goals.length - 1];
  assert.equal(created.status, "draft");
  assert.equal(context.goals.length, 1, "the draft was actually stored");
});

test("a Draft cannot be finalized until it passes validation, and is not silently promoted", () => {
  const { context, elements } = createHarness([]);
  context.openForm(null, "active");
  elements.fTitle.value = "Something I have not finished thinking about";
  context.saveDraft();
  const id = context.goals[context.goals.length - 1].id;

  const promoted = context.finalizeGoal(id, "active");
  assert.equal(promoted, false, "finalize refuses an invalid draft");
  assert.equal(context.goals.find((x) => x.id === id).status, "draft", "the draft stays a draft");
});

test("a valid Draft can be finalized to Future or Active, and only when asked", () => {
  const { context } = createHarness([]);
  context.goals = [draftWithSmallGoals(context, 3)];
  context.goals[0].status = "draft";
  const id = context.goals[0].id;

  assert.equal(context.finalizeGoal(id, "future"), true);
  assert.equal(context.goals[0].status, "future");

  assert.equal(context.finalizeGoal(id, "active"), true);
  assert.equal(context.goals[0].status, "active");
});

test("a migrated legacy future goal can be finished into Future or Active by the operator", () => {
  const { context } = createHarness([]);
  const legacy = context.normalize({ id: "lf", title: "Launch the accountability group", goalType: "future", futureMonth: "2026-10", description: "Original description" });
  context.goals = [legacy];
  assert.equal(legacy.status, "needsPlanning");
  assert.equal(context.finalizeGoal("lf", "future"), false, "it still fails the new rules until planning is finished");

  // Operator finishes the planning.
  legacy.deadline = "2027-03-01";
  legacy.smallGoals = context.normalizeSmallGoals([
    { what: "Write the group charter and rules", why: "People will not join something with unclear terms" },
    { what: "Invite the first five members personally", why: "A direct ask is what actually fills the first cohort" },
  ]);
  assert.equal(context.finalizeGoal("lf", "future"), true);
  assert.equal(context.goals[0].status, "future");
  assert.equal(context.goals[0].description, "Original description", "original content is still intact");
  assert.equal(context.goals[0].legacyClassification, "future", "its origin is still recorded");
});

test("opening a Needs Planning record opens the FULL planning form, not the light idea form", () => {
  const { context, elements } = createHarness([{
    id: "old-future", title: "Launch the group", goalType: "future", futureMonth: "2026-10",
    description: "Original description",
  }]);
  assert.equal(context.goals[0].status, "needsPlanning");

  context.openForm("old-future");
  assert.equal(context.formMode, "active", "it must open the formal planning questions");
  assert.equal(elements.fTitle.value, "Launch the group", "existing content is loaded, not discarded");
  assert.equal(elements.planActions.style.display, "", "the operator is offered Future or Active, and chooses");
});

test("a Needs Planning record stays visible in the app and is labelled, not hidden or errored", () => {
  const { context, elements } = createHarness([{
    id: "old-future", title: "Launch the group", goalType: "future", futureMonth: "2026-10",
  }]);
  context.render();
  const html = elements.futureList.innerHTML;
  assert.match(html, /Launch the group/, "the record is still visible");
  assert.match(html, /Needs planning/i, "and is labelled as needing planning");
  assert.doesNotMatch(html, /error|invalid|broken/i, "it is not presented as an error");
});

/* ------------------------------------------------------------------ */
/* 15-16. Planning timer                                                */
/* ------------------------------------------------------------------ */

test("the planning timer starts when formal planning opens and counts down", () => {
  const { context } = createHarness([]);
  const timer = context.startPlanningTimer(20, 1000);
  assert.equal(timer.durationMinutes, 20);
  assert.equal(timer.startedAt, 1000);

  const early = context.planningTimerState(timer, 1000 + 5 * 60000);
  assert.equal(early.expired, false);
  assert.equal(early.remainingMs, 15 * 60000);
});

test("the planning timer is not hard-coded to 10 minutes", () => {
  const { context } = createHarness([]);
  assert.ok(context.PLANNING_TIMER_PRESETS.length >= 5);
  [10, 20, 30, 45, 60].forEach((m) => assert.ok(context.PLANNING_TIMER_PRESETS.includes(m), `${m} should be offered`));
  assert.equal(context.startPlanningTimer(45, 0).durationMinutes, 45, "a custom duration is honoured");
});

test("timer expiration points at AI review and does NOT lock or erase the draft", () => {
  const { context, elements } = createHarness([]);
  context.openForm(null, "active");
  elements.fTitle.value = "A goal I am part way through planning";
  elements.fWhy.value = "Because I want to prove the timer does not eat my work in progress";

  const timer = context.startPlanningTimer(10, 0);
  const state = context.planningTimerState(timer, 11 * 60000);
  assert.equal(state.expired, true);
  assert.equal(state.remainingMs, 0);
  assert.match(context.planningTimerMessage(state), /review goal with ai/i);

  context.handlePlanningTimerExpiry();
  assert.equal(elements.fTitle.value, "A goal I am part way through planning", "the draft text is untouched");
  assert.equal(elements.fWhy.value, "Because I want to prove the timer does not eat my work in progress");
  assert.equal(elements.overlay.classList.contains("open"), true, "the form is not force-closed");
  assert.equal(context.formLocked, false, "the form is not locked");

  // And saving still works after expiry.
  context.saveDraft();
  assert.equal(context.goals.length, 1);
});

/* ------------------------------------------------------------------ */
/* 17. Copy Everything / Copy for AI Review                             */
/* ------------------------------------------------------------------ */

test("Copy Everything contains the entire draft, not only required fields", () => {
  const { context } = createHarness([]);
  const g = context.normalize({
    id: "copy1",
    title: "I earn my first 500 dollars per month from APEX Learning",
    goalType: "active", mdp: true, status: "draft",
    why: "Proof I can build income from my own skills",
    deadline: "2027-06-01",
    start: "I have a working app and zero paying users right now",
    obstacles: "School takes most of my weekday attention",
    estimatedEffortHours: 40,
    color: "amber",
    skills: "LEGACY knowledge note",
    milestones: [{ text: "LEGACY milestone", done: true }],
    smallGoals: [{
      what: "Write the first draft of the offer page",
      why: "Nothing can be sold until the offer is written down",
      estimateMinutes: 90,
      steps: ["Outline the sections", "Write the headline"],
    }],
  });

  const text = context.buildGoalCopyText(g, "everything");
  [
    "I earn my first 500 dollars per month from APEX Learning",
    "Major Definite Purpose",
    "Proof I can build income from my own skills",
    "2027-06-01",
    "I have a working app and zero paying users right now",
    "School takes most of my weekday attention",
    "Write the first draft of the offer page",
    "Nothing can be sold until the offer is written down",
    "Outline the sections",
    "LEGACY knowledge note",
    "LEGACY milestone",
  ].forEach((needle) => {
    assert.ok(text.includes(needle), `Copy Everything should include ${JSON.stringify(needle)}`);
  });
  assert.match(text, /90m|1h 30m/, "small goal duration is included");
  assert.match(text, /40/, "estimated total effort is included");
});

test("Copy for AI Review adds review instructions that forbid realism judgements and wholesale rewrites", () => {
  const { context } = createHarness([]);
  const g = context.normalize({ id: "copy2", title: "A goal to review", goalType: "active", deadline: "2027-06-01" });
  const text = context.buildGoalCopyText(g, "review");
  assert.ok(text.includes("A goal to review"), "the whole draft is still included");
  assert.match(text, /do not judge whether.*realistic/i);
  assert.match(text, /do not rewrite/i);
  assert.match(text, /what.*why/i, "it asks the reviewer to check Small Goal WHAT and WHY");
});

/* ------------------------------------------------------------------ */
/* 18. Goal colors                                                      */
/* ------------------------------------------------------------------ */

test("every Goal gets a color and it persists across a save/reload round trip", () => {
  const { context, storage } = createHarness([]);
  const g = context.normalize({ id: "c1", title: "Colored goal", goalType: "active" });
  assert.ok(g.color, "a color is assigned");
  assert.ok(context.GOAL_COLORS.some((c) => c.id === g.color), "the color comes from the palette");

  context.goals = [g];
  context.save();
  const reloaded = context.normalizeGoals(savedGoals(storage));
  assert.equal(reloaded[0].color, g.color, "the color is stable, not re-rolled on every load");
});

test("a manually chosen Goal color is respected and colors carry no status meaning", () => {
  const { context } = createHarness([]);
  const g = context.normalize({ id: "c2", title: "x", goalType: "active", color: "violet" });
  assert.equal(g.color, "violet");

  // The same color is legal on any status - color is decorative only.
  const active = context.normalize({ id: "c3", title: "x", goalType: "active", status: "active", color: "violet" });
  const draft = context.normalize({ id: "c4", title: "x", goalType: "active", status: "draft", color: "violet" });
  assert.equal(active.color, draft.color);
});

/* ------------------------------------------------------------------ */
/* 19. Full round trip with old and new fields together                 */
/* ------------------------------------------------------------------ */

test("a save/reload round trip loses neither new fields nor old fields", () => {
  const { context, storage } = createHarness([]);
  context.goals = [context.normalize({
    id: "mixed",
    title: "A goal with both old and new data",
    goalType: "active",
    status: "draft",
    color: "teal",
    estimatedEffortHours: 25,
    planningMinutesSpent: 18,
    deadline: "2027-05-01",
    why: "Both generations of data must survive together",
    skills: "LEGACY: ask Dan about Firestore rules",
    milestones: [{ text: "LEGACY: ship v1", done: true }],
    smallGoals: [{ id: "sg", text: "Draft the page", what: "Draft the page", why: "It must exist first", estimateMinutes: 90, steps: [{ text: "Outline", done: true }] }],
    unknownFutureField: "preserve me",
  })];
  context.save();

  const reloaded = context.normalizeGoals(savedGoals(storage));
  const g = reloaded[0];
  assert.equal(g.status, "draft");
  assert.equal(g.color, "teal");
  assert.equal(g.estimatedEffortHours, 25);
  assert.equal(g.planningMinutesSpent, 18);
  assert.equal(g.skills, "LEGACY: ask Dan about Firestore rules");
  assert.equal(g.milestones[0].text, "LEGACY: ship v1");
  assert.equal(g.milestones[0].done, true);
  assert.equal(g.smallGoals[0].what, "Draft the page");
  assert.equal(g.smallGoals[0].why, "It must exist first");
  assert.equal(g.smallGoals[0].estimateMinutes, 90);
  assert.equal(g.smallGoals[0].steps[0].text, "Outline");
  assert.equal(g.smallGoals[0].steps[0].done, true);
  assert.equal(g.unknownFutureField, "preserve me");
});

test("nothing serialized to storage is undefined, so Firestore serialization stays safe", () => {
  const { context, storage } = createHarness([]);
  context.goals = [context.normalize({ id: "s1", title: "Serialization", goalType: "active" })];
  context.save();
  const raw = storage["achieve.goals.v1"];
  assert.doesNotMatch(raw, /:undefined/);
  const walk = (value) => {
    if (Array.isArray(value)) return value.forEach(walk);
    if (value && typeof value === "object") {
      Object.entries(value).forEach(([key, v]) => {
        assert.notEqual(v, undefined, `${key} must not be undefined`);
        walk(v);
      });
    }
  };
  walk(JSON.parse(raw));
});

/* ------------------------------------------------------------------ */
/* Adversarial pass findings                                            */
/* ------------------------------------------------------------------ */

test("normalizing the same data twice produces identical JSON, so sync sees no phantom change", () => {
  // normalize() runs on every load AND every save. A fresh timestamp per call
  // would make two reads of identical data serialize differently and could
  // trigger spurious sync conflicts.
  const { context } = createHarness([]);
  const raw = [{ id: "old-future", title: "Legacy idea", goalType: "future", futureMonth: "2026-10" }];
  const first = JSON.stringify(context.normalizeGoals(raw));
  const second = JSON.stringify(context.normalizeGoals(raw));
  assert.equal(first, second);
});

test("activating a Future goal keeps status and goalType in step", () => {
  const { context } = createHarness([{ id: "f", title: "Planned goal", goalType: "future", status: "future", deadline: "2027-01-01" }]);
  context.activateFutureGoal("f");
  const g = context.goals.find((x) => x.id === "f");
  assert.equal(g.goalType, "active");
  assert.equal(g.status, "active", "status must not still claim Future while rendering as active");
});

test("a Draft never appears in Today's active focus", () => {
  const { context, elements } = createHarness([
    { id: "real", title: "A finalized active goal", goalType: "active", status: "active", deadline: "2027-01-01" },
    { id: "wip", title: "A half-finished draft", goalType: "active", status: "draft" },
  ]);
  context.render();
  const html = elements.activeList.innerHTML;
  assert.match(html, /Drafts - 1 being planned/, "drafts get their own section");
  assert.match(html, /A half-finished draft/);
  const focusSection = html.slice(html.indexOf("Today's active focus"));
  assert.doesNotMatch(focusSection, /A half-finished draft/, "the draft is not counted as a live goal");
  assert.match(focusSection, /A finalized active goal/);
});

test("saving a draft keeps the form open, and finalize is never hidden behind a discovered step", () => {
  const { context, elements } = createHarness([]);
  context.openForm(null, "active");
  // Finalize controls are visible from the moment planning opens...
  assert.equal(elements.planActions.style.display, "", "planning actions are visible immediately");
  assert.equal(elements.btnFinalizeActive.disabled, true, "...but disabled until requirements are met");
  assert.match(elements.readinessBox.innerHTML, /still needed/i, "and the UI says what is missing");

  elements.fTitle.value = "A goal I am still planning out";
  context.saveDraft();
  assert.equal(elements.overlay.classList.contains("open"), true, "the form stays open");
  assert.equal(context.goals.length, 1);
});

test("removing a Small Goal in the form does not disturb the identity of the others", () => {
  const { context, elements } = createHarness([{
    id: "g", title: "Goal with children", goalType: "active", status: "draft",
    smallGoals: [
      { id: "keep-1", text: "First", what: "First", why: "Because first", done: true, createdAt: 1, completedAt: 2 },
      { id: "drop", text: "Second", what: "Second", why: "Because second" },
      { id: "keep-2", text: "Third", what: "Third", why: "Because third" },
    ],
  }]);
  context.openForm("g");
  context.removeFormSmallGoal(context.formChildSmallGoals[1].id);
  elements.fTitle.value = "Goal with children";
  context.saveForm();
  const saved = context.goals[0].smallGoals;
  assert.deepEqual(JSON.parse(JSON.stringify(saved.map((s) => s.id))), ["keep-1", "keep-2"]);
  assert.equal(saved[0].done, true, "completion state of an untouched child survives");
  assert.equal(saved[0].createdAt, 1);
});

/* ------------------------------------------------------------------ */
/* 20. Existing behaviour is preserved                                  */
/* ------------------------------------------------------------------ */

test("daily and standalone small goals are untouched by the redesign", () => {
  const { context } = createHarness([]);
  const daily = context.normalize({ id: "d", title: "Morning routine", goalType: "daily", dailyMinimum: "Brush teeth", dailyStandard: "Full routine" });
  assert.equal(daily.goalType, "daily");
  assert.equal(daily.dailyMinimum, "Brush teeth");
  const small = context.normalize({ id: "s", title: "Call one customer", goalType: "small", targetDate: "2026-08-20" });
  assert.equal(small.goalType, "small");
  assert.equal(small.targetDate, "2026-08-20");
});
