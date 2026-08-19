/*
 * Demo 1 revision — regression tests for every bug fixed in this pass.
 * Grouped by the item number in Joel's review.
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
  assert.ok(match, "goal-app.html should contain one script block");
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

function createHarness(seedGoals = []) {
  const elements = {};
  const storage = { "achieve.goals.v1": JSON.stringify(seedGoals) };
  const context = {
    console, Date, Math,
    Blob: class Blob {}, URL: { createObjectURL: () => "blob:test" }, FileReader: class FileReader {},
    setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    alert(m) { context.lastAlert = m; },
    prompt() { context.promptWasCalled = true; return context.nextPromptValue; },
    confirm() { return context.confirmValue !== false; },
    localStorage: {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(storage, k) ? storage[k] : null),
      setItem: (k, v) => { storage[k] = String(v); },
    },
    document: {
      getElementById(id) { if (!elements[id]) elements[id] = createElement(id); return elements[id]; },
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

function fillSmallGoals(context, count) {
  const seeds = [
    ["Write a one page tutoring offer and price list", "Nothing can be sold until the offer is written down"],
    ["Message ten parents from the school directory", "Direct outreach is what creates the first clients"],
    ["Run one free trial session and ask for a referral", "A referral from a happy parent beats any advert"],
  ];
  context.formChildSmallGoals = [];
  for (let i = 0; i < count; i += 1) {
    context.addFormSmallGoal();
    const id = context.formChildSmallGoals[context.formChildSmallGoals.length - 1].id;
    context.updateFormSmallGoal(id, "what", seeds[i][0]);
    context.updateFormSmallGoal(id, "why", seeds[i][1]);
    context.updateFormSmallGoal(id, "estimateMinutes", 45);
  }
}

/* ================================================================== */
/* 1. WHAT / WHY / duration are visible during execution               */
/* ================================================================== */

test("an Active Goal card shows each Small Goal's WHAT, WHY and estimated duration", () => {
  const { context, elements } = createHarness([{
    id: "a", title: "Earn my first 500 per month", goalType: "active", status: "active", deadline: "2027-06-01",
    smallGoals: [{
      id: "sg1", what: "Write a one page tutoring offer", why: "Nothing can be sold until the offer exists",
      estimateMinutes: 90, done: false, steps: [],
    }],
  }]);
  context.render();
  const html = elements.activeList.innerHTML;
  assert.match(html, /Write a one page tutoring offer/, "WHAT is on the card");
  assert.match(html, /Nothing can be sold until the offer exists/, "WHY is on the card while executing");
  assert.match(html, /1h 30m/, "the estimated duration is on the card");
});

test("WHY is not locked away in the planning form", () => {
  const html = fs.readFileSync(htmlPath, "utf8");
  const card = html.slice(html.indexOf("function smallGoalsSummaryHtml"), html.indexOf("function legacyMilestonesHtml"));
  assert.match(card, /item\.why/, "the card renderer reads WHY directly");
});

/* ================================================================== */
/* 2. Future deadline rendering                                        */
/* ================================================================== */

test("a planned Future Goal shows its real deadline, never 'Someday'", () => {
  const { context, elements } = createHarness([{
    id: "f", title: "Launch the accountability group", goalType: "future", status: "future",
    deadline: "2027-03-01", smallGoals: [],
  }]);
  context.render();
  const html = elements.futureList.innerHTML;
  assert.match(html, /2027-03-01/, "the mandatory deadline is displayed");
  assert.doesNotMatch(html, /Someday/, "'Someday' must not appear when a real deadline exists");
});

test("an unplanned legacy record still falls back to its rough month estimate", () => {
  const { context, elements } = createHarness([{ id: "l", title: "Old idea", goalType: "future", futureMonth: "2027-02" }]);
  context.render();
  assert.match(elements.futureList.innerHTML, /February 2027/);
});

/* ================================================================== */
/* 3. Editing a finalized Future Goal                                  */
/* ================================================================== */

test("a finalized Future Goal opens the full planner with Copy for AI review available", () => {
  const { context, elements } = createHarness([{
    id: "f", title: "Launch the accountability group", goalType: "future", status: "future",
    deadline: "2027-03-01", why: "It is the natural next step after tutoring",
    obstacles: "I have never run a group before",
    smallGoals: [{ id: "s", what: "Write the group charter", why: "Nobody joins something with unclear terms", estimateMinutes: 60 }],
  }]);
  context.openForm("f");
  assert.equal(context.formMode, "active");
  assert.equal(elements.fWhy.value, "It is the natural next step after tutoring");
  assert.equal(elements.fObstacles.value, "I have never run a group before");
  assert.equal(context.formChildSmallGoals[0].what, "Write the group charter");
  assert.equal(context.formChildSmallGoals[0].estimateMinutes, 60);
  assert.equal(elements.planActions.style.display, "");
  const copy = context.buildGoalCopyText(context.currentFormGoalDraft(), "review");
  assert.match(copy, /Write the group charter/);
});

/* ================================================================== */
/* 4. One Small Goal contract                                          */
/* ================================================================== */

test("there is no second path that accepts a Small Goal with no WHY", () => {
  const { context } = createHarness([{ id: "g", title: "Goal", goalType: "active", smallGoals: [] }]);
  assert.equal(context.addSmallGoal("g", "Study"), false);
  assert.equal(context.addSmallGoal("g", "Read the whole chapter", ""), false, "missing WHY is refused");
  assert.equal(context.saveChildSmallGoal("g", "nope", "Anything", "", ""), false);
  assert.equal(context.goals[0].smallGoals.length, 0);

  assert.equal(context.addSmallGoal("g", "Read chapter four and summarise it", "", "It is the section the exam always tests", 45), true);
  assert.equal(context.goals[0].smallGoals.length, 1);
  assert.equal(context.goals[0].smallGoals[0].why, "It is the section the exam always tests");
});

test("the manager keeps recovery but no longer authors Small Goals", () => {
  const { context, elements } = createHarness([{
    id: "g", title: "Goal", goalType: "active",
    smallGoals: [{ id: "c", what: "Read chapter four", why: "It is what the exam tests", estimateMinutes: 45, steps: [] }],
    smallGoalsTrash: [{ id: "t", text: "Deleted one", deletedAt: 5, steps: [] }],
  }]);
  context.openSmallGoals("g");
  const html = elements.smallGoalsList.innerHTML;
  assert.match(html, /Restore Deleted one/, "recovery is preserved");
  assert.match(html, /Delete Read chapter four/, "deletion is preserved");
  assert.doesNotMatch(html, /childTitle-/, "no authoring editor is rendered");
});

/* ================================================================== */
/* 5. Validation: low minimum + vagueness detection                    */
/* ================================================================== */

test("concise but specific answers PASS", () => {
  const { context } = createHarness([]);
  [
    "Deadlift 315 pounds",
    "Run a sub-20 5k",
    "Finish Algebra 2",
    "Save $5000",
    "Read 12 books",
  ].forEach((answer) => {
    assert.equal(context.qualityError(answer, "The goal"), "", `${JSON.stringify(answer)} should pass: concise but specific`);
  });
});

test("obvious filler FAILS", () => {
  const { context } = createHarness([]);
  ["idk", "good", "yes", "n/a", "tbd", "stuff", "   ", "asdf", "ok"].forEach((answer) => {
    assert.notEqual(context.qualityError(answer, "The goal"), "", `${JSON.stringify(answer)} should fail`);
  });
});

test("repeated filler FAILS however long it is", () => {
  const { context } = createHarness([]);
  [
    "good good good good good good",
    "idk idk idk idk",
    "yes yes yes yes yes yes yes yes",
  ].forEach((answer) => {
    assert.notEqual(context.qualityError(answer, "The goal"), "", `${JSON.stringify(answer)} should fail`);
  });
});

test("padded vagueness FAILS even though it is long enough to beat a word count", () => {
  const { context } = createHarness([]);
  [
    "I really want this because it would be a very good thing",
    "It is important and I want it a lot and it would be nice",
    "I want to do better and improve and be more successful soon",
  ].forEach((answer) => {
    assert.notEqual(context.qualityError(answer, "The goal"), "",
      `${JSON.stringify(answer)} should fail: length is not specificity`);
  });
});

test("vague Small Goal actions FAIL", () => {
  const { context } = createHarness([]);
  ["Work on math", "Study", "Practice", "Do homework", "Review", "Get better at writing"].forEach((what) => {
    const result = context.validateSmallGoal({ what, why: "It moves the main goal forward in a real way", estimateMinutes: 30 });
    assert.equal(result.ok, false, `${JSON.stringify(what)} should fail as an action`);
  });
});

test("useful concise Small Goals PASS", () => {
  const { context } = createHarness([]);
  [
    ["Deadlift 315 pounds", "It is the strength milestone I set for the year"],
    ["Email ten parents", "Direct outreach is what creates the first clients"],
    ["Study the rational functions chapter", "It is the unit I keep failing questions on"],
    ["Draft the offer page", "Nothing can be sold until the offer exists"],
  ].forEach((pair) => {
    const result = context.validateSmallGoal({ what: pair[0], why: pair[1], estimateMinutes: 30 });
    assert.equal(result.ok, true, `${JSON.stringify(pair[0])} should pass: ${JSON.stringify(result.errors)}`);
  });
});

test("a specific action starting with a vague opener still passes", () => {
  const { context } = createHarness([]);
  // The opener alone must not condemn it - only an opener with nothing after it.
  const result = context.validateSmallGoal({
    what: "Study the rational functions chapter and redo the quiz",
    why: "It is the exact unit I keep losing marks on",
    estimateMinutes: 60,
  });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});

/* ================================================================== */
/* Save / Draft / Finalize clarity                                     */
/* ================================================================== */

test("finalize controls are visible from the start, disabled, and explain what is missing", () => {
  const { context, elements } = createHarness([]);
  context.openForm(null, "active");
  assert.equal(elements.planActions.style.display, "", "not hidden behind a discovered step");
  assert.equal(elements.btnFinalizeActive.disabled, true);
  assert.equal(elements.btnFinalizeFuture.disabled, true);
  assert.match(elements.readinessBox.innerHTML, /still needed/i);
  assert.match(elements.readinessBox.innerHTML, /deadline/i, "it names the missing deadline");
});

test("finalize enables for Future at 2 Small Goals and for Active at 3", () => {
  const { context, elements } = createHarness([]);
  context.openForm(null, "active");
  elements.fTitle.value = "Earn my first 500 per month from tutoring";
  elements.fTitleBig.value = elements.fTitle.value;
  elements.fDeadline.value = "2027-06-01";

  fillSmallGoals(context, 2);
  context.updateReadiness();
  assert.equal(elements.btnFinalizeFuture.disabled, false, "2 Small Goals is enough for Future");
  assert.equal(elements.btnFinalizeActive.disabled, true, "but not for Active");

  fillSmallGoals(context, 3);
  context.updateReadiness();
  assert.equal(elements.btnFinalizeActive.disabled, false, "3 Small Goals enables Active");
  assert.match(elements.readinessBox.innerHTML, /Ready to finalize/i);
});

test("an empty title reports inline, not through a native alert", () => {
  const { context, elements } = createHarness([]);
  context.openForm(null, "active");
  context.lastAlert = undefined;
  const result = context.saveDraft();
  assert.equal(result, false);
  assert.equal(context.lastAlert, undefined, "no native dialog");
  assert.notEqual(elements.formErrors.style.display, "none");
  assert.match(elements.formErrors.innerHTML, /Write the goal down/i);
});

/* ================================================================== */
/* Live Small Goal feedback                                            */
/* ================================================================== */

test("Small Goal WHAT and WHY give live advisory feedback before finalize", () => {
  const { context } = createHarness([]);
  assert.equal(context.smallGoalFieldHint("what", "").level, "empty");
  assert.equal(context.smallGoalFieldHint("what", "Work on math").level, "weak");
  assert.equal(context.smallGoalFieldHint("what", "Email ten parents").level, "ok");
  assert.equal(context.smallGoalFieldHint("why", "idk").level, "weak");
  assert.equal(context.smallGoalFieldHint("why", "It is what creates the first clients").level, "ok");
});

test("a weak entry does not look valid while typing", () => {
  const { context, elements } = createHarness([]);
  context.openForm(null, "active");
  context.addFormSmallGoal();
  const id = context.formChildSmallGoals[0].id;
  context.updateFormSmallGoal(id, "what", "Study");
  assert.equal(elements["sgWhatHint-" + id].className, "sg-hint weak");
  context.updateFormSmallGoal(id, "what", "Study the rational functions chapter");
  assert.equal(elements["sgWhatHint-" + id].className, "sg-hint ok");
});

/* ================================================================== */
/* Timer                                                               */
/* ================================================================== */

test("opening a NEW planning session starts the timer automatically", () => {
  const { context } = createHarness([]);
  context.openForm(null, "active");
  assert.ok(context.planningTimer, "the timer starts on its own");
  assert.equal(context.planningTimer.durationMinutes, 20);
  assert.equal(context.planningTimer.resumed, false);
});

test("reopening an existing Draft resumes rather than resetting planning history", () => {
  const { context } = createHarness([{
    id: "d", title: "A draft I started yesterday", goalType: "active", status: "draft",
    planningMinutesSpent: 35, planningTimerMinutes: 45,
  }]);
  context.openForm("d");
  assert.equal(context.planningTimer.resumed, true, "this is a resumed session, not a brand-new one");
  assert.equal(context.planningTimer.durationMinutes, 45, "the chosen length is remembered");
  assert.equal(context.goals[0].planningMinutesSpent, 35, "existing history is not wiped");
});

test("planningMinutesSpent does not double-count across repeated saves", () => {
  const { context, elements } = createHarness([]);
  context.openForm(null, "active");
  elements.fTitle.value = "A goal I am planning";
  // Pretend 10 minutes have passed.
  context.planningTimer.startedAt = Date.now() - 10 * 60000;

  context.saveDraft();
  const first = context.goals[0].planningMinutesSpent;
  assert.ok(first >= 9 && first <= 11, `expected about 10 minutes, got ${first}`);

  context.saveDraft();
  const second = context.goals[0].planningMinutesSpent;
  assert.equal(second, first, "saving again must not add the same 10 minutes twice");

  context.saveDraft();
  assert.equal(context.goals[0].planningMinutesSpent, first, "and again");
});

test("changing the timer length banks elapsed time instead of losing or doubling it", () => {
  const { context, elements } = createHarness([]);
  context.openForm(null, "active");
  elements.fTitle.value = "A goal I am planning";
  context.planningTimer.startedAt = Date.now() - 5 * 60000;
  context.setPlanningTimerMinutes(45);
  assert.equal(context.planningTimer.durationMinutes, 45);
  context.saveDraft();
  const spent = context.goals[0].planningMinutesSpent;
  assert.ok(spent >= 4 && spent <= 6, `the 5 minutes before the change are kept, got ${spent}`);
});

test("the custom timer uses inline UI, never a native prompt", () => {
  const html = fs.readFileSync(htmlPath, "utf8");
  // Scoped to the PLANNING timer; the unrelated small-goal work-session logger
  // still uses its own prompt and is out of scope for this revision.
  const planningTimer = html.slice(html.indexOf("function changePlanningTimer"), html.indexOf("function tickPlanningTimer"));
  assert.doesNotMatch(planningTimer, /prompt\(/, "no window.prompt in the planning timer");
  assert.match(html, /id="fTimerCustom"/, "an inline custom input exists");

  const { context, elements } = createHarness([]);
  context.openForm(null, "active");
  context.promptWasCalled = false;
  context.changePlanningTimer("custom");
  assert.equal(context.promptWasCalled, false, "choosing Custom must not open a native dialog");
  assert.equal(elements.timerCustomWrap.style.display, "", "the inline field is revealed instead");

  context.document.getElementById("fTimerCustom").value = "90";
  context.applyCustomTimer();
  assert.equal(context.planningTimer.durationMinutes, 90, "the timer reflects the custom choice");
  assert.match(elements.fTimerMinutes.innerHTML, /90 minutes \(custom\)/, "and the selector shows it");
});

test("timer expiry stays non-blocking and makes AI review prominent", () => {
  const { context, elements } = createHarness([]);
  context.openForm(null, "active");
  elements.fTitle.value = "Half planned";
  context.planningTimer.startedAt = Date.now() - 21 * 60000;
  context.tickPlanningTimer();

  assert.equal(context.formLocked, false);
  assert.equal(elements.overlay.classList.contains("open"), true);
  assert.equal(elements.fTitle.value, "Half planned");
  assert.equal(elements.reviewCta.style.display, "", "the AI review call to action becomes visible");
});

/* ================================================================== */
/* AI review copy                                                      */
/* ================================================================== */

test("AI review copy drops planning time and colour but keeps everything useful", () => {
  const { context } = createHarness([]);
  const g = context.normalize({
    id: "c", title: "Earn my first 500 per month", goalType: "active", status: "draft", mdp: true,
    why: "Proof I can build income from my own skills", deadline: "2027-06-01",
    start: "Two students and no repeatable way to find more", obstacles: "School eats my weekdays",
    estimatedEffortHours: 40, color: "amber", planningMinutesSpent: 37,
    smallGoals: [{ what: "Draft the offer page", why: "Nothing can be sold until it exists", estimateMinutes: 90, steps: ["Outline it"] }],
  });
  const text = context.buildGoalCopyText(g, "review");

  assert.doesNotMatch(text, /Planning time spent/i, "planning time is not useful to a reviewer");
  assert.doesNotMatch(text, /^Color:/im, "colour is not useful to a reviewer");
  assert.doesNotMatch(text, /amber/i);

  ["Earn my first 500 per month", "Major Definite Purpose", "Proof I can build income", "2027-06-01",
   "Two students and no repeatable way to find more", "School eats my weekdays", "40",
   "Draft the offer page", "Nothing can be sold until it exists", "1h 30m", "Outline it",
   "do not judge", "Do not rewrite"].forEach((needle) => {
    assert.ok(new RegExp(needle, "i").test(text), `AI review copy should still contain ${JSON.stringify(needle)}`);
  });
});

/* ================================================================== */
/* Future vs Needs Planning separation                                 */
/* ================================================================== */

test("planned Future goals and migrated Needs Planning records are separated, not just badged", () => {
  const { context, elements } = createHarness([
    { id: "planned", title: "A fully planned future goal", goalType: "future", status: "future", deadline: "2027-03-01" },
    { id: "legacy", title: "An old captured idea", goalType: "future", futureMonth: "2027-02" },
  ]);
  context.render();
  const html = elements.futureList.innerHTML;
  assert.match(html, /Future goals - planned, with a deadline/);
  assert.match(html, /Needs planning - captured earlier, not yet planned/);
  assert.ok(html.indexOf("A fully planned future goal") < html.indexOf("An old captured idea"),
    "planned goals come first, in their own section");
  assert.match(html, /needs-planning-card/, "the unplanned record is visually distinct");
});

/* ================================================================== */
/* Small Goal ordering                                                 */
/* ================================================================== */

test("Small Goals can be reordered and the order is what gets saved", () => {
  const { context, elements } = createHarness([]);
  context.openForm(null, "active");
  elements.fTitle.value = "Earn my first 500 per month from tutoring";
  elements.fDeadline.value = "2027-06-01";
  fillSmallGoals(context, 3);

  const second = context.formChildSmallGoals[1].id;
  context.moveFormSmallGoal(second, -1);
  assert.equal(context.formChildSmallGoals[0].id, second, "it moved up");

  context.moveFormSmallGoal(second, 1);
  assert.equal(context.formChildSmallGoals[1].id, second, "and back down");

  context.moveFormSmallGoal(context.formChildSmallGoals[0].id, -1);
  assert.equal(context.formChildSmallGoals.length, 3, "moving past the top is a no-op, nothing is lost");

  context.moveFormSmallGoal(context.formChildSmallGoals[2].id, 1);
  assert.equal(context.formChildSmallGoals.length, 3, "moving past the bottom is a no-op too");

  const order = context.formChildSmallGoals.map((i) => i.what);
  context.saveDraft();
  assert.deepEqual(
    JSON.parse(JSON.stringify(context.goals[0].smallGoals.map((s) => s.what))),
    JSON.parse(JSON.stringify(order)),
    "the saved order matches the form order"
  );
});

/* ================================================================== */
/* Small Goal duration                                                 */
/* ================================================================== */

test("a duration outside the preset list is preserved, not silently discarded", () => {
  const { context, elements } = createHarness([{
    id: "g", title: "Goal", goalType: "active", status: "draft",
    smallGoals: [{ id: "s", what: "Read the whole unit", why: "It is the part the exam tests", estimateMinutes: 37 }],
  }]);
  context.openForm("g");
  assert.equal(context.formChildSmallGoals[0].estimateMinutes, 37, "the odd value survives loading");
  assert.match(elements.formSmallGoalsList.innerHTML, /37m \(custom\)/, "and is offered back as a selected option");

  elements.fTitle.value = "Goal";
  context.saveForm();
  assert.equal(context.goals[0].smallGoals[0].estimateMinutes, 37, "and survives a save");
});

test("a custom Small Goal duration can be entered inline", () => {
  const { context, elements } = createHarness([]);
  context.openForm(null, "active");
  context.addFormSmallGoal();
  const id = context.formChildSmallGoals[0].id;

  context.updateFormSmallGoal(id, "estimateMinutes", "custom");
  assert.equal(context.formChildSmallGoals[0].customDuration, true);
  assert.equal(context.document.getElementById("sgCustomWrap-" + id).style.display, "");

  context.document.getElementById("sgCustom-" + id).value = "75";
  context.applyCustomSmallGoalDuration(id);
  assert.equal(context.formChildSmallGoals[0].estimateMinutes, 75);
});

/* ================================================================== */
/* Effort rollup                                                       */
/* ================================================================== */

test("the Small Goal total is offered as a reference and the override is reversible", () => {
  const { context, elements } = createHarness([]);
  context.openForm(null, "active");
  fillSmallGoals(context, 3);                       // 3 x 45m = 2h 15m
  assert.match(elements.effortRollup.textContent, /2h 15m/);

  context.useRollupEffort();
  assert.equal(Number(elements.fEffortHours.value), 2.3, "the total can be applied");

  elements.fEffortHours.value = "40";
  elements.fTitle.value = "Earn my first 500 per month from tutoring";
  elements.fDeadline.value = "2027-06-01";
  context.saveDraft();
  assert.equal(context.goals[0].estimatedEffortHours, 40, "a manual override wins and is not overwritten");
});

/* ================================================================== */
/* Section naming / numbering                                          */
/* ================================================================== */

test("the planning form uses section names, not numbers", () => {
  const html = fs.readFileSync(htmlPath, "utf8");
  const fields = html.slice(html.indexOf('<div id="activeFields">'), html.indexOf('<div class="modal-btns" id="activeModalBtns">'));
  assert.doesNotMatch(fields, /class="qnum"/, "the 1-7 numbering is gone");
  for (let n = 1; n <= 7; n += 1) assert.doesNotMatch(fields, new RegExp(`>${n} - `));
  assert.match(fields, /What exactly do I want to accomplish\?/);
  assert.match(fields, /Why do I want this, and what changes when I achieve it\?/);
  assert.match(fields, /When will I complete this\?/);
  assert.match(fields, /Where am I today\?/);
  assert.match(fields, /What could stop or slow me down\?/);
  assert.match(fields, /What are the next actions\?/);
  assert.match(fields, /Estimated effort/);
});

test("Estimated effort comes after Small Goals", () => {
  const html = fs.readFileSync(htmlPath, "utf8");
  assert.ok(html.indexOf("What are the next actions?") < html.indexOf("Estimated effort"),
    "effort is placed below Small Goals so the total is meaningful");
});

test("the Small Goal requirement is a live count, not buried helper prose", () => {
  const { context, elements } = createHarness([]);
  context.openForm(null, "active");
  fillSmallGoals(context, 2);
  context.updateSmallGoalCount();
  assert.match(elements.sgCount.textContent, /2 \/ 3 Small Goals ready for Active/);
});

/* ================================================================== */
/* Legacy milestones demoted but preserved                             */
/* ================================================================== */

test("legacy milestones are preserved but presented as history, not live execution", () => {
  const { context, elements } = createHarness([{
    id: "g", title: "An old goal", goalType: "active", status: "active", deadline: "2027-01-01",
    milestones: [{ text: "Finish unit 9", done: true }, { text: "Pass the final", done: false }],
    smallGoals: [{ id: "s", what: "Redo the unit 9 quiz", why: "It is the weakest topic right now", estimateMinutes: 45 }],
  }]);
  context.render();
  const html = elements.activeList.innerHTML;

  assert.match(html, /Finish unit 9/, "legacy milestone text is still there");
  assert.match(html, /legacy-card/, "but inside the collapsed legacy block");
  assert.match(html, /historical/i);
  assert.doesNotMatch(html, /Milestone goals<\/div>/, "no longer a prominent live checklist");
  assert.match(html, /Redo the unit 9 quiz/, "Small Goals remain the live system");

  // and the data itself is untouched
  assert.equal(context.goals[0].milestones.length, 2);
  assert.equal(context.goals[0].milestones[0].done, true);
});

/* ================================================================== */
/* Colours                                                             */
/* ================================================================== */

test("Active Goal cards carry the colour indicator too", () => {
  const { context, elements } = createHarness([{ id: "a", title: "Coloured goal", goalType: "active", status: "active", color: "teal", deadline: "2027-01-01" }]);
  context.render();
  assert.match(elements.activeList.innerHTML, /goal-color-strip/);
  assert.match(elements.activeList.innerHTML, /#14B8A6/, "the chosen colour is applied");
});

test("a new goal prefers a colour no live goal is using", () => {
  const { context } = createHarness([]);
  // Occupy every colour but one.
  context.goals = context.GOAL_COLORS.slice(0, context.GOAL_COLORS.length - 1).map((c, i) =>
    context.normalize({ id: "g" + i, title: "Goal " + i, goalType: "active", color: c.id }));
  const last = context.GOAL_COLORS[context.GOAL_COLORS.length - 1].id;
  assert.equal(context.pickUnusedGoalColor(), last, "it picks the only free colour");
});

test("colour still encodes nothing about status", () => {
  const { context } = createHarness([]);
  const draft = context.normalize({ id: "a", title: "x", goalType: "active", status: "draft", color: "rose" });
  const active = context.normalize({ id: "b", title: "y", goalType: "active", status: "active", color: "rose" });
  const future = context.normalize({ id: "c", title: "z", goalType: "future", status: "future", color: "rose" });
  assert.equal(draft.color, "rose");
  assert.equal(active.color, "rose");
  assert.equal(future.color, "rose");
});

/* ================================================================== */
/* Adversarial pass findings                                           */
/* ================================================================== */

test("child Small Goal recovery stays reachable from the card", () => {
  const { context, elements } = createHarness([{
    id: "g", title: "A goal with deleted children", goalType: "active", status: "active", deadline: "2027-01-01",
    smallGoals: [{ id: "s", what: "Read chapter four", why: "It is what the exam tests", estimateMinutes: 45 }],
    smallGoalsTrash: [{ id: "t", text: "Deleted one", deletedAt: 5, steps: [] }],
  }]);
  context.render();
  assert.match(elements.activeList.innerHTML, /openSmallGoals\('g'\)/, "there is a way back into recovery");
  assert.match(elements.activeList.innerHTML, /Recover deleted \(1\)/);
});

test("the recovery entry point only appears when something is actually recoverable", () => {
  const { context, elements } = createHarness([{
    id: "g", title: "A goal with nothing deleted", goalType: "active", status: "active", deadline: "2027-01-01",
    smallGoals: [{ id: "s", what: "Read chapter four", why: "It is what the exam tests" }],
  }]);
  context.render();
  assert.doesNotMatch(elements.activeList.innerHTML, /Recover deleted/);
});

// The vm harness auto-creates any missing element, so it CANNOT catch a
// reference to an element that was deleted from the markup - a real browser
// throws on `null.value`. This static check closes that gap.
test("every literal getElementById target actually exists in the markup", () => {
  const html = fs.readFileSync(htmlPath, "utf8");
  const markup = html.slice(0, html.indexOf("<script>\n\"use strict\";"));
  const script = extractScript();
  const ids = new Set();
  for (const m of script.matchAll(/getElementById\((["'])([A-Za-z][\w-]*)\1\s*\)/g)) ids.add(m[2]);
  assert.ok(ids.size > 10, "the check should actually be finding ids");

  const missing = [...ids].filter((id) => !new RegExp(`id="${id}"`).test(markup));
  assert.deepEqual(missing, [], `these ids are referenced in JS but no longer exist in the HTML: ${missing.join(", ")}`);
});

// Same gap in reverse: an inline on* handler naming a function that no longer
// exists throws only at click/keystroke time in a real browser.
test("every function named by an inline handler actually exists", () => {
  const html = fs.readFileSync(htmlPath, "utf8");
  const markup = html.slice(0, html.indexOf("<script>\n\"use strict\";"));
  const script = extractScript();
  const keywords = new Set(["if", "for", "while", "switch", "return", "typeof", "new", "delete"]);
  const names = new Set();
  for (const m of markup.matchAll(/\son(?:click|change|input|submit)="\s*([A-Za-z_$][\w$]*)\s*\(/g)) {
    if (!keywords.has(m[1])) names.add(m[1]);
  }
  // The header guards its handlers with `if(canEditOrExportGoals())fn()`, so
  // pick up the guarded call too rather than silently skipping those buttons.
  for (const m of markup.matchAll(/if\(canEditOrExportGoals\(\)\)\s*([A-Za-z_$][\w$]*)\s*\(/g)) names.add(m[1]);
  assert.ok(names.size > 10, "the check should actually be finding handlers");

  const missing = [...names].filter((n) => !new RegExp(`function\\s+${n}\\s*\\(`).test(script));
  assert.deepEqual(missing, [], `inline handlers call functions that do not exist: ${missing.join(", ")}`);
});

test("the big goal-title field syncs and gives feedback without throwing", () => {
  const { context, elements } = createHarness([]);
  context.openForm(null, "active");
  elements.fTitleBig.value = "Finish Algebra 2 before June";
  assert.doesNotThrow(() => context.syncTitleFromBig());
  assert.equal(elements.fTitle.value, "Finish Algebra 2 before June", "it mirrors into the canonical title");
  assert.equal(elements.wcTitle.textContent, "Looks specific");

  elements.fTitleBig.value = "idk";
  context.syncTitleFromBig();
  assert.match(elements.wcTitle.textContent, /vague/i);
});

// The determinism flake came back twice because a NEW Date.now() crept into a
// normalize path. This pins the rule structurally instead of by observation.
test("no normalize path invents a timestamp with Date.now()", () => {
  const script = extractScript();
  const start = script.indexOf("function normalize(g, idState)");
  const end = script.indexOf("function normalizeGoals(");
  assert.ok(start > -1 && end > start, "normalize() should be locatable");
  const body = script.slice(start, end);
  assert.doesNotMatch(body, /Date\.now\(\)/,
    "normalize() must use defaultStamp() so two reads of identical data serialize identically");
});

test("normalizing identical data is byte-stable across many repetitions", () => {
  const { context } = createHarness([]);
  const raw = [
    { id: "old-future", title: "Legacy idea", goalType: "future", futureMonth: "2026-10" },
    { id: "bare", title: "No timestamps at all" },
    { id: "child", title: "With children", smallGoals: [{ what: "Do the thing properly", why: "Because it matters here" }] },
  ];
  const first = JSON.stringify(context.normalizeGoals(raw));
  for (let i = 0; i < 200; i += 1) {
    assert.equal(JSON.stringify(context.normalizeGoals(raw)), first, `repetition ${i} diverged`);
  }
});

test("no new field ever serializes as undefined, so Firestore stays safe", () => {
  const { context, storage, elements } = createHarness([
    { id: "old", title: "A goal saved before the timer existed", goalType: "active", status: "active", deadline: "2027-01-01" },
  ]);
  // Save without ever opening a planning session, so no timer state exists.
  context.goals[0].title = "Edited outside the planner";
  context.save();
  const walk = (value, path) => {
    if (Array.isArray(value)) return value.forEach((v, i) => walk(v, `${path}[${i}]`));
    if (value && typeof value === "object") {
      Object.entries(value).forEach(([k, v]) => {
        assert.notEqual(v, undefined, `${path}.${k} must not be undefined`);
        walk(v, `${path}.${k}`);
      });
    }
  };
  walk(JSON.parse(storage["achieve.goals.v1"]), "root");
  assert.equal(context.normalize({ id: "x", title: "y" }).planningTimerMinutes, null);
  assert.equal(context.normalize({ id: "x", title: "y", planningTimerMinutes: 45 }).planningTimerMinutes, 45);
});

test("an already-finalized goal is not offered a misleading 'Save draft'", () => {
  const { context, elements } = createHarness([
    { id: "live", title: "A live active goal", goalType: "active", status: "active", deadline: "2027-01-01" },
    { id: "wip", title: "An unfinished draft", goalType: "active", status: "draft" },
  ]);
  context.openForm("live");
  assert.equal(elements.btnSaveDraft.textContent, "Save changes");
  assert.equal(elements.btnFinalizeActive.textContent, "Move to Active");

  context.openForm("wip");
  assert.equal(elements.btnSaveDraft.textContent, "Save draft");
  assert.equal(elements.btnFinalizeActive.textContent, "Finalize as Active");
});

test("saving an already-active goal never silently demotes it to a draft", () => {
  const { context, elements } = createHarness([
    { id: "live", title: "A live active goal", goalType: "active", status: "active", deadline: "2027-01-01" },
  ]);
  context.openForm("live");
  elements.fTitle.value = "A live active goal, edited";
  context.saveDraft();
  assert.equal(context.goals[0].status, "active", "status is preserved");
  assert.equal(context.goals[0].title, "A live active goal, edited");
});

/* ================================================================== */
/* Legacy preservation still holds after all of the above              */
/* ================================================================== */

test("legacy #6 and milestones still survive an edit through the revised form", () => {
  const { context, elements } = createHarness([{
    id: "legacy", title: "An old goal", goalType: "active",
    skills: "Ask Mr. Reed for the review packet",
    milestones: [{ text: "Finish unit 9", done: true }],
    deadline: "2027-05-30",
  }]);
  context.openForm("legacy");
  elements.fTitle.value = "An old goal, renamed";
  context.saveForm();
  const saved = context.goals[0];
  assert.equal(saved.skills, "Ask Mr. Reed for the review packet");
  assert.equal(saved.milestones[0].text, "Finish unit 9");
  assert.equal(saved.milestones[0].done, true);
  assert.equal(saved.title, "An old goal, renamed");
});

test("a brand-new Future idea is never mislabelled as a migrated legacy record", () => {
  const { context, elements, storage } = createHarness([]);
  context.openForm(null, "future");
  elements.fTitle.value = "A brand new idea";
  elements.fFutureMonth.value = "2027-04";
  context.saveForm();
  const stored = JSON.parse(storage["achieve.goals.v1"])[0];
  assert.equal(stored.status, "needsPlanning");
  assert.equal(stored.legacyClassification, "", "it was never classified under the old system");
  assert.equal(stored.migratedAt, null, "and it was never migrated");
});
