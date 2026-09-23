"use strict";

/*
 * Goal App Reform, Phase 3: screens (goal-reform-ui.js) driven through a fake
 * host adapter. Covers the full journey (define -> gate -> activate -> lock ->
 * missions -> complete), the missed-deadline re-plan, the legacy switch-over,
 * escaping, and the rule that the UI never fills in the user's answers.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../goal-reform-core.js");
const ui = require("../goal-reform-ui.js");

function makeHost(seed, todayValue) {
  const store = { goals: JSON.parse(JSON.stringify(seed || [])), today: todayValue || "2026-10-01", logged: {}, activations: [], completions: [] };
  let n = 0;
  const host = {
    mountEl: { innerHTML: "" },
    getGoals: () => store.goals,
    saveGoal: (g) => {
      const i = store.goals.findIndex((x) => x.id === g.id);
      if (i >= 0) store.goals[i] = JSON.parse(JSON.stringify(g)); else store.goals.push(JSON.parse(JSON.stringify(g)));
    },
    createGoal: (title) => { n += 1; const g = { id: "g" + n, title, goalType: "future", status: "future" }; store.goals.push(g); return g; },
    activate: (id) => {
      const blocker = core.activationBlocker(store.goals, id, { today: store.today, allowUnplanned: true });
      if (blocker) return { ok: false, message: blocker };
      const g = store.goals.find((x) => x.id === id);
      g.goalType = "active"; g.status = "active";
      store.activations.push(id);
      return true;
    },
    complete: (id) => { const g = store.goals.find((x) => x.id === id); g.achievedAt = 1; g.outcome = "completed"; store.completions.push(id); return Promise.resolve(true); },
    loggedHours: (id) => store.logged[id] || 0,
    today: () => store.today,
    copyText: (t) => { store.copied = t; },
  };
  return { host, store };
}

function html(host) { return host.mountEl.innerHTML; }

// Fill a goal's plan the way a user would: one field at a time, through set/pick/add.
function defineGoal(title) {
  const g = ui.newGoal(title);
  ui.set("whyLayers.0", "I want recurring income from APEX Learning");
  ui.set("whyLayers.1", "Recurring income buys back 10 hours of my week");
  ui.set("whyLayers.2", "Those hours let me build the company full time");
  ui.set("costOfInaction", "Another year with nothing compounding");
  ui.set("definition", "APEX Learning earns $500 in Stripe payouts within one calendar month");
  ui.set("successEvidence", "Stripe payout report showing $500 in one month");
  ui.set("exclusions", "No mobile app, no paid ads");
  for (let i = 0; i < 3; i++) {
    ui.addFinding("Question " + (i + 1));
    ui.set("research." + i + ".source", "https://example.com/" + i);
    ui.set("research." + i + ".insight", "Took 4 months for 3 creators");
  }
  for (let i = 0; i < 3; i++) {
    ui.addCampaign();
    ui.set("campaigns." + i + ".title", "Campaign " + (i + 1));
    ui.set("campaigns." + i + ".result", "Checkout takes " + (i + 1) + " real payments");
    ui.set("campaigns." + i + ".estimate.best", "6", "num");
    ui.set("campaigns." + i + ".estimate.likely", "10", "num");
    ui.set("campaigns." + i + ".estimate.worst", "20", "num");
    ui.set("campaigns." + i + ".operations.0.title", "Operation " + (i + 1));
    ui.set("campaigns." + i + ".operations.0.missions.0.text", "Mission " + (i + 1));
  }
  ui.addObstacle();
  ui.set("obstacles.0.if", "I skip a session");
  ui.set("obstacles.0.then", "I do 25 minutes before bed");
  ui.set("nextAction.text", "Create the Stripe product");
  ui.set("nextAction.minutes", "20", "num");
  ui.set("capacity.hoursPerWeek", "14", "num");
  core.GROWTH_KEYS.forEach((k) => ui.pick("growth." + k, 4));
  return g;
}
function chooseCoinFlipDate(store) {
  const plan = core.normalizeGoalPlan(ui._state().drafts[ui._state().goalId]);
  const f = core.calculateDeadlineForecast(plan, store.today);
  ui.pick("deadlineDecision.inputMode", "date");
  ui.set("deadlineDecision.date", f.dates.p50);
  ui.set("deadlineDecision.rationale", "Forces two hours every day");
  ui.set("deadlineDecision.assumptions", "14 focused hours per week");
  ui.stageTo(6);
  return f;
}

test("mounting with no goals shows the pipeline and the new-goal box", () => {
  const { host } = makeHost([]);
  ui.mount(host);
  assert.match(html(host), /No active goal/);
  assert.match(html(host), /grf-new-title/);
});

test("the workshop starts at Purpose, and later stages stay locked until earlier ones pass", () => {
  const { host } = makeHost([]);
  ui.mount(host);
  ui.newGoal("First $500 month");
  const out = html(host);
  assert.match(out, /STAGE 1 OF 7/);
  assert.match(out, /Why this goal\?/);
  assert.match(out, /disabled title="Finish the earlier stages first"[^>]*>Definition/);
  ui.stageTo(4);
  assert.equal(ui._state().stage, 0, "cannot jump ahead to Deadline");
  assert.match(html(host), /class="primary grf-next-btn" disabled/);
});

test("Research can be skipped and filled later, but other stages can't", () => {
  const { host } = makeHost([]);
  ui.mount(host);
  defineGoal("Goal");
  const st = ui._state();
  st.drafts[st.goalId].research = [];
  ui.stageTo(3);
  assert.equal(st.stage, 3, "Plan is reachable with research unfinished");
});

test("full journey: define, pass the gate, activate, and the second goal is locked out", async () => {
  const { host, store } = makeHost([]);
  ui.mount(host);
  const g1 = defineGoal("First $500 month");
  chooseCoinFlipDate(store);
  const review = html(host);
  assert.match(review, /Clarity Gate/);
  assert.doesNotMatch(review, /class="bad"/, "every gate check passes");
  assert.match(review, /Activate now/);
  ui.activate(g1.id);
  assert.match(html(host), /You can't switch to another goal until it's completed/);
  assert.equal(await ui.confirmActivate(g1.id), true);
  assert.deepEqual(store.activations, [g1.id]);
  const active = store.goals.find((g) => g.id === g1.id);
  assert.equal(active.goalPlan.activatedOn, store.today);
  assert.equal(active.deadline, active.goalPlan.deadlineDecision.date, "legacy deadline field kept in sync for alerts");
  const board = html(host);
  assert.match(board, /STRATEGIC OBJECTIVE/);
  assert.match(board, /APEX Learning earns \$500/);
  assert.match(board, /PURPOSE<\/span> Those hours let me build/);
  assert.match(board, /NEXT ACTION \(20 min\)/);
  assert.match(board, /01<\/span>/);
  assert.match(board, /0\/3 campaigns/);

  ui.go("pipeline");
  const g2 = defineGoal("Second goal");
  chooseCoinFlipDate(store);
  assert.match(html(host), /Complete &quot;First \$500 month&quot; first/);
  ui.activate(g2.id);
  assert.match(html(host), /Complete &quot;First \$500 month&quot; first/);
  assert.deepEqual(store.activations, [g1.id], "no second activation reached the host");
});

test("missions tick through to rollups, next action cycles, and completion frees the slot", async () => {
  const { host, store } = makeHost([]);
  ui.mount(host);
  const g1 = defineGoal("Goal one");
  chooseCoinFlipDate(store);
  ui.activate(g1.id);
  await ui.confirmActivate(g1.id);
  const plan = () => core.normalizeGoalPlan(store.goals.find((g) => g.id === g1.id).goalPlan);
  const c = plan().campaigns[0];
  ui.toggleMission(g1.id, c.id, c.operations[0].id, c.operations[0].missions[0].id);
  assert.equal(plan().campaigns[0].operations[0].missions[0].done, true);
  assert.match(html(host), /1\/3 campaigns/);

  ui.nextActionDone(g1.id);
  assert.match(html(host), /Next unfinished mission: Mission 2/, "hint only, not written into the field");
  assert.equal(ui.saveNextAction(g1.id, "Draft the sales email", 45), false);
  assert.match(html(host), /30 minutes or less/);
  assert.equal(ui.saveNextAction(g1.id, "Draft the sales email", 25), true);
  assert.equal(plan().nextAction.text, "Draft the sales email");
  assert.equal(plan().completedActions[0].text, "Create the Stripe product");

  ui.completeGoal(g1.id);
  assert.match(html(host), /How many focused hours did it actually take/);
  assert.equal(await ui.confirmComplete(g1.id, 41), true);
  assert.equal(plan().actualHours, 41);
  assert.deepEqual(store.completions, [g1.id]);
  assert.match(html(host), /Completed\. Choose what&#39;s next\./);
  assert.match(html(host), /No active goal/);
});

test("a missed deadline keeps the goal active and forces a re-plan with a post-mortem", async () => {
  const { host, store } = makeHost([]);
  ui.mount(host);
  const g1 = defineGoal("Goal one");
  const f = chooseCoinFlipDate(store);
  ui.activate(g1.id);
  await ui.confirmActivate(g1.id);
  store.today = core.addDays(f.dates.p50, 3);
  ui.render();
  const board = html(host);
  assert.match(board, /OVERDUE/);
  assert.match(board, /3 days overdue/);
  assert.match(board, /stays active until it&#39;s completed|stays active until it's completed/);
  assert.doesNotMatch(board, /Shelve|Archive|Delete/);
  ui.startReplan(g1.id);
  const newF = core.calculateDeadlineForecast(core.normalizeGoalPlan(store.goals[0].goalPlan), store.today);
  ui.replanSet("date", newF.dates.p50);
  ui.replanSet("rationale", "r");
  ui.replanSet("assumptions", "a");
  assert.equal(ui.confirmReplan(g1.id), false, "post-mortem required");
  assert.match(html(host), /why the last estimate was off/);
  ui.replanSet("postMortem", "Checkout setup took twice as long");
  assert.equal(ui.confirmReplan(g1.id), true);
  const g = store.goals[0];
  assert.equal(g.goalPlan.extensions, 1);
  assert.equal(g.deadline, newF.dates.p50);
  assert.equal(g.goalType, "active");
  assert.match(html(host), /Extended 1×/);
});

test("legacy data with several active goals opens the switch-over, and nothing is deleted", () => {
  const legacy = [
    { id: "a", title: "Old goal A", goalType: "active", status: "active", why: "reason A", deadline: "2026-12-01" },
    { id: "b", title: "Old goal B", goalType: "active", status: "active" },
    { id: "d", title: "Morning routine", goalType: "daily" },
  ];
  const { host, store } = makeHost(legacy);
  ui.mount(host);
  assert.match(html(host), /Pick the one goal that matters most/);
  ui.chooseSwitch("b");
  assert.match(html(host), /Keep “Old goal B” active, move 1 to Backlog/);
  assert.equal(ui.confirmSwitch(), true);
  assert.equal(store.goals.length, 3, "nothing deleted");
  assert.equal(store.goals.find((g) => g.id === "a").status, "needsPlanning");
  assert.equal(store.goals.find((g) => g.id === "a").why, "reason A", "user data preserved");
  assert.equal(store.goals.find((g) => g.id === "d").goalType, "daily", "daily goals untouched");
  const board = html(host);
  assert.match(board, /Old goal B/);
  assert.match(board, /created before the Clarity Gate/);
});

test("a legacy active goal can be defined in the workshop without being demoted", () => {
  const { host, store } = makeHost([{ id: "a", title: "Old goal", goalType: "active", status: "active", why: "My own words" }]);
  ui.mount(host);
  ui.startDefining("a");
  const g = store.goals[0];
  assert.equal(g.goalType, "active");
  assert.equal(g.goalPlan.whyLayers[0], "My own words", "carries the user's earlier words, invents nothing");
  assert.equal(g.goalPlan.whyLayers[1], "");
  assert.match(html(host), /STAGE 1 OF 7/);
});

test("the defining cap of 3 is enforced from the pipeline", () => {
  const plan = { definition: "x" };
  const seed = [1, 2, 3].map((i) => ({ id: "d" + i, title: "Def " + i, goalType: "future", status: "future", goalPlan: plan }))
    .concat([{ id: "b", title: "Backlog idea", goalType: "future", status: "needsPlanning" }]);
  const { host, store } = makeHost(seed);
  ui.mount(host);
  assert.match(html(host), /already defining 3 goals/);
  assert.equal(ui.newGoal("Fourth"), false);
  assert.equal(ui.startDefining("b"), false);
  assert.equal(store.goals.length, 4);
});

test("the deadline stage shows the forecast strip, the user's pin, and the gate message", () => {
  const { host, store } = makeHost([]);
  ui.mount(host);
  defineGoal("Goal");
  ui.stageTo(4);
  const plan = core.normalizeGoalPlan(ui._state().drafts[ui._state().goalId]);
  const f = core.calculateDeadlineForecast(plan, store.today);
  ui.pick("deadlineDecision.inputMode", "date");
  ui.set("deadlineDecision.date", f.dates.p90);
  ui.render();
  const out = html(host);
  assert.match(out, /P10 · Extreme/);
  assert.match(out, /P50 · Coin-flip/);
  assert.match(out, /P90 · Comfortable/);
  assert.match(out, /grf-pin/);
  assert.match(out, /too comfortable/);
  assert.match(out, /14 h\/week = 2 h every day/);
  assert.doesNotMatch(out, /Use P50|use this date/i, "no button picks the date for the user");
});

test("duration mode is frozen into a fixed date on activation", async () => {
  const { host, store } = makeHost([]);
  ui.mount(host);
  const g = defineGoal("Goal");
  const plan = core.normalizeGoalPlan(ui._state().drafts[g.id]);
  const f = core.calculateDeadlineForecast(plan, store.today);
  ui.pick("deadlineDecision.inputMode", "duration");
  ui.set("deadlineDecision.requestedDurationDays", String(core.daysBetween(store.today, f.dates.p50)), "num");
  ui.set("deadlineDecision.rationale", "r");
  ui.set("deadlineDecision.assumptions", "a");
  ui.activate(g.id);
  await ui.confirmActivate(g.id);
  const saved = store.goals[0].goalPlan.deadlineDecision;
  assert.equal(saved.inputMode, "date");
  assert.equal(saved.date, f.dates.p50);
  store.today = core.addDays(store.today, 5);
  ui.render();
  assert.match(html(host), /12 days left/, "deadline did not slide forward with today");
});

test("user text is escaped everywhere it is rendered", () => {
  const evil = "<img src=x onerror=alert(1)>\"'";
  const { host } = makeHost([{ id: "x", title: evil, goalType: "active", status: "active", why: evil, goalPlan: { definition: evil, whyLayers: ["", "", evil] } }]);
  ui.mount(host);
  const out = html(host);
  assert.doesNotMatch(out, /<img src=x/);
  assert.match(out, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test("inline handler arguments survive quotes in ids", () => {
  const { host } = makeHost([{ id: "a\"b'c", title: "Q", goalType: "future", status: "needsPlanning" }]);
  ui.mount(host);
  assert.match(html(host), /GoalReformUI\.startDefining\(&quot;a\\&quot;b&#39;c&quot;\)/);
});

test("the AI review copy tells the AI not to rewrite the plan", () => {
  const { host, store } = makeHost([]);
  ui.mount(host);
  const g = defineGoal("Goal");
  ui.copyReview(g.id);
  assert.match(store.copied, /^Do not rewrite my goal\./);
  assert.match(store.copied, /FINISH LINE: APEX Learning/);
});

test("the UI never writes an answer the user didn't type", () => {
  const { host, store } = makeHost([]);
  ui.mount(host);
  const g = ui.newGoal("Empty");
  ui.stageTo(0);
  ui.render();
  const saved = core.normalizeGoalPlan(store.goals.find((x) => x.id === g.id).goalPlan);
  assert.deepEqual(saved.whyLayers, ["", "", ""]);
  assert.equal(saved.definition, "");
  assert.equal(saved.deadlineDecision, null);
  assert.deepEqual(saved.campaigns, []);
});

test("a switched-over legacy goal measures pace and odds from the switch date, never from 'today'", () => {
  const { host, store } = makeHost([
    { id: "a", title: "Old A", goalType: "active", status: "active", why: "w" },
    { id: "b", title: "Old B", goalType: "active", status: "active" },
  ], "2026-09-23");
  ui.mount(host);
  ui.chooseSwitch("a");
  ui.confirmSwitch();
  assert.equal(store.goals.find((g) => g.id === "a").reformFocusSince, "2026-09-23");
  ui.startDefining("a");
  assert.equal(store.goals.find((g) => g.id === "a").goalPlan.activatedOn, "2026-09-23");
  // Without a start date the board must not invent odds or an infinite pace.
  store.goals.push({ id: "c", title: "Odd legacy", goalType: "future", status: "future" });
  const noStart = { id: "z", title: "No start", goalType: "active", status: "active", deadline: "2026-09-01",
    goalPlan: { capacity: { hoursPerWeek: 5 }, campaigns: [{ title: "x", estimate: { best: 1, likely: 2, worst: 3 } }], deadlineDecision: { inputMode: "date", date: "2026-09-01" } } };
  const h2 = makeHost([noStart], "2026-10-20");
  ui.mount(h2.host);
  const out = html(h2.host);
  assert.match(out, /OVERDUE/);
  assert.doesNotMatch(out, /set at 0%/);
  assert.doesNotMatch(out, /∞/);
});

test("the board keeps the odds and campaign dates frozen at commit time", async () => {
  const { host, store } = makeHost([]);
  ui.mount(host);
  const g = defineGoal("Goal");
  chooseCoinFlipDate(store);
  ui.activate(g.id);
  await ui.confirmActivate(g.id);
  const snap = store.goals[0].goalPlan.deadlineDecision.calculationSnapshot;
  assert.ok(snap && snap.meanHours > 0 && snap.chance >= 0.5 && snap.campaigns.length === 3);
  const before = html(host).match(/set at (\d+)%/)[1];
  store.today = core.addDays(store.today, 4);
  const c = store.goals[0].goalPlan.campaigns[0];
  ui.toggleMission(g.id, c.id, c.operations[0].id, c.operations[0].missions[0].id);
  assert.equal(html(host).match(/set at (\d+)%/)[1], before, "odds don't drift after commit");
  assert.match(html(host), new RegExp("P50 " + ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][+snap.campaigns[0].p50Date.slice(5,7)-1]));
});

test("accordion buttons carry decorative bars only, so they keep an accessible name", async () => {
  const { host, store } = makeHost([]);
  ui.mount(host);
  const g = defineGoal("Goal");
  chooseCoinFlipDate(store);
  ui.activate(g.id);
  await ui.confirmActivate(g.id);
  const buttons = html(host).match(/<button type="button" class="grf-acc[^"]*"[\s\S]*?<\/button>/g);
  assert.ok(buttons.length > 0);
  for (const b of buttons) assert.doesNotMatch(b, /role="progressbar"/);
});

test("activation hands the host the same today + calibration the gate used", async () => {
  const { host, store } = makeHost([]);
  let seen = null;
  host.calibration = () => 1.13;
  host.activate = (id, o) => { seen = o; const blocker = core.activationBlocker(store.goals, id, o); if (blocker) return { ok: false, message: blocker }; store.goals.find((g) => g.id === id).goalType = "active"; store.goals.find((g) => g.id === id).status = "active"; return true; };
  ui.mount(host);
  const g = defineGoal("Goal");
  const plan = core.normalizeGoalPlan(ui._state().drafts[g.id]);
  const f = core.calculateDeadlineForecast(plan, store.today, { calibration: 1.13 });
  ui.pick("deadlineDecision.inputMode", "date");
  ui.set("deadlineDecision.date", f.dates.p50);
  ui.set("deadlineDecision.rationale", "r");
  ui.set("deadlineDecision.assumptions", "a");
  ui.activate(g.id);
  assert.equal(await ui.confirmActivate(g.id), true);
  assert.equal(seen.calibration, 1.13);
  assert.equal(seen.today, store.today);
});
