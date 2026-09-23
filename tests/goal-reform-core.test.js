"use strict";

/*
 * Goal App Reform, Phase 1: pure core (goal-reform-core.js).
 * Spec: Obsidian "One Shared Agentic Brain" / Projects/Goal App Reform.
 * Covers the plan contract, the Clarity Gate, vague-language checks, the
 * P50-under-pressure deadline forecast, progress rollups, pace and calibration.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../goal-reform-core.js");

const TODAY = "2026-10-01";

function mission(id, text, done) { return { id, text, done: !!done }; }

function campaign(n, estimate, opts) {
  opts = opts || {};
  return {
    id: "c" + n,
    title: "Campaign " + n + " ships the landing page",
    result: "WIN: landing page " + n + " is live with 3 paying testimonials",
    estimate: estimate || { best: 6, likely: 10, worst: 20 },
    operations: [{
      id: "c" + n + "-o1",
      title: "Operation " + n,
      missions: [
        mission("c" + n + "-o1-m1", "Write the 400-word hero section draft", opts.done),
        mission("c" + n + "-o1-m2", "Publish page to goal-app-flame.vercel.app", opts.done),
      ],
    }],
  };
}

function readyPlan(overrides) {
  const plan = {
    version: 1,
    whyLayers: [
      "I want recurring income from APEX Learning",
      "Recurring income buys back 10 hours of my week",
      "Those hours let me build the company full time",
    ],
    costOfInaction: "Another year of trading every hour for wages with nothing compounding",
    definition: "APEX Learning earns $500 in Stripe payouts within one calendar month",
    successEvidence: "Stripe payout report showing $500 or more for a single month",
    exclusions: "Not building a mobile app; not running paid ads",
    currentReality: "Course content exists, no checkout, zero customers",
    research: [
      { id: "r1", question: "How long did similar creators take?", source: "https://example.com/a", insight: "Median 4 months to first $500" },
      { id: "r2", question: "What price converts?", source: "Indie Hackers thread", insight: "$29-$49 one-time works" },
      { id: "r3", question: "What channel works first?", source: "Interview with Sam", insight: "Reddit + direct outreach" },
    ],
    unknowns: ["Whether students will pay upfront"],
    campaigns: [campaign(1), campaign(2), campaign(3)],
    capacity: { hoursPerWeek: 14, constraints: "Work 9-5 weekdays" },
    nextAction: { text: "Open Stripe and create the product listing", minutes: 20 },
    obstacles: [{ if: "I skip a planned session", then: "I do 25 minutes before bed that same night" }],
    growth: { income: 5, skill: 4, health: 1, relationships: 2, freedom: 5 },
    growthNote: "First proof the business model works",
    deadlineDecision: null,
  };
  const out = Object.assign(plan, overrides || {});
  if (!overrides || !("deadlineDecision" in overrides)) {
    const f = core.calculateDeadlineForecast(out, TODAY);
    out.deadlineDecision = {
      inputMode: "date", date: f.ok ? f.dates.p50 : "", requestedDurationDays: null,
      rationale: "Coin-flip date that forces 2 hours every day",
      assumptions: "14 focused hours per week with no travel",
    };
  }
  return out;
}

// ---------------------------------------------------------------- normalize

test("normalizeGoalPlan rejects non-objects and returns a stable, complete shape", () => {
  assert.equal(core.normalizeGoalPlan(null), null);
  assert.equal(core.normalizeGoalPlan("x"), null);
  assert.equal(core.normalizeGoalPlan([]), null);
  const p = core.normalizeGoalPlan({});
  assert.equal(p.version, 1);
  assert.deepEqual(p.whyLayers, ["", "", ""]);
  assert.deepEqual(p.campaigns, []);
  assert.deepEqual(p.research, []);
  assert.equal(p.capacity.hoursPerWeek, null);
  assert.equal(p.nextAction.minutes, null);
  assert.equal(p.deadlineDecision, null);
});

test("normalizeGoalPlan keeps unknown keys at every level and never invents timestamps", () => {
  const raw = {
    futureField: { keep: true },
    campaigns: [{ id: "cx", title: "T", extra: 1, operations: [{ title: "O", opExtra: 2, missions: [{ text: "M", mExtra: 3 }] }] }],
  };
  const a = core.normalizeGoalPlan(raw);
  const b = core.normalizeGoalPlan(raw);
  assert.deepEqual(a.futureField, { keep: true });
  assert.equal(a.campaigns[0].extra, 1);
  assert.equal(a.campaigns[0].operations[0].opExtra, 2);
  assert.equal(a.campaigns[0].operations[0].missions[0].mExtra, 3);
  assert.equal(JSON.stringify(a), JSON.stringify(b), "normalize must be deterministic");
  assert.equal(a.campaigns[0].operations[0].id, "cx-o1", "id-less children get positional ids");
  assert.equal(a.campaigns[0].operations[0].missions[0].id, "cx-o1-m1");
  assert.equal(JSON.stringify(a).includes("undefined"), false);
});

test("normalizeGoalPlan coerces bad types without throwing", () => {
  const p = core.normalizeGoalPlan({
    whyLayers: "one string", research: "nope", campaigns: [null, 5, { estimate: { best: "3", likely: "x", worst: -1 } }],
    capacity: { hoursPerWeek: "12" }, growth: { income: 9, skill: "3" }, obstacles: [{ if: 1 }],
  });
  assert.deepEqual(p.whyLayers, ["", "", ""]);
  assert.deepEqual(p.research, []);
  assert.equal(p.campaigns.length, 1);
  assert.deepEqual(p.campaigns[0].estimate, { best: 3, likely: null, worst: null });
  assert.equal(p.capacity.hoursPerWeek, 12);
  assert.equal(p.growth.income, null, "out-of-range score is dropped, not clamped");
  assert.equal(p.growth.skill, 3);
  assert.equal(p.obstacles[0].if, "");
});

// ---------------------------------------------------------------- vague language

test("findVagueLanguage flags always-vague phrases", () => {
  const hits = core.findVagueLanguage("I will try to work on my business and get into marketing stuff soon");
  const words = hits.map((h) => h.phrase);
  for (const w of ["try", "work on", "get into", "stuff", "soon"]) assert.ok(words.includes(w), w);
});

test("findVagueLanguage allows comparatives only when a number makes them measurable", () => {
  assert.deepEqual(core.findVagueLanguage("Get better at running").map((h) => h.phrase), ["better"]);
  assert.deepEqual(core.findVagueLanguage("Run 5 km faster than 22:00"), []);
  assert.deepEqual(core.findVagueLanguage("Deadlift 315 pounds"), []);
  assert.deepEqual(core.findVagueLanguage(""), []);
  assert.deepEqual(core.findVagueLanguage("trying tryhard"), [{ phrase: "trying", index: 0 }], "word boundaries respected");
});

// ---------------------------------------------------------------- forecast

test("forecast uses PERT per campaign and a normal approximation, deterministically", () => {
  const plan = readyPlan();
  const f = core.calculateDeadlineForecast(plan, TODAY);
  assert.equal(f.ok, true);
  // each campaign: mean = (6 + 40 + 20)/6 = 11, sd = (20 - 6)/6
  assert.ok(Math.abs(f.hours.mean - 33) < 1e-9);
  assert.ok(Math.abs(f.hours.sd - Math.sqrt(3) * 14 / 6) < 1e-9);
  assert.ok(f.hours.p10 < f.hours.p50 && f.hours.p50 < f.hours.p90);
  assert.ok(f.dates.p10 < f.dates.p50 && f.dates.p50 < f.dates.p90);
  assert.equal(f.dates.p50, "2026-10-18", "33h at 2h/day = 16.5 -> 17 days");
  assert.deepEqual(core.calculateDeadlineForecast(plan, TODAY), f);
});

test("forecast gives per-campaign cumulative P50 dates in order", () => {
  const f = core.calculateDeadlineForecast(readyPlan(), TODAY);
  assert.equal(f.campaigns.length, 3);
  assert.ok(f.campaigns[0].p50Date < f.campaigns[1].p50Date);
  assert.ok(f.campaigns[1].p50Date < f.campaigns[2].p50Date);
  assert.equal(f.campaigns[2].p50Date, f.dates.p50);
});

test("forecast refuses to calculate without valid estimates or capacity", () => {
  const noCap = core.calculateDeadlineForecast(readyPlan({ capacity: { hoursPerWeek: 0 } }), TODAY);
  assert.equal(noCap.ok, false);
  assert.match(noCap.error, /hours per week/i);
  const bad = readyPlan();
  bad.campaigns[1].estimate = { best: 10, likely: 5, worst: 20 };
  const f = core.calculateDeadlineForecast(bad, TODAY);
  assert.equal(f.ok, false);
  assert.match(f.error, /best.*likely.*worst/i);
  assert.equal(core.calculateDeadlineForecast(readyPlan({ campaigns: [] }), TODAY).ok, false);
});

test("calibration factor scales the forecast but never the stored plan", () => {
  const plan = readyPlan();
  const before = JSON.stringify(plan);
  const f1 = core.calculateDeadlineForecast(plan, TODAY);
  const f2 = core.calculateDeadlineForecast(plan, TODAY, { calibration: 1.5 });
  assert.ok(Math.abs(f2.hours.mean - f1.hours.mean * 1.5) < 1e-9);
  assert.ok(f2.dates.p50 > f1.dates.p50);
  assert.equal(JSON.stringify(plan), before);
});

test("probabilityForDate: P50 date is a coin-flip, earlier is harder, later is easier", () => {
  const f = core.calculateDeadlineForecast(readyPlan(), TODAY);
  // Whole days make the curve step: the P50 date is the first day at or past a coin-flip.
  assert.ok(core.probabilityForDate(f, f.dates.p50) >= 0.5);
  assert.ok(core.probabilityForDate(f, core.addDays(f.dates.p50, -1)) < 0.5);
  assert.ok(f.band.earliest <= f.dates.p50 && f.dates.p50 <= f.band.latest);
  assert.ok(core.probabilityForDate(f, f.dates.p10) < 0.2);
  assert.ok(core.probabilityForDate(f, f.dates.p90) > 0.85);
  assert.equal(core.probabilityForDate(f, TODAY), 0);
});

test("zero-spread estimates still produce a usable band", () => {
  const plan = readyPlan({ campaigns: [campaign(1, { best: 10, likely: 10, worst: 10 }), campaign(2, { best: 10, likely: 10, worst: 10 }), campaign(3, { best: 10, likely: 10, worst: 10 })] });
  const f = core.calculateDeadlineForecast(plan, TODAY);
  assert.equal(f.ok, true);
  assert.equal(f.hours.sd, 0);
  assert.deepEqual(core.validateDeadlineDecision({ inputMode: "date", date: f.dates.p50, rationale: "r r r", assumptions: "a a a" }, f, TODAY), []);
});

// ---------------------------------------------------------------- deadline decision

test("validateDeadlineDecision accepts the P50 date and rejects comfortable padding", () => {
  const f = core.calculateDeadlineForecast(readyPlan(), TODAY);
  const ok = { inputMode: "date", date: f.dates.p50, rationale: "Forces daily work", assumptions: "14 h/week" };
  assert.deepEqual(core.validateDeadlineDecision(ok, f, TODAY), []);
  const errs = core.validateDeadlineDecision(Object.assign({}, ok, { date: f.dates.p90 }), f, TODAY);
  assert.equal(errs.length, 1);
  assert.match(errs[0], /too comfortable/i);
  assert.match(errs[0], new RegExp(f.band.earliest));
});

test("validateDeadlineDecision rejects impossible dates and says what would make them a coin-flip", () => {
  const f = core.calculateDeadlineForecast(readyPlan(), TODAY);
  const errs = core.validateDeadlineDecision({ inputMode: "date", date: f.dates.p10, rationale: "x y z", assumptions: "x y z" }, f, TODAY);
  assert.match(errs[0], /too aggressive/i);
  assert.match(errs[0], /hours per week/i);
});

test("validateDeadlineDecision handles past dates, missing text and duration mode", () => {
  const f = core.calculateDeadlineForecast(readyPlan(), TODAY);
  const past = core.validateDeadlineDecision({ inputMode: "date", date: "2026-09-01", rationale: "a", assumptions: "b" }, f, TODAY);
  assert.ok(past.some((e) => /future/i.test(e)));
  const blank = core.validateDeadlineDecision({ inputMode: "date", date: f.dates.p50, rationale: " ", assumptions: "" }, f, TODAY);
  assert.ok(blank.some((e) => /why this date/i.test(e)));
  assert.ok(blank.some((e) => /assum/i.test(e)));
  const days = core.daysBetween(TODAY, f.dates.p50);
  const dur = { inputMode: "duration", requestedDurationDays: days, rationale: "r", assumptions: "a" };
  assert.deepEqual(core.validateDeadlineDecision(dur, f, TODAY), []);
  assert.equal(core.resolveDeadlineDate(dur, TODAY), f.dates.p50);
  assert.ok(core.validateDeadlineDecision({ inputMode: "duration", requestedDurationDays: 0, rationale: "r", assumptions: "a" }, f, TODAY).length > 0);
  assert.ok(core.validateDeadlineDecision(null, f, TODAY).length > 0);
});

test("requiredHoursPerWeek turns any date into the pace that makes it a coin-flip", () => {
  const f = core.calculateDeadlineForecast(readyPlan(), TODAY);
  const need = core.requiredHoursPerWeek(f, TODAY, core.addDays(TODAY, 7));
  assert.ok(Math.abs(need - f.hours.mean) < 1e-9, "one week away needs the whole P50 effort per week");
  assert.equal(core.requiredHoursPerWeek(f, TODAY, TODAY), Infinity);
});

// ---------------------------------------------------------------- clarity gate

test("a complete plan passes the Clarity Gate", () => {
  const r = core.goalPlanReadiness(readyPlan(), { today: TODAY });
  assert.deepEqual(r.missing, []);
  assert.equal(r.ready, true);
});

test("Clarity Gate lists every missing piece in plain language, in workshop order", () => {
  const r = core.goalPlanReadiness(core.normalizeGoalPlan({}), { today: TODAY });
  assert.equal(r.ready, false);
  const keys = r.missing.map((m) => m.key);
  assert.deepEqual(keys, ["purpose", "costOfInaction", "definition", "successEvidence", "exclusions",
    "research", "campaigns", "capacity", "nextAction", "obstacles", "growth", "deadline"]);
  for (const m of r.missing) assert.ok(m.message.length > 10, m.key);
});

test("Clarity Gate blocks vague finish lines and win results", () => {
  const plan = readyPlan({ definition: "Get better at marketing and try some stuff" });
  plan.campaigns[0].result = "Work on the landing page";
  const r = core.goalPlanReadiness(plan, { today: TODAY });
  const def = r.missing.find((m) => m.key === "definition");
  assert.ok(def && /better/.test(def.message) && /stuff/.test(def.message));
  assert.ok(r.missing.some((m) => m.key === "campaigns" && /work on/i.test(m.message)));
});

test("Clarity Gate enforces the tracker format: 3-7 campaigns, each with operations and missions", () => {
  const two = readyPlan({ campaigns: [campaign(1), campaign(2)] });
  assert.ok(core.goalPlanReadiness(two, { today: TODAY }).missing.some((m) => m.key === "campaigns" && /3/.test(m.message)));
  const eight = readyPlan({ campaigns: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => campaign(n)) });
  assert.ok(core.goalPlanReadiness(eight, { today: TODAY }).missing.some((m) => m.key === "campaigns" && /7/.test(m.message)));
  const empty = readyPlan();
  empty.campaigns[2].operations = [];
  assert.ok(core.goalPlanReadiness(empty, { today: TODAY }).missing.some((m) => m.key === "campaigns" && /operation/i.test(m.message)));
  const noMission = readyPlan();
  noMission.campaigns[0].operations[0].missions = [];
  assert.ok(core.goalPlanReadiness(noMission, { today: TODAY }).missing.some((m) => m.key === "campaigns" && /mission/i.test(m.message)));
});

test("Clarity Gate: research needs 3 sourced entries, next action at most 30 minutes, 3 why layers", () => {
  const plan = readyPlan();
  plan.research[2].source = "";
  plan.nextAction.minutes = 45;
  plan.whyLayers[2] = "";
  const keys = core.goalPlanReadiness(plan, { today: TODAY }).missing.map((m) => m.key);
  assert.ok(keys.includes("research"));
  assert.ok(keys.includes("nextAction"));
  assert.ok(keys.includes("purpose"));
});

test("Clarity Gate rejects a deadline outside the P40-P60 band", () => {
  const plan = readyPlan();
  const f = core.calculateDeadlineForecast(plan, TODAY);
  plan.deadlineDecision.date = f.dates.p90;
  const miss = core.goalPlanReadiness(plan, { today: TODAY }).missing.find((m) => m.key === "deadline");
  assert.ok(miss && /too comfortable/i.test(miss.message));
});

// ---------------------------------------------------------------- progress + next action

test("planProgress rolls up mission -> operation -> campaign -> objective", () => {
  const plan = readyPlan({ campaigns: [campaign(1, null, { done: true }), campaign(2), campaign(3)] });
  plan.campaigns[1].operations[0].missions[0].done = true;
  const p = core.planProgress(plan);
  assert.deepEqual(p.missions, { done: 3, total: 6 });
  assert.deepEqual(p.operations, { done: 1, total: 3 });
  assert.deepEqual(p.campaigns, { done: 1, total: 3 });
  assert.equal(p.percent, 50);
  assert.equal(p.byCampaign[0].percent, 100);
  assert.equal(p.byCampaign[1].percent, 50);
  assert.deepEqual(core.planProgress(core.normalizeGoalPlan({})).percent, 0);
});

test("nextOpenMission returns the first unfinished mission in execution order", () => {
  const plan = readyPlan({ campaigns: [campaign(1, null, { done: true }), campaign(2), campaign(3)] });
  const next = core.nextOpenMission(plan);
  assert.equal(next.missionId, "c2-o1-m1");
  assert.equal(next.campaignId, "c2");
  const allDone = readyPlan({ campaigns: [campaign(1, null, { done: true })] });
  assert.equal(core.nextOpenMission(allDone), null);
});

// ---------------------------------------------------------------- pace + calibration

test("paceStatus shows behind on day 2, not day 60", () => {
  const plan = readyPlan();
  const f = core.calculateDeadlineForecast(plan, TODAY);
  const day3 = core.addDays(TODAY, 3);
  const behind = core.paceStatus(f, { startDate: TODAY, deadline: f.dates.p50, loggedHours: 0, today: day3 });
  assert.equal(behind.status, "behind");
  assert.ok(behind.requiredHoursPerWeek > plan.capacity.hoursPerWeek);
  const onPace = core.paceStatus(f, { startDate: TODAY, deadline: f.dates.p50, loggedHours: 6.5, today: day3 });
  assert.equal(onPace.status, "on-pace");
  assert.ok(onPace.projectedFinish);
  const late = core.paceStatus(f, { startDate: TODAY, deadline: f.dates.p50, loggedHours: 1, today: core.addDays(f.dates.p50, 1) });
  assert.equal(late.status, "overdue");
});

test("calibrationFactor is the median actual/estimate ratio, clamped, defaulting to 1", () => {
  assert.deepEqual(core.calibrationFactor([]), { factor: 1, samples: 0 });
  assert.deepEqual(core.calibrationFactor([{ estimatedHours: 10, actualHours: 15 }, { estimatedHours: 10, actualHours: 20 }, { estimatedHours: 10, actualHours: 12 }]), { factor: 1.5, samples: 3 });
  assert.equal(core.calibrationFactor([{ estimatedHours: 10, actualHours: 100 }]).factor, 3);
  assert.equal(core.calibrationFactor([{ estimatedHours: 0, actualHours: 5 }, { bad: true }]).samples, 0);
});

test("the core exposes no AI/network surface and never picks a date for the user", () => {
  const src = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "goal-reform-core.js"), "utf8");
  assert.equal(/fetch\(|XMLHttpRequest|Date\.now\(|Math\.random\(/.test(src), false);
  const plan = readyPlan({ deadlineDecision: null });
  core.goalPlanReadiness(plan, { today: TODAY });
  assert.equal(plan.deadlineDecision, null, "readiness must not fill in a deadline");
});

// ---------------------------------------------------------------- pipeline + focus lock

function goal(id, fields) { return Object.assign({ id, title: "Goal " + id }, fields); }

test("pipelineStage derives the stage from existing fields without storing one", () => {
  const opts = { today: TODAY };
  assert.equal(core.pipelineStage(goal("d", { goalType: "daily" }), opts), "daily");
  assert.equal(core.pipelineStage(goal("i", { recordKind: "idea", goalType: "active" }), opts), "backlog", "ideas carry goalType active for storage only");
  assert.equal(core.pipelineStage(goal("x", { recordKind: "idea", ideaDeletedAt: 5 }), opts), "deleted");
  assert.equal(core.pipelineStage(goal("f", { goalType: "future", status: "needsPlanning" }), opts), "backlog");
  assert.equal(core.pipelineStage(goal("p", { goalType: "future", status: "future", goalPlan: { definition: "x" } }), opts), "defining");
  assert.equal(core.pipelineStage(goal("r", { goalType: "future", status: "future", goalPlan: readyPlan() }), opts), "ready");
  assert.equal(core.pipelineStage(goal("a", { goalType: "active", status: "active" }), opts), "active");
  assert.equal(core.pipelineStage(goal("l", { goalType: "active" }), opts), "active", "legacy active without status");
  assert.equal(core.pipelineStage(goal("c", { goalType: "active", status: "active", achievedAt: 99 }), opts), "done");
  assert.equal(core.pipelineStage(goal("m", { goalType: "active", status: "active", outcome: "missed" }), opts), "closed");
  assert.equal(core.pipelineStage(goal("s", { goalType: "small" }), opts), "small");
  assert.equal(core.pipelineStage(goal("z", { goalType: "active", status: "active", archivedAt: 3 }), opts), "backlog");
  assert.equal(core.pipelineStage(null), null);
});

test("activationBlocker: only one active goal, and it must be completed first", () => {
  const opts = { today: TODAY };
  const ready = goal("r", { goalType: "future", status: "future", goalPlan: readyPlan() });
  const active = goal("a", { title: "Ship APEX checkout", goalType: "active", status: "active" });
  assert.equal(core.activationBlocker([ready], "r", opts), "");
  const blocked = core.activationBlocker([ready, active], "r", opts);
  assert.match(blocked, /Complete "Ship APEX checkout" first/);
  assert.match(blocked, /until it's completed/);
  // Completing the active goal is what frees the slot.
  assert.equal(core.activationBlocker([ready, Object.assign({}, active, { achievedAt: 1 })], "r", opts), "");
  // A legacy missed record never holds the focus.
  assert.equal(core.activationBlocker([ready, Object.assign({}, active, { outcome: "missed" })], "r", opts), "");
});

test("activationBlocker refuses unplanned goals except through the switch-over", () => {
  const opts = { today: TODAY };
  const draft = goal("d", { goalType: "future", status: "future", goalPlan: { definition: "Earn $500" } });
  assert.match(core.activationBlocker([draft], "d", opts), /Clarity Gate first: \d+ items left/);
  assert.equal(core.activationBlocker([draft], "d", Object.assign({ allowUnplanned: true }, opts)), "");
  assert.match(core.activationBlocker([draft], "missing", opts), /no longer exists/);
  assert.match(core.activationBlocker([goal("dd", { goalType: "daily" })], "dd", opts), /alongside/);
  assert.match(core.activationBlocker([goal("a", { goalType: "active", status: "active" })], "a", opts), /already active/);
});

test("switch-over is needed only when legacy data holds several active goals", () => {
  const a = goal("a", { goalType: "active", status: "active" });
  const b = goal("b", { goalType: "active", status: "active" });
  assert.equal(core.focusResolutionNeeded([a]), false);
  assert.equal(core.focusResolutionNeeded([a, b]), true);
  assert.equal(core.focusResolutionNeeded([a, Object.assign({}, b, { achievedAt: 2 })]), false);
});

test("definingBlocker caps goals in definition at 3", () => {
  const d = (id) => goal(id, { goalType: "future", status: "future", goalPlan: { definition: "x" } });
  assert.equal(core.definingBlocker([d("1"), d("2")], { today: TODAY }), "");
  assert.match(core.definingBlocker([d("1"), d("2"), d("3")], { today: TODAY }), /already defining 3/);
});

test("replanDeadline needs a post-mortem and a valid coin-flip date, and counts the extension", () => {
  const plan = readyPlan();
  const f = core.calculateDeadlineForecast(plan, TODAY);
  const noReason = core.replanDeadline(plan, { inputMode: "date", date: f.dates.p50, rationale: "r", assumptions: "a" }, TODAY);
  assert.equal(noReason.ok, false);
  assert.match(noReason.errors[0], /why the last estimate was off/);
  const padded = core.replanDeadline(plan, { inputMode: "date", date: f.dates.p90, rationale: "r", assumptions: "a", postMortem: "Underestimated setup" }, TODAY);
  assert.equal(padded.ok, false);
  const later = core.addDays(TODAY, 30);
  const f2 = core.calculateDeadlineForecast(plan, later);
  const ok = core.replanDeadline(plan, { inputMode: "date", date: f2.dates.p50, rationale: "r", assumptions: "a", postMortem: "Setup took twice as long" }, later);
  assert.equal(ok.ok, true);
  assert.equal(ok.extensions, 1);
  assert.equal(ok.plan.deadlineHistory.length, 1);
  assert.equal(ok.plan.deadlineHistory[0].date, plan.deadlineDecision.date);
  assert.equal(ok.plan.deadlineDecision.date, f2.dates.p50);
  assert.equal(core.normalizeGoalPlan(plan).extensions, 0, "the input plan is not mutated");
  const again = core.replanDeadline(ok.plan, { inputMode: "date", date: f2.dates.p50, rationale: "r", assumptions: "a", postMortem: "x" }, later);
  assert.equal(again.extensions, 2);
});

test("re-planning counts only the campaigns that are left", () => {
  const plan = readyPlan({ campaigns: [campaign(1, null, { done: true }), campaign(2), campaign(3)] });
  const full = core.calculateDeadlineForecast(plan, TODAY);
  const left = core.calculateDeadlineForecast(plan, TODAY, { remainingOnly: true });
  assert.ok(Math.abs(left.hours.mean - 22) < 1e-9, "one finished campaign of 11h drops out");
  assert.ok(left.dates.p50 < full.dates.p50);
  assert.equal(left.campaigns.length, 2);
  const allDone = readyPlan({ campaigns: [campaign(1, null, { done: true })] });
  assert.match(core.calculateDeadlineForecast(allDone, TODAY, { remainingOnly: true }).error, /Complete the goal/);
  const ok = core.replanDeadline(plan, { inputMode: "date", date: left.dates.p50, rationale: "r", assumptions: "a", postMortem: "p" }, TODAY);
  assert.equal(ok.ok, true, "the remaining-work coin-flip date is accepted");
});
