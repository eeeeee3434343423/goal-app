/*
 * Demo 3 — Reflection & Victory.
 * See GOAL_APP_DEMO_3_REFLECTION_VICTORY_PLAN.md.
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

function createHarness(seedGoals = [], options = {}) {
  const elements = {};
  // Phase 0B / ruling Q-1: records already overdue when the new system FIRST
  // sees the data are flagged for review, not missed. Tests that are about the
  // ongoing missed workflow declare the system already live via alreadyLive.
  // Phase 0B / ruling Q-1: records already overdue when the new system FIRST
  // sees them are flagged for review, not missed. Tests about the ONGOING
  // missed workflow declare the system already live by stamping the
  // per-record migration marker (a global flag proved unsafe in rehearsal).
  const live = options.alreadyLive !== false;
  const seeded = live
    ? seedGoals.map((g) => Object.assign({}, g, { lifecycleMigratedVersion: 4 }))
    : seedGoals;
  const storage = { "achieve.goals.v1": JSON.stringify(seeded) };
  const context = {
    console, Date, Math,
    Blob: class Blob {}, URL: { createObjectURL: () => "blob:test" }, FileReader: class FileReader {},
    setTimeout: (fn) => { if (options.runTimers && typeof fn === "function") fn(); return 0; },
    clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    alert(m) { context.lastAlert = m; },
    prompt() { return context.nextPromptValue; },
    confirm() { return context.confirmValue !== false; },
    localStorage: {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(storage, k) ? storage[k] : null),
      setItem: (k, v) => { storage[k] = String(v); },
    },
    document: {
      getElementById(id) {
        if (options.breakCelebration && id === "celebrate") return null;
        if (!elements[id]) elements[id] = createElement(id);
        return elements[id];
      },
      createElement: (t) => createElement(t),
      querySelectorAll: () => [],
    },
    navigator: { clipboard: { writeText(t) { context.lastCopiedText = t; return Promise.resolve(); } } },
    window: {
      __storage: storage, __SKIP_CLOUD_SAVE: true, addEventListener() {}, scrollTo() {},
      matchMedia: options.reducedMotion === undefined ? undefined : () => ({ matches: !!options.reducedMotion }),
    },
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

function reload(storage, options) {
  return createHarness(JSON.parse(storage["achieve.goals.v1"]), options);
}

/* A finalized Active goal with three explicit Small Goals. */
function activeGoal(overrides = {}) {
  return Object.assign({
    id: "g1",
    title: "Earn my first 500 per month from tutoring",
    goalType: "active",
    status: "active",
    deadline: "2099-06-01",
    color: "teal",
    why: "Proof I can build income from my own skills",
    smallGoals: [
      { id: "s1", what: "Write the one page offer", why: "Nothing sells until it is written", estimateMinutes: 60, steps: [{ id: "st1", text: "Outline it", done: true }] },
      { id: "s2", what: "Message ten parents", why: "Direct outreach creates the first clients", estimateMinutes: 45 },
      { id: "s3", what: "Run one free trial session", why: "A referral beats any advert", estimateMinutes: 120 },
    ],
  }, overrides);
}

function mainAnswers(extra = {}) {
  return Object.assign({
    faster: "Starting outreach in week one instead of week four",
    mistakes: "I rewrote the offer page three times before showing anyone",
    risks: "Letting school weeks stop outreach entirely",
    learned: "Direct messages convert far better than posts",
    worked: "Asking every happy parent for one referral",
    nextTime: "Ship the rough version and iterate with real feedback",
  }, extra);
}
function smallAnswers(extra = {}) {
  return Object.assign({
    worked: "Writing the draft in one sitting without editing",
    slowed: "I kept checking my phone between paragraphs",
    learned: "The offer is clearer when I write it out loud first",
    better: "Block the time and leave the phone in another room",
  }, extra);
}
function missedAnswers(extra = {}) {
  return Object.assign({
    cause: "I stopped doing outreach once exams started",
    mistakes: "I never reduced the target when the term got heavy",
    different: "Kept a smaller weekly minimum instead of stopping",
    learned: "A reduced plan survives a busy term, a full plan does not",
    worked: "The offer page itself was good and still is",
    nextTime: "Set a minimum version of the goal for hard weeks",
  }, extra);
}

/* ================================================================== */
/* Main goal completion                                               */
/* ================================================================== */

test("completing a Main Goal records a completion timestamp immediately", () => {
  const { context, storage } = createHarness([activeGoal()]);
  assert.equal(context.completeGoal("g1"), true);
  const g = context.goals[0];
  assert.ok(g.achievedAt > 0, "completion timestamp recorded");
  assert.equal(g.outcome, "completed");
  assert.equal(g.reflectionStatus, "pending");
  // Persisted before any celebration could run.
  assert.ok(JSON.parse(storage["achieve.goals.v1"])[0].achievedAt > 0, "written to storage");
});

test("completing a Main Goal is idempotent", () => {
  const { context } = createHarness([activeGoal()]);
  assert.equal(context.completeGoal("g1"), true);
  const first = context.goals[0].achievedAt;
  assert.equal(context.completeGoal("g1"), false, "a second click does nothing");
  assert.equal(context.completeGoal("g1"), false);
  assert.equal(context.goals[0].achievedAt, first, "the timestamp is not overwritten");
  assert.equal(context.goals.length, 1, "no duplicate record");
});

test("a completed Goal enters Needs Reflection, not Victory", () => {
  const { context, elements } = createHarness([activeGoal()]);
  context.completeGoal("g1");
  assert.equal(context.victoryGoals().length, 0, "not in Victory yet");
  assert.equal(context.needsReflectionGoals().length, 1);
  context.render();
  assert.match(elements.needsReflectionList.innerHTML, /Completed - reflection pending/);
  assert.doesNotMatch(elements.activeList.innerHTML, /Earn my first 500/, "it left the active list");
});

test("Needs Reflection survives a reload", () => {
  const { context, storage } = createHarness([activeGoal()]);
  context.completeGoal("g1");
  const after = reload(storage);
  assert.equal(after.context.needsReflectionGoals().length, 1, "still pending after reload");
  assert.equal(after.context.victoryGoals().length, 0);
  assert.equal(after.context.goals[0].reflectionStatus, "pending");
});

test("dismissing the reflection UI never loses the completion", () => {
  const { context } = createHarness([activeGoal()]);
  context.completeGoal("g1");
  context.closeReflection();
  assert.ok(context.goals[0].achievedAt > 0, "completion is untouched");
  assert.equal(context.goals[0].reflectionStatus, "pending", "and still owed");
  assert.equal(context.victoryGoals().length, 0, "dismissal is not reflecting");
});

test("a celebration failure cannot lose the completion", () => {
  // The celebrate element is missing entirely in this harness.
  const { context, storage } = createHarness([activeGoal()], { breakCelebration: true, runTimers: true });
  assert.doesNotThrow(() => context.completeGoal("g1"));
  assert.ok(context.goals[0].achievedAt > 0);
  assert.ok(JSON.parse(storage["achieve.goals.v1"])[0].achievedAt > 0);
});

test("the winner statement is decoration and never alters goal data", () => {
  const { context } = createHarness([activeGoal()]);
  context.completeGoal("g1");
  const before = JSON.stringify(context.goals[0]);
  const a = context.winGoalStatement(context.goals[0]);
  const b = context.winGoalStatement(context.goals[0]);
  assert.equal(a, b, "stable for a given goal");
  assert.ok(context.MAIN_VICTORY_STATEMENTS.includes(a));
  assert.equal(JSON.stringify(context.goals[0]), before, "reading a statement mutates nothing");
});

test("main and small statement sets are separate, and small is lighter", () => {
  const { context } = createHarness([]);
  assert.ok(context.MAIN_VICTORY_STATEMENTS.length >= 4);
  assert.ok(context.SMALL_VICTORY_STATEMENTS.length >= 4);
  context.SMALL_VICTORY_STATEMENTS.forEach((s) => {
    assert.equal(context.MAIN_VICTORY_STATEMENTS.includes(s), false, `${s} must not be in both sets`);
  });
  const avg = (list) => list.reduce((t, s) => t + s.length, 0) / list.length;
  assert.ok(avg(context.SMALL_VICTORY_STATEMENTS) < avg(context.MAIN_VICTORY_STATEMENTS),
    "small goal statements are shorter / lighter");
});

/* ================================================================== */
/* Main reflection                                                    */
/* ================================================================== */

test("an empty or filler reflection is rejected", () => {
  const { context } = createHarness([activeGoal()]);
  context.completeGoal("g1");

  assert.equal(context.submitGoalReflection("g1", {}).ok, false, "empty rejected");
  const filler = context.submitGoalReflection("g1", mainAnswers({ learned: "idk", mistakes: "nothing" }));
  assert.equal(filler.ok, false, "filler rejected");
  assert.ok(filler.errors.some((e) => /real answer|vague/i.test(e)));
  assert.equal(context.goals[0].reflectionStatus, "pending", "still owed");
});

test("a concise but meaningful reflection is accepted", () => {
  const { context } = createHarness([activeGoal()]);
  context.completeGoal("g1");
  const result = context.submitGoalReflection("g1", {
    faster: "Start outreach immediately",
    mistakes: "Rewrote the page too often",
    risks: "Stopping during exams",
    learned: "Messages beat posts",
    worked: "Asking for referrals",
    nextTime: "Ship rough, iterate",
  });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});

test("all six main reflection concepts are present", () => {
  const { context } = createHarness([]);
  const keys = context.MAIN_REFLECTION_QUESTIONS.map((q) => q.key);
  ["faster", "mistakes", "risks", "learned", "worked", "nextTime"].forEach((k) => {
    assert.ok(keys.includes(k), `missing the ${k} question`);
  });
});

test("submitting the reflection moves the Goal into Victory exactly once", () => {
  const { context, storage } = createHarness([activeGoal()]);
  context.completeGoal("g1");
  assert.equal(context.submitGoalReflection("g1", mainAnswers()).ok, true);

  assert.equal(context.victoryGoals().length, 1);
  assert.equal(context.needsReflectionGoals().length, 0);
  const archivedAt = context.goals[0].victoryArchivedAt;
  assert.ok(archivedAt > 0);

  // Submitting again must not re-archive or duplicate.
  const again = context.submitGoalReflection("g1", mainAnswers());
  assert.equal(again.ok, true);
  assert.equal(again.alreadyComplete, true);
  assert.equal(context.goals[0].victoryArchivedAt, archivedAt, "archive time unchanged");
  assert.equal(context.victoryGoals().length, 1, "still exactly one victory");
  assert.equal(JSON.parse(storage["achieve.goals.v1"]).length, 1, "no duplicate record");
});

test("a submitted reflection persists and stays viewable", () => {
  const { context, storage } = createHarness([activeGoal()]);
  context.completeGoal("g1");
  context.submitGoalReflection("g1", mainAnswers());

  const after = reload(storage);
  const g = after.context.goals[0];
  assert.equal(g.reflectionStatus, "complete");
  assert.equal(g.reflection.answers.learned, "Direct messages convert far better than posts");
  assert.ok(g.reflection.submittedAt > 0);
  assert.equal(after.context.viewReflection("g1", null), true, "it can be reopened and read");
});

/* ================================================================== */
/* Small goals                                                        */
/* ================================================================== */

test("completing a Small Goal records a timestamp and requires reflection", () => {
  const { context } = createHarness([activeGoal()]);
  context.toggleSmallGoal("g1", "s1");
  const item = context.goals[0].smallGoals[0];
  assert.equal(item.done, true);
  assert.ok(item.completedAt > 0);
  assert.equal(item.completedBy, "user");
  assert.equal(item.reflectionStatus, "pending");
});

test("a completed Small Goal stays checked while reflection is pending", () => {
  const { context, elements } = createHarness([activeGoal()]);
  context.toggleSmallGoal("g1", "s1");
  context.render();
  assert.equal(context.goals[0].smallGoals[0].done, true, "not unchecked");
  assert.match(elements.activeList.innerHTML, /Needs reflection/i, "and the requirement is visible");
});

test("the small goal reflection has three to four questions and its own set", () => {
  const { context } = createHarness([]);
  const n = context.SMALL_REFLECTION_QUESTIONS.length;
  assert.ok(n >= 3 && n <= 4, `expected 3-4 questions, got ${n}`);
  assert.ok(context.SMALL_REFLECTION_QUESTIONS.length < context.MAIN_REFLECTION_QUESTIONS.length,
    "shorter than the main reflection");
});

test("a Small Goal reflection persists and does not overwrite execution data", () => {
  const { context, storage } = createHarness([activeGoal()]);
  context.toggleSmallGoal("g1", "s1");
  assert.equal(context.submitSmallGoalReflection("g1", "s1", smallAnswers()).ok, true);

  const after = reload(storage);
  const item = after.context.goals[0].smallGoals[0];
  assert.equal(item.reflectionStatus, "complete");
  assert.equal(item.reflection.answers.worked, "Writing the draft in one sitting without editing");
  // Execution data is untouched.
  assert.equal(item.what, "Write the one page offer");
  assert.equal(item.why, "Nothing sells until it is written");
  assert.equal(item.estimateMinutes, 60);
  assert.equal(item.steps[0].text, "Outline it");
  assert.equal(item.steps[0].done, true);
});

test("a Small Goal counts once, however many times reflection is saved", () => {
  const { context } = createHarness([activeGoal()]);
  context.toggleSmallGoal("g1", "s1");
  assert.equal(context.completedSmallGoalCount(), 1);
  context.submitSmallGoalReflection("g1", "s1", smallAnswers());
  assert.equal(context.completedSmallGoalCount(), 1, "reflection does not add a victory");
  context.submitSmallGoalReflection("g1", "s1", smallAnswers());
  assert.equal(context.completedSmallGoalCount(), 1, "and a repeat submit does not either");
});

test("completing a Small Goal does not complete its parent Goal", () => {
  const { context } = createHarness([activeGoal()]);
  context.toggleSmallGoal("g1", "s1");
  assert.equal(context.goals[0].achievedAt, null);
  assert.equal(context.goals[0].outcome, "");
  assert.equal(context.victoryGoals().length, 0);
});

test("un-ticking a Small Goal clears the obligation but keeps a submitted reflection", () => {
  const { context } = createHarness([activeGoal()]);
  context.toggleSmallGoal("g1", "s1");
  context.submitSmallGoalReflection("g1", "s1", smallAnswers());
  context.toggleSmallGoal("g1", "s1");
  const item = context.goals[0].smallGoals[0];
  assert.equal(item.done, false);
  assert.equal(item.reflection.answers.worked, "Writing the draft in one sitting without editing",
    "history is not destroyed by un-ticking");
});

/* ================================================================== */
/* Operator ruling: Main completion no longer auto-completes           */
/* ================================================================== */

test("completing a Main Goal leaves unfinished Small Goals honestly unfinished", () => {
  const { context } = createHarness([activeGoal()]);
  context.toggleSmallGoal("g1", "s1");                 // I actually did this one
  context.completeGoal("g1");

  const items = context.goals[0].smallGoals;
  assert.equal(items[0].done, true, "the one I completed stays completed");
  assert.equal(items[1].done, false, "the ones I never did stay unfinished");
  assert.equal(items[2].done, false);
  assert.equal(items[1].reflectionStatus, "", "and owe no reflection");
  assert.equal(items[2].reflectionStatus, "");
  assert.equal(context.completedSmallGoalCount(), 1, "only the real completion counts");
});

test("an explicitly completed Small Goal keeps its pending reflection after the parent completes", () => {
  const { context } = createHarness([activeGoal()]);
  context.toggleSmallGoal("g1", "s1");
  context.completeGoal("g1");
  assert.equal(context.goals[0].smallGoals[0].reflectionStatus, "pending", "not silently resolved");
  assert.equal(context.smallGoalsNeedingReflection().length, 1);
});

test("old records where the parent closed out small goals are not rewritten", () => {
  // A pre-Demo-3 victory: everything marked done by the old achieveGoal.
  const { context } = createHarness([{
    id: "old", title: "An old completed goal", goalType: "active", status: "active",
    achievedAt: 1750000000000,
    smallGoals: [{ id: "a", text: "One", done: true, completedAt: 1750000000000 }],
  }]);
  const item = context.goals[0].smallGoals[0];
  assert.equal(item.done, true, "history is left exactly as it was");
  assert.equal(item.completedBy, "", "not retroactively relabelled");
  assert.equal(item.reflectionStatus, "", "and no reflection is demanded retroactively");
});

/* ================================================================== */
/* Missed goals                                                       */
/* ================================================================== */

const DAY = 86400000;
function deadlineOffset(days) {
  const d = new Date(Date.now() + days * DAY);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

test("an Active goal past its deadline becomes Needs Reflection", () => {
  // Seeded with today's deadline so load-time evaluation does NOT fire, then
  // the clock is injected explicitly. Keeps the assertion deterministic.
  const today = deadlineOffset(0);
  const past = new Date(today + "T23:59:59").getTime() + 1000;
  const { context } = createHarness([activeGoal({ deadline: today })]);
  assert.equal(context.goals[0].outcome, "", "not missed while the day is still running");

  assert.equal(context.evaluateMissedGoals(past), 1);
  const g = context.goals[0];
  assert.equal(g.outcome, "missed");
  assert.equal(g.reflectionStatus, "pending");
  assert.ok(g.missedAt > 0);
});

test("the deadline check also runs automatically on load", () => {
  const { context } = createHarness([activeGoal({ deadline: deadlineOffset(-2) })]);
  assert.equal(context.goals[0].outcome, "missed", "an overdue goal is caught without any manual call");
  assert.equal(context.needsReflectionGoals().length, 1);
});

test("a Future goal past its deadline is also missed, per the operator ruling", () => {
  const today = deadlineOffset(0);
  const past = new Date(today + "T23:59:59").getTime() + 1000;
  const { context } = createHarness([activeGoal({ id: "f", goalType: "future", status: "future", deadline: today })]);
  assert.equal(context.evaluateMissedGoals(past), 1);
  assert.equal(context.goals[0].outcome, "missed");
});

test("deadline boundaries follow the app's existing inclusive-day semantics", () => {
  const today = deadlineOffset(0);
  const endOfToday = new Date(today + "T23:59:59").getTime();

  const before = createHarness([activeGoal({ deadline: today })]);
  assert.equal(before.context.evaluateMissedGoals(endOfToday - 1000), 0, "not missed just before the deadline ends");

  const on = createHarness([activeGoal({ deadline: today })]);
  assert.equal(on.context.evaluateMissedGoals(endOfToday), 0, "not missed exactly at the deadline instant");

  const after = createHarness([activeGoal({ deadline: today })]);
  assert.equal(after.context.evaluateMissedGoals(endOfToday + 1000), 1, "missed just after the day ends");
});

test("Ideas, researching records, drafts and needs-planning are never missed", () => {
  const { context, elements } = createHarness([
    { id: "i", title: "An idea", recordKind: "idea", ideaStatus: "idea", deadline: deadlineOffset(-5) },
    { id: "r", title: "Researching", recordKind: "idea", ideaStatus: "researching", deadline: deadlineOffset(-5) },
    { id: "d", title: "A draft", goalType: "active", status: "draft", deadline: deadlineOffset(-5) },
    { id: "n", title: "Needs planning", goalType: "future", futureMonth: "2026-10" },
  ]);
  assert.equal(context.evaluateMissedGoals(Date.now()), 0, "none of these can be missed");
  context.goals.forEach((g) => assert.notEqual(g.outcome, "missed", `${g.id} must not be missed`));
  context.render();
  assert.doesNotMatch(elements.needsReflectionList.innerHTML || "", /An idea|Researching|A draft/);
});

test("completed goals and victories are never retroactively marked missed", () => {
  // Completed BEFORE the deadline passes, then the clock moves past it.
  const today = deadlineOffset(0);
  const past = new Date(today + "T23:59:59").getTime() + 1000;
  const { context } = createHarness([activeGoal({ deadline: today })]);

  context.completeGoal("g1");
  context.submitGoalReflection("g1", mainAnswers());
  assert.equal(context.victoryGoals().length, 1);

  assert.equal(context.evaluateMissedGoals(past), 0, "a victory is not swept up by a later deadline check");
  assert.equal(context.goals[0].outcome, "completed");
  assert.equal(context.victoryGoals().length, 1);
  assert.equal(context.missedReflectedGoals().length, 0);
});

test("repeated deadline evaluation is idempotent", () => {
  const today = deadlineOffset(0);
  const past = new Date(today + "T23:59:59").getTime() + 1000;
  const { context } = createHarness([activeGoal({ deadline: today })]);
  assert.equal(context.evaluateMissedGoals(past), 1);
  const missedAt = context.goals[0].missedAt;
  assert.equal(context.evaluateMissedGoals(past), 0, "second run changes nothing");
  assert.equal(context.evaluateMissedGoals(past), 0);
  assert.equal(context.evaluateMissedGoals(Date.now()), 0, "and neither does the real clock");
  assert.equal(context.goals[0].missedAt, missedAt, "the missed timestamp is stable");
});

test("a missed state survives a reload", () => {
  const { context, storage } = createHarness([activeGoal({ deadline: deadlineOffset(-2) })]);
  context.evaluateMissedGoals(Date.now());
  const after = reload(storage);
  assert.equal(after.context.goals[0].outcome, "missed");
  assert.equal(after.context.needsReflectionGoals().length, 1);
});

test("a missed goal requires reflection and never enters Victory", () => {
  const { context } = createHarness([activeGoal({ deadline: deadlineOffset(-2) })]);
  context.evaluateMissedGoals(Date.now());

  assert.equal(context.submitGoalReflection("g1", {}).ok, false, "reflection is required");
  assert.equal(context.submitGoalReflection("g1", missedAnswers()).ok, true);

  assert.equal(context.victoryGoals().length, 0, "never a victory");
  assert.equal(context.missedReflectedGoals().length, 1, "it goes to missed history");
  assert.equal(context.victoryStats().mainVictories, 0);
  assert.equal(context.victoryStats().totalVictories, 0);
  assert.equal(context.goals[0].victoryArchivedAt, null, "not archived as a victory");
});

test("the missed reflection uses the missed question set", () => {
  const { context } = createHarness([activeGoal({ deadline: deadlineOffset(-2) })]);
  context.evaluateMissedGoals(Date.now());
  const keys = context.MISSED_REFLECTION_QUESTIONS.map((q) => q.key);
  ["cause", "mistakes", "different", "learned", "worked", "nextTime"].forEach((k) => assert.ok(keys.includes(k)));
  // Main answers use a different shape and must not satisfy it.
  assert.equal(context.submitGoalReflection("g1", mainAnswers()).ok, false);
});

test("a missed goal leaves the active and future execution lists", () => {
  const { context, elements } = createHarness([activeGoal({ deadline: deadlineOffset(-2) })]);
  context.evaluateMissedGoals(Date.now());
  context.render();
  assert.doesNotMatch(elements.activeList.innerHTML, /Earn my first 500/);
  assert.match(elements.needsReflectionList.innerHTML, /Missed - reflection pending/);
});

/* ================================================================== */
/* Victory archive                                                    */
/* ================================================================== */

function victoriousHarness() {
  const h = createHarness([activeGoal()]);
  h.context.toggleSmallGoal("g1", "s1");
  h.context.submitSmallGoalReflection("g1", "s1", smallAnswers());
  h.context.completeGoal("g1");
  h.context.submitGoalReflection("g1", mainAnswers());
  return h;
}

test("the Victory view shows the goal name, completion date and reflection", () => {
  const { context, elements } = victoriousHarness();
  context.setView("victories");
  context.render();
  const html = elements.doneWrap.innerHTML;
  assert.match(html, /Earn my first 500 per month from tutoring/, "the name is prominent");
  assert.match(html, /Completed/);
  assert.match(html, /Read the reflection report/, "the main reflection is reachable");
  assert.match(html, /Write the one page offer/, "small goals are preserved");
  assert.match(html, /Nothing sells until it is written/, "with their WHY");
});

test("Victory statistics count correctly and never double-count", () => {
  const { context } = victoriousHarness();
  const stats = context.victoryStats();
  assert.equal(stats.mainVictories, 1);
  assert.equal(stats.smallVictories, 1, "only the small goal I actually completed");
  assert.equal(stats.totalVictories, 2, "main + small");

  context.submitGoalReflection("g1", mainAnswers());
  context.submitSmallGoalReflection("g1", "s1", smallAnswers());
  assert.deepEqual(JSON.parse(JSON.stringify(context.victoryStats())), JSON.parse(JSON.stringify(stats)),
    "re-submitting reflections cannot inflate the numbers");
});

test("a completed-but-unreflected goal does not inflate Victory statistics", () => {
  const { context } = createHarness([activeGoal()]);
  context.completeGoal("g1");
  assert.equal(context.victoryStats().mainVictories, 0, "not counted until reflected");
  context.submitGoalReflection("g1", mainAnswers());
  assert.equal(context.victoryStats().mainVictories, 1);
});

test("missed goals are excluded from Victory statistics", () => {
  const { context } = createHarness([
    activeGoal(),
    activeGoal({ id: "g2", title: "A goal I missed", deadline: deadlineOffset(-2), smallGoals: [] }),
  ]);
  context.evaluateMissedGoals(Date.now());
  context.submitGoalReflection("g2", missedAnswers());
  context.completeGoal("g1");
  context.submitGoalReflection("g1", mainAnswers());

  const stats = context.victoryStats();
  assert.equal(stats.mainVictories, 1, "only the completed one");
  assert.equal(context.missedReflectedGoals().length, 1);
});

test("victories are ordered newest completion first", () => {
  const { context } = createHarness([
    activeGoal({ id: "older", title: "Older win", smallGoals: [] }),
    activeGoal({ id: "newer", title: "Newer win", smallGoals: [] }),
  ]);
  context.completeGoal("older");
  context.goals.find((g) => g.id === "older").achievedAt = 1000;
  context.submitGoalReflection("older", mainAnswers());
  context.completeGoal("newer");
  context.goals.find((g) => g.id === "newer").achievedAt = 2000;
  context.submitGoalReflection("newer", mainAnswers());

  const order = context.victoryGoals().map((g) => g.title);
  assert.deepEqual(JSON.parse(JSON.stringify(order)), ["Newer win", "Older win"]);
});

test("Victory preserves idea lineage, research metadata and legacy planning data", () => {
  const { context, elements, storage } = createHarness([
    { id: "idea1", title: "Become fluent in Spanish", recordKind: "idea", ideaStatus: "converted",
      brainstorm: "My grandmother speaks it", convertedGoalId: "g1",
      roughEffortMinutes: 12000, researchCompletedAt: 1750000000000 },
    activeGoal({ originIdeaId: "idea1", skills: "Ask Mr Reed for the packet", milestones: [{ text: "Old milestone", done: true }] }),
  ]);
  context.completeGoal("g1");
  context.submitGoalReflection("g1", mainAnswers());
  context.setView("victories");
  context.render();

  const html = elements.doneWrap.innerHTML;
  assert.match(html, /Original idea/);
  assert.match(html, /Become fluent in Spanish/);
  assert.match(html, /My grandmother speaks it/);
  assert.match(html, /200h/, "research effort metadata is preserved");
  assert.match(html, /Legacy planning details/);
  assert.match(html, /Ask Mr Reed for the packet/);
  assert.match(html, /Old milestone/);

  // and the original idea record is not duplicated or corrupted
  const stored = JSON.parse(storage["achieve.goals.v1"]);
  const ideas = stored.filter((r) => r.recordKind === "idea");
  assert.equal(ideas.length, 1);
  assert.equal(ideas[0].brainstorm, "My grandmother speaks it");
});

test("small goal reflections are reachable from the Victory record", () => {
  const { context, elements } = victoriousHarness();
  context.setView("victories");
  context.render();
  assert.match(elements.doneWrap.innerHTML, /viewReflection\('g1','s1'\)/, "the small goal reflection is linked");
});

test("unfinished small goals are shown honestly in the Victory record", () => {
  const { context, elements } = victoriousHarness();
  context.setView("victories");
  context.render();
  const html = elements.doneWrap.innerHTML;
  assert.match(html, /not finished/, "unfinished small goals are labelled, not pretended to be wins");
  assert.match(html, /Small goals completed: <b>1<\/b> of 3/);
});

/* ================================================================== */
/* Snapshots                                                          */
/* ================================================================== */

test("an initial plan snapshot is written once at finalization and never overwritten", () => {
  const { context, elements } = createHarness([]);
  context.goals = [context.normalize(activeGoal({ status: "draft" }))];
  assert.equal(context.finalizeGoal("g1", "active"), true);
  const snap = context.goals[0].initialPlanSnapshot;
  assert.ok(snap, "snapshot created");
  assert.equal(snap.title, "Earn my first 500 per month from tutoring");

  // Editing the goal later must not rewrite the frozen plan.
  context.openForm("g1");
  elements.fTitle.value = "A completely different title now";
  context.saveForm();
  assert.equal(context.goals[0].initialPlanSnapshot.title, "Earn my first 500 per month from tutoring",
    "the historical snapshot is frozen");
  assert.equal(context.goals[0].title, "A completely different title now", "but the live goal did change");
});

test("a victory snapshot is written once when the goal reaches Victory", () => {
  const { context } = victoriousHarness();
  const snap = context.goals[0].victorySnapshot;
  assert.ok(snap, "victory snapshot exists");
  assert.equal(snap.title, "Earn my first 500 per month from tutoring");
  const serialized = JSON.stringify(snap);
  context.submitGoalReflection("g1", mainAnswers());
  assert.equal(JSON.stringify(context.goals[0].victorySnapshot), serialized, "not rewritten");
});

test("snapshots never nest and stored size does not grow across save/reload cycles", () => {
  let { context, storage } = victoriousHarness();
  const sizes = [];
  for (let i = 0; i < 6; i += 1) {
    const next = reload(storage);
    context = next.context;
    storage = next.storage;
    context.save();
    sizes.push(storage["achieve.goals.v1"].length);
    const g = context.goals[0];
    assert.equal(g.victorySnapshot.victorySnapshot, undefined, "a snapshot never contains a snapshot");
    assert.equal(g.victorySnapshot.initialPlanSnapshot, undefined);
    if (g.initialPlanSnapshot) {
      assert.equal(g.initialPlanSnapshot.initialPlanSnapshot, undefined);
      assert.equal(g.initialPlanSnapshot.victorySnapshot, undefined);
    }
  }
  assert.equal(sizes[0], sizes[sizes.length - 1], `stored size grew across reloads: ${sizes.join(" -> ")}`);
});

test("snapshots survive a reload and contain no undefined values", () => {
  const { storage } = victoriousHarness();
  const after = reload(storage);
  const g = after.context.goals[0];
  assert.ok(g.victorySnapshot, "snapshot survived");
  assert.equal(g.victorySnapshot.title, "Earn my first 500 per month from tutoring");

  const walk = (value, p) => {
    if (Array.isArray(value)) return value.forEach((v, i) => walk(v, `${p}[${i}]`));
    if (value && typeof value === "object") {
      Object.entries(value).forEach(([k, v]) => {
        assert.notEqual(v, undefined, `${p}.${k} must not be undefined`);
        walk(v, `${p}.${k}`);
      });
    }
  };
  walk(JSON.parse(storage["achieve.goals.v1"]), "root");
});

test("legacy records without snapshots keep working", () => {
  const { context } = createHarness([{ id: "old", title: "A legacy goal", goalType: "active", status: "active", deadline: "2099-01-01" }]);
  assert.equal(context.goals[0].initialPlanSnapshot, null);
  assert.equal(context.goals[0].victorySnapshot, null);
  assert.doesNotThrow(() => context.render());
  assert.equal(context.completeGoal("old"), true);
  assert.equal(context.submitGoalReflection("old", mainAnswers()).ok, true);
  assert.ok(context.goals[0].victorySnapshot, "a victory snapshot is created from what exists");
});

/* ================================================================== */
/* Adversarial pass findings                                          */
/* ================================================================== */

test("reopening a Victory removes it from Victory instead of listing it twice", () => {
  const { context, elements } = victoriousHarness();
  assert.equal(context.victoryGoals().length, 1);

  context.reopenGoal("g1");
  assert.equal(context.victoryGoals().length, 0, "no longer a victory");
  assert.equal(context.goals[0].outcome, "", "the outcome flag is cleared");
  assert.equal(context.goals[0].victoryArchivedAt, null);

  context.render();
  const inActive = /Earn my first 500/.test(elements.activeList.innerHTML);
  context.setView("victories");
  context.render();
  const inVictory = /class="card victory-card"/.test(elements.doneWrap.innerHTML);
  assert.equal(inActive && inVictory, false, "it must never appear in both places at once");

  // History is kept, not destroyed.
  assert.ok(context.goals[0].reflection.submittedAt > 0, "the reflection survives as history");
  assert.ok(context.goals[0].victorySnapshot, "the victory snapshot survives as history");
});

test("a missed goal can never be completed into Victory, and its miss is not erased", () => {
  const today = deadlineOffset(0);
  const past = new Date(today + "T23:59:59").getTime() + 1000;
  const { context } = createHarness([activeGoal({ deadline: today })]);
  context.evaluateMissedGoals(past);
  const missedAt = context.goals[0].missedAt;

  assert.equal(context.completeGoal("g1"), false, "completing a missed record is refused");
  assert.equal(context.achieveGoal("g1"), false);
  assert.equal(context.goals[0].missedAt, missedAt, "the miss timestamp is not erased");
  assert.equal(context.goals[0].outcome, "missed");
  assert.equal(context.victoryGoals().length, 0);
});

test("editing a completed goal cannot rewrite the frozen victory evidence", () => {
  const { context, elements } = victoriousHarness();
  const before = JSON.stringify(context.goals[0].victorySnapshot);

  context.openForm("g1");
  elements.fTitle.value = "Rewritten long after the fact";
  context.saveForm();

  assert.equal(JSON.stringify(context.goals[0].victorySnapshot), before, "the evidence is frozen");
  assert.equal(context.goals[0].victorySnapshot.title, "Earn my first 500 per month from tutoring");
  assert.ok(context.goals[0].reflection.submittedAt > 0, "the reflection is untouched");
  assert.equal(context.victoryGoals().length, 1, "and it is still exactly one victory");
});

test("Victory cards offer no ordinary Edit control", () => {
  const { context, elements } = victoriousHarness();
  context.setView("victories");
  context.render();
  const html = elements.doneWrap.innerHTML;
  assert.match(html, /reopenGoal\(/, "reopen is the defined restoration path");
  assert.doesNotMatch(html, />Edit</, "no edit button on a victory card");
});

/* ================================================================== */
/* Idea safety and determinism                                        */
/* ================================================================== */

test("an Idea can never be completed, missed, reflected on, or enter Victory", () => {
  const { context } = createHarness([
    { id: "i", title: "An idea", recordKind: "idea", ideaStatus: "idea", deadline: deadlineOffset(-10) },
  ]);
  assert.equal(context.completeGoal("i"), false, "cannot be completed");
  assert.equal(context.achieveGoal("i"), false);
  assert.equal(context.evaluateMissedGoals(Date.now()), 0, "cannot be missed");
  assert.equal(context.openReflection("main", "i", null), false, "cannot be reflected on");
  assert.equal(context.submitGoalReflection("i", mainAnswers()).ok, false);
  assert.equal(context.victoryGoals().length, 0);
  assert.equal(context.needsReflectionGoals().length, 0);
  const idea = context.goals[0];
  assert.equal(idea.outcome, "");
  assert.equal(idea.reflectionStatus, "");
  assert.equal(idea.reflection, null, "ideas carry no reflection object at all");
});

test("normalize stays deterministic with all Demo 3 fields present", () => {
  const { context } = createHarness([]);
  const raw = [{
    id: "g", title: "A goal", goalType: "active", status: "active", achievedAt: 111,
    outcome: "completed", reflectionStatus: "complete",
    reflection: { answers: { learned: "something real here" }, submittedAt: 222 },
    victorySnapshot: { title: "A goal", smallGoals: [] },
    smallGoals: [{ what: "Do the thing", why: "Because it matters", reflectionStatus: "pending" }],
  }];
  const first = JSON.stringify(context.normalizeGoals(raw));
  for (let i = 0; i < 100; i += 1) {
    assert.equal(JSON.stringify(context.normalizeGoals(raw)), first, `repetition ${i} diverged`);
  }
});

test("the determinism guard still holds: no Date.now() inside normalize()", () => {
  const script = extractScript();
  const start = script.indexOf("function normalize(g, idState)");
  const end = script.indexOf("function normalizeGoals(");
  assert.doesNotMatch(script.slice(start, end), /Date\.now\(\)/);
});
