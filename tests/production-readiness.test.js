/*
 * Phase 0B — production-readiness tests.
 * These deliberately do NOT rely on __SKIP_CLOUD_SAVE for the sync-sensitive
 * cases: they model an authoritative cloud read so the behaviour that only
 * appears in production is actually exercised.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const htmlPath = path.join(__dirname, "..", "goal-app.html");

function extractScript() {
  const html = fs.readFileSync(htmlPath, "utf8");
  const m = html.match(/<script>([\s\S]*)<\/script>/);
  assert.ok(m, "one script block");
  return m[1];
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

/*
 * A production-like harness.
 *  - cache      : what localStorage holds at boot (possibly stale/empty)
 *  - cloud      : the authoritative record set the cloud read returns
 *  - endpoints  : whether backup/notify transports are configured
 * Boot leaves the app in the pre-authoritative state; installAuthoritative()
 * simulates the cloud read completing.
 */
function createProdHarness(options = {}) {
  const elements = {};
  const storage = Object.assign({ "achieve.goals.v1": JSON.stringify(options.cache || []) }, options.storage || {});
  const posted = [];
  const context = {
    console, Date, Math, Promise,
    Blob: class {}, URL: { createObjectURL: () => "" }, FileReader: class {},
    setTimeout: (fn) => { if (options.runTimers && typeof fn === "function") fn(); return 1; },
    clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    fetch: (url, init) => {
      posted.push({ url, body: init && init.body ? JSON.parse(init.body) : null });
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, id: "b1" }) });
    },
    alert(m) { context.lastAlert = m; },
    prompt() { return null; },
    confirm() { return context.confirmValue !== false; },
    localStorage: {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(storage, k) ? storage[k] : null),
      setItem: (k, v) => { storage[k] = String(v); },
      removeItem: (k) => { delete storage[k]; },
    },
    document: {
      getElementById(id) { if (!elements[id]) elements[id] = createElement(id); return elements[id]; },
      createElement: (t) => createElement(t),
      querySelectorAll: () => [],
    },
    navigator: { clipboard: { writeText: () => Promise.resolve() } },
    window: {
      __storage: storage,
      /* Boot with no cloud path, then the harness puts the app back into the
         genuine PRE-AUTHORITATIVE production state below. After the N-1 fix
         every terminal boot path installs an authoritative state, so "pending"
         has to be set up deliberately rather than fallen into. */
      __SKIP_CLOUD_SAVE: true,
      addEventListener() {}, scrollTo() {},
      __GOAL_APP_BACKUP_ENDPOINT: options.backupEndpoint,
      __GOAL_APP_NOTIFY_ENDPOINT: options.notifyEndpoint,
    },
  };
  context.location = { protocol: "https:" };
  context.window.location = context.location;
  context.window.window = context.window;
  context.window.document = context.document;
  context.window.localStorage = context.localStorage;
  context.window.navigator = context.navigator;
  vm.createContext(context);
  vm.runInContext(extractScript(), context, { filename: "goal-app.html" });

  /* Model the pre-authoritative production state: signed in, cloud read still
     in flight, stale cache on screen, nothing decided yet. */
  context.authoritativeStateReady = false;
  context.goals = context.normalizeGoals(options.cache || []);
  context.notificationState = { items: [], emitted: {}, history: [] };
  // "The system is already live" is now a PER-RECORD fact, not a global flag:
  // a global one could be consumed by an empty or stale earlier pass.
  if (options.storage && options.storage["achieve.lifecycle.migrated.v1"]) {
    const stamp = (list) => (list || []).map((g) => Object.assign({}, g, { lifecycleMigratedVersion: 4 }));
    options.cloud = stamp(options.cloud);
    options.cache = stamp(options.cache);
    context.goals = context.normalizeGoals(options.cache || []);
  }
  context.cloudSave.ready = true;
  context.cloudSave.user = { uid: "u1" };
  context.cloudSave.startupPending = true;
  context.cloudSave.initialReadDone = false;

  return {
    context, elements, storage, posted,
    /* The authoritative cloud read completing: cloud records replace the cache,
       exactly as startGoalV2Sync does, then lifecycle evaluation runs. */
    installAuthoritative(now) {
      if (options.cloud) {
        context.goals = context.normalizeGoals(options.cloud);
      }
      context.cloudSave.startupPending = false;
      context.cloudSave.initialReadDone = true;
      return context.installAuthoritativeState("cloud-v2", now);
    },
  };
}

const DAY = 86400000;
function dateOffset(days) {
  const d = new Date(Date.now() + days * DAY);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function goal(over = {}) {
  return Object.assign({
    id: "g1", title: "An active goal", goalType: "active", status: "active",
    deadline: dateOffset(30),
    smallGoals: [{ id: "s1", what: "Do the thing", why: "Because it matters here" }],
  }, over);
}

/* ================================================================== */
/* BL-2 — lifecycle runs on the AUTHORITATIVE set, once                */
/* ================================================================== */

test("BL-2: no lifecycle evaluation happens against the stale cache at boot", () => {
  const overdue = goal({ id: "stale", deadline: dateOffset(-5) });
  const h = createProdHarness({ cache: [overdue], cloud: [goal({ id: "real" })] });

  // Boot has happened. Nothing may have been decided yet.
  assert.equal(h.context.authoritativeStateReady, false, "not authoritative yet");
  const cached = h.context.goals.find((g) => g.id === "stale");
  assert.ok(cached, "the cache is loaded for display");
  assert.equal(cached.outcome, "", "but no missed decision was taken from it");
  assert.equal(h.context.notificationState.items.length, 0, "and no notification was emitted");
});

test("BL-2: evaluation runs only after the cloud read installs the authoritative set", () => {
  const h = createProdHarness({
    cache: [goal({ id: "stale-only-here", deadline: dateOffset(-5) })],
    cloud: [goal({ id: "authoritative", deadline: dateOffset(-5) })],
    storage: { "achieve.lifecycle.migrated.v1": "1" },   // system already live
  });
  const result = h.installAuthoritative();

  assert.equal(h.context.authoritativeStateReady, true);
  assert.equal(result.source, "cloud-v2");
  const ids = h.context.goals.map((g) => g.id);
  assert.deepEqual(JSON.parse(JSON.stringify(ids)), ["authoritative"], "cloud set won");
  assert.equal(h.context.goals[0].outcome, "missed", "decided from the authoritative record");
  assert.equal(h.context.notificationState.items.length, 1, "notified once, from real state");
});

test("BL-2: installing the authoritative state twice changes nothing", () => {
  const h = createProdHarness({
    cloud: [goal({ deadline: dateOffset(-5) })],
    storage: { "achieve.lifecycle.migrated.v1": "1" },
  });
  h.installAuthoritative();
  const missedAt = h.context.goals[0].missedAt;
  const notifications = h.context.notificationState.items.length;

  // Re-run the evaluation against the SAME installed state (a second cloud
  // poll, another tab, a re-render) - it must decide nothing new.
  h.context.installAuthoritativeState("cloud-v2");
  h.context.installAuthoritativeState("cloud-v2");
  assert.equal(h.context.goals[0].missedAt, missedAt, "timestamp stable");
  assert.equal(h.context.notificationState.items.length, notifications, "no extra notifications");
});

/* ================================================================== */
/* Q-1 — existing overdue records are reviewed, not missed             */
/* ================================================================== */

test("Q-1: records already overdue at migration are flagged for review, not missed", () => {
  const h = createProdHarness({ cloud: [goal({ id: "old", deadline: dateOffset(-30) })] });
  h.installAuthoritative();

  const g = h.context.goals[0];
  assert.equal(g.migrationOverdue, true, "flagged Overdue - Review Needed");
  assert.equal(g.outcome, "", "NOT missed");
  assert.equal(g.missedAt, null, "no missedAt invented");
  assert.equal(g.reflectionStatus, "", "no reflection debt");
  assert.equal(h.context.needsReflectionGoals().length, 0);
  assert.equal(h.context.migrationOverdueGoals().length, 1, "reviewable by the operator");
});

test("Q-1: a goal that goes overdue AFTER the system is live follows the missed workflow", () => {
  const today = dateOffset(0);
  const afterDeadline = new Date(today + "T23:59:59").getTime() + 1000;
  const h = createProdHarness({ cloud: [goal({ deadline: today })] });

  h.installAuthoritative();                       // migration runs, nothing overdue
  assert.ok(!h.context.goals[0].migrationOverdue, "not flagged as overdue-at-migration");
  assert.equal(h.context.goals[0].outcome, "");

  h.context.installAuthoritativeState("later", afterDeadline);
  assert.equal(h.context.goals[0].outcome, "missed", "now it is genuinely missed");
  assert.equal(h.context.goals[0].reflectionStatus, "pending");
});

test("Q-1: the review flag is cleared only by the operator, and never rewrites history", () => {
  const h = createProdHarness({ cloud: [goal({ id: "old", deadline: dateOffset(-30), achievedAt: null })] });
  h.installAuthoritative();
  const before = JSON.stringify(h.context.goals[0].smallGoals);

  assert.equal(h.context.clearMigrationOverdue("old"), true);
  assert.equal(h.context.goals[0].migrationOverdue, false);
  assert.equal(JSON.stringify(h.context.goals[0].smallGoals), before, "record untouched");
});

/* ================================================================== */
/* BL-3 — every new surface is gated on the authoritative read         */
/* ================================================================== */

test("BL-3: the new Demo 2-4 surfaces are blanked while the cloud read is pending", () => {
  const h = createProdHarness({ cache: [goal()] });
  h.context.render();

  assert.match(h.elements.activeList.innerHTML, /Loading your saved cloud goals/);
  assert.equal(h.elements.ideasList.innerHTML, "", "ideas blanked");
  assert.equal(h.elements.needsReflectionList.innerHTML, "", "needs-reflection blanked");
  assert.match(h.elements.notifyList.innerHTML, /locked until the account data is confirmed/);
  assert.doesNotMatch(h.elements.notifyList.innerHTML, /Back up now/, "backup controls not offered");
});

test("BL-3: every new mutating action refuses to run before the authoritative read", () => {
  const h = createProdHarness({ cache: [goal()] });
  const c = h.context;
  const refused = {
    completeGoal: c.completeGoal("g1"),
    toggleSmallGoal: c.toggleSmallGoal("g1", "s1"),
    openReflection: c.openReflection("main", "g1", null),
    saveIdea: c.saveIdea(),
    startResearch: c.startResearch("g1"),
    completeResearch: c.completeResearch("g1"),
    returnToIdea: c.returnToIdea("g1"),
    planGoalFromIdea: c.planGoalFromIdea("g1"),
    deleteIdea: c.deleteIdea("g1"),
    restoreIdea: c.restoreIdea("g1"),
    markAllNotificationsRead: c.markAllNotificationsRead(),
  };
  Object.entries(refused).forEach(([name, value]) => {
    assert.equal(value, false, `${name} must refuse while the read is pending`);
  });
  assert.equal(c.goals[0].achievedAt, null, "nothing was mutated");
  assert.equal(c.goals[0].smallGoals[0].done, false);
});

test("BL-3: the same actions work once the authoritative read has completed", () => {
  const h = createProdHarness({ cloud: [goal()], storage: { "achieve.lifecycle.migrated.v1": "1" } });
  h.installAuthoritative();
  assert.equal(h.context.toggleSmallGoal("g1", "s1"), true);
  assert.equal(h.context.goals[0].smallGoals[0].done, true);
});

/* ================================================================== */
/* BL-1 — unavailable transports converge, never loop                  */
/* ================================================================== */

test("BL-1: with no endpoint configured, nothing is ever posted", async () => {
  const h = createProdHarness({ cloud: [goal({ deadline: dateOffset(5), status: "future", goalType: "future",
    smallGoals: [{ id: "a", what: "One thing here", why: "Because it matters" },
                 { id: "b", what: "Another thing here", why: "Because it also matters" }] })] });
  h.installAuthoritative();
  await new Promise((r) => setTimeout(r, 0));

  assert.ok(h.context.notificationState.items.length >= 1, "in-app still works");
  assert.equal(h.posted.length, 0, "no network call was attempted at all");
  const entry = h.context.notificationState.history[0];
  assert.equal(entry.channels.inApp, "delivered");
  assert.equal(entry.channels.gmail, "not configured", "honest, not 'delivered', not 'failed'");
  assert.equal(entry.channels.commandCenter, "not configured");
});

test("BL-1: backup is skipped entirely when no backup transport is configured", () => {
  const h = createProdHarness({ cloud: [goal()] });
  assert.equal(h.context.scheduleBackup(), false, "never scheduled");
  return Promise.resolve(h.context.runBackup(true)).then((r) => {
    assert.equal(r.ok, false);
    assert.equal(r.skipped, "not configured");
    assert.equal(h.posted.length, 0, "no request attempted");
  });
});

test("BL-1: a failing backup transport warns once and then converges", () => {
  const h = createProdHarness({ cloud: [goal()], backupEndpoint: "/api/backup" });
  h.context.fetch = () => Promise.reject(new Error("offline"));
  h.context.window.fetch = h.context.fetch;

  return Promise.resolve(h.context.runBackup(true))
    .then(() => h.context.runBackup(true))
    .then(() => h.context.runBackup(true))
    .then(() => {
      const warnings = h.context.notificationState.items.filter((n) => n.type === "backup_failure");
      assert.equal(warnings.length, 1, "one warning per session, not one per attempt");
      // and the warning itself must not have tried to reach external channels
      const entry = h.context.notificationState.history.find((e) => e.type === "backup_failure");
      assert.equal(entry.channels.gmail, "not configured");
      assert.equal(entry.channels.commandCenter, "not configured");
    });
});

/* ================================================================== */
/* H-4 — cross-device determinism of the synced payload                */
/* ================================================================== */

test("H-4: two independent devices normalize the same cloud payload identically", () => {
  const cloudPayload = [
    { id: "g1786957111769001", title: "A legacy goal with no timestamps", goalType: "active" },
    { id: "old-future", title: "Legacy future", goalType: "future", futureMonth: "2026-10" },
    { id: "g1786957111769002", title: "With children", goalType: "active",
      smallGoals: [{ what: "Do the thing", why: "Because it matters here" }] },
  ];
  const deviceA = createProdHarness({ cloud: cloudPayload });
  const deviceB = createProdHarness({ cloud: cloudPayload });

  const a = deviceA.context.canonicalJson(deviceA.context.normalizeGoals(cloudPayload));
  const b = deviceB.context.canonicalJson(deviceB.context.normalizeGoals(cloudPayload));
  assert.equal(a, b, "the canonical synced payload must be identical across devices");
});

test("H-4: normalize invents no clock reading at all", () => {
  const script = extractScript();
  const start = script.indexOf("function normalize(g, idState)");
  const end = script.indexOf("function normalizeGoals(");
  const body = script.slice(start, end);
  assert.doesNotMatch(body, /Date\.now\(\)/, "no direct clock read");
  assert.doesNotMatch(body, /defaultStamp\(\)/, "no session stamp either — H-4");

  const h = createProdHarness({});
  // A record with no id-derived time and no stored timestamps yields stable zeros.
  const g = h.context.normalize({ id: "no-time-here", title: "x", goalType: "active" });
  assert.equal(g.createdAt, 0);
  assert.equal(g.migratedAt, null);
  const again = h.context.normalize({ id: "no-time-here", title: "x", goalType: "active" });
  assert.equal(g.createdAt, again.createdAt);
});

test("H-4: a migration timestamp comes from the migration event, not from a render", () => {
  const legacy = { id: "lf", title: "Legacy future", goalType: "future", futureMonth: "2026-10", createdAt: 1750000000000 };
  const h = createProdHarness({ cloud: [legacy] });
  assert.equal(h.context.normalize(legacy).migratedAt, null, "normalization alone never stamps");
  h.installAuthoritative(1800000000000);
  const stamped = h.context.goals[0].migratedAt;
  assert.ok(stamped > 0, "the controlled migration stamped it once");
  // HIGH-1: the value is DERIVED, not the device clock, so a second device
  // migrating the same record produces the identical payload.
  assert.notEqual(stamped, 1800000000000, "not a clock reading");
  const other = createProdHarness({ cloud: [legacy] });
  other.installAuthoritative(1900000000000);
  assert.equal(other.context.goals[0].migratedAt, stamped, "identical on a second device");

  h.context.installAuthoritativeState("again", 1950000000000);
  assert.equal(h.context.goals[0].migratedAt, stamped, "and never re-stamps");

  // A record with no derivable time stays null on every device rather than
  // inventing one. legacyClassification remains the durable marker.
  const bare = createProdHarness({ cloud: [{ id: "nope", title: "No time here", goalType: "future" }] });
  bare.installAuthoritative(1800000000000);
  assert.equal(bare.context.goals[0].migratedAt, null, "no invented stamp");
  assert.equal(bare.context.goals[0].legacyClassification, "future", "durable marker still set");
});

/* ================================================================== */
/* H-1 / H-2 / Q-2 — historical victories                              */
/* ================================================================== */

test("H-1: legacy achievedAt victories keep counting after migration", () => {
  const h = createProdHarness({
    cloud: [
      { id: "won", title: "An old completed goal", goalType: "active", achievedAt: 1750000000000,
        smallGoals: [{ id: "c1", text: "A child closed by the parent", done: true }] },
      { id: "smallwin", title: "An old one-day win", goalType: "small", achievedAt: 1750000000001 },
      { id: "daily", title: "A daily routine", goalType: "daily",
        dailyCompletions: [{ id: "d1", date: "2026-01-01", level: "standard" }] },
    ],
  });
  h.installAuthoritative();
  const stats = h.context.victoryStats();

  assert.equal(stats.mainVictories, 1, "the legacy main completion still counts");
  assert.equal(stats.smallVictories, 1, "the legacy standalone small win counts as a SMALL victory");
  assert.equal(stats.totalVictories, 2, "counters do not collapse to zero");
});

test("H-2: a child ticked done by an old parent completion is NOT a small victory", () => {
  const h = createProdHarness({
    cloud: [{ id: "won", title: "An old completed goal", goalType: "active", achievedAt: 1750000000000,
      smallGoals: [
        { id: "c1", text: "Closed by the parent", done: true },
        { id: "c2", text: "Also closed by the parent", done: true },
      ] }],
  });
  h.installAuthoritative();

  assert.equal(h.context.victoryStats().smallVictories, 0, "no independent completion evidence");
  assert.equal(h.context.victoryStats().mainVictories, 1);
  // preserved, not rewritten, and no reflection debt invented
  assert.equal(h.context.goals[0].smallGoals[0].done, true, "history preserved");
  assert.equal(h.context.goals[0].smallGoals[0].reflectionStatus, "");
  assert.equal(h.context.smallGoalsNeedingReflection().length, 0);
});

test("H-2: a child the user explicitly completed DOES count", () => {
  const h = createProdHarness({
    cloud: [goal({ smallGoals: [{ id: "s1", what: "Did this myself", why: "Because it mattered", done: true, completedBy: "user" }] })],
    storage: { "achieve.lifecycle.migrated.v1": "1" },
  });
  h.installAuthoritative();
  assert.equal(h.context.victoryStats().smallVictories, 1);
});

test("Q-2: daily completions never enter Total Victories", () => {
  const h = createProdHarness({
    cloud: [{ id: "daily", title: "Routine", goalType: "daily",
      dailyCompletions: [{ id: "a", date: "2026-01-01", level: "standard" }, { id: "b", date: "2026-01-02", level: "max" }] }],
  });
  h.installAuthoritative();
  const stats = h.context.victoryStats();
  assert.equal(stats.totalVictories, 0, "daily is displayed separately, never counted");
  assert.equal(stats.mainVictories, 0);
  assert.equal(stats.smallVictories, 0);
});

test("Q-2: no reflection report is fabricated for a historical victory", () => {
  const h = createProdHarness({
    cloud: [{ id: "won", title: "An old completed goal", goalType: "active", achievedAt: 1750000000000 }],
  });
  h.installAuthoritative();
  const g = h.context.goals[0];
  assert.equal(g.reflection.submittedAt, null, "no invented reflection");
  assert.equal(g.reflectionStatus, "", "and no false 'complete' claim");
  assert.equal(h.context.needsReflectionGoals().length, 0, "nor retroactive reflection debt");
});

/* ================================================================== */
/* H-5 — external dedupe cannot be device-local                        */
/* ================================================================== */

test("H-5: the event identity is deterministic, so two devices agree on it", () => {
  const g = goal({ id: "shared", deadline: dateOffset(5) });
  const a = createProdHarness({ cloud: [g] });
  const b = createProdHarness({ cloud: [g] });
  const keyA = a.context.notificationKey("future_activation_window", "shared", "2026-01-01");
  const keyB = b.context.notificationKey("future_activation_window", "shared", "2026-01-01");
  assert.equal(keyA, keyB, "same event -> same key on every device");
});

test("H-5: the emitted ledger travels in the backup payload so it can be shared", () => {
  const h = createProdHarness({ cloud: [goal()], backupEndpoint: "/api/backup",
    storage: { "achieve.lifecycle.migrated.v1": "1" } });
  h.installAuthoritative();
  h.context.emitNotification("main_goal_needs_reflection", h.context.goals[0], { dedupe: "x", message: "m" });

  const payload = h.context.buildBackupPayload();
  assert.ok(payload.notifications, "the ledger is part of the durable payload");
  assert.ok(Object.keys(payload.notifications.emitted).length >= 1, "emitted keys are carried");
  // and restoring that payload must not re-emit
  const before = h.context.notificationState.items.length;
  h.context.restoreFromEnvelope(h.context.buildBackupEnvelope());
  h.context.evaluateNotifications(Date.now());
  const after = h.context.notificationState.items.filter((n) => n.type === "main_goal_needs_reflection").length;
  assert.equal(after, 1, "no duplicate after restore");
  assert.ok(before >= 1);
});

/* ================================================================== */
/* H-3 — restore is an explicit authoritative transaction              */
/* ================================================================== */

test("H-3: restore refuses to run before the authoritative read", () => {
  const h = createProdHarness({ cache: [goal()], backupEndpoint: "/api/backup" });
  const envelope = h.context.buildBackupEnvelope();
  const result = h.context.restoreFromEnvelope(envelope);
  assert.equal(result.ok, false, "cannot restore onto unverified state");
  assert.match(result.errors.join(" "), /cloud|authoritative|loading/i);
});

test("H-3: a restore that would collapse the record set is refused, not silently reverted", () => {
  const h = createProdHarness({
    cloud: [goal({ id: "a" }), goal({ id: "b" }), goal({ id: "c" }), goal({ id: "d" }), goal({ id: "e" })],
    storage: { "achieve.lifecycle.migrated.v1": "1" },
    backupEndpoint: "/api/backup",
  });
  h.installAuthoritative();
  const tiny = h.context.buildBackupEnvelope();
  tiny.payload.goals = [h.context.normalize(goal({ id: "a" }))];
  tiny.recordCount = 1;
  tiny.checksum = h.context.checksumOf(h.context.canonicalJson(tiny.payload));

  const result = h.context.restoreFromEnvelope(tiny);
  assert.equal(result.ok, false, "the shrink guard is respected, not weakened");
  assert.match(result.errors.join(" "), /remove|collapse|data loss/i);
  assert.equal(h.context.goals.length, 5, "live data untouched");
});

test("H-3: the pre-restore safety copy is reachable and restorable", () => {
  const h = createProdHarness({
    cloud: [goal({ id: "a" }), goal({ id: "b" })],
    storage: { "achieve.lifecycle.migrated.v1": "1" },
    backupEndpoint: "/api/backup",
  });
  h.installAuthoritative();
  const original = h.context.canonicalJson(h.context.buildBackupPayload().goals);

  const envelope = h.context.buildBackupEnvelope();
  envelope.payload.goals = h.context.normalizeGoals([goal({ id: "a" }), goal({ id: "b" }), goal({ id: "c" })]);
  envelope.recordCount = 3;
  envelope.checksum = h.context.checksumOf(h.context.canonicalJson(envelope.payload));
  assert.equal(h.context.restoreFromEnvelope(envelope).ok, true);
  assert.equal(h.context.goals.length, 3);

  // The safety copy must be a real, listed, restorable recovery path.
  const safety = h.context.readRestoreSafetyCopy();
  assert.ok(safety, "safety copy is retrievable through the app, not just written");
  assert.equal(h.context.validateBackupEnvelope(safety).ok, true, "and is itself valid");
  assert.equal(h.context.restoreFromEnvelope(safety).ok, true);
  assert.equal(h.context.canonicalJson(h.context.buildBackupPayload().goals), original, "rolled back exactly");
});

/* ================================================================== */
/* Remediation round 2 — N-1..N-6, H-3, H-4, BL-1                      */
/* ================================================================== */

test("N-1: every early return in initCloudSave installs an authoritative state", () => {
  const script = extractScript();
  const initStart = script.indexOf("async function initCloudSave()");
  // Only initCloudSave's OWN body - a wider slice would pick up guard
  // clauses in neighbouring functions that are not boot paths at all.
  const init = script.slice(initStart, script.indexOf(String.fromCharCode(10) + "}", initStart));
  const bodyLines = init.split(String.fromCharCode(10));
  const bare = [];
  bodyLines.forEach((line, i) => {
    if (!/return;/.test(line) || /await|catch/.test(line)) return;
    // The install may sit on the same line or just above it in the same branch.
    const window = bodyLines.slice(Math.max(0, i - 5), i + 1).join(" ");
    if (!/installAuthoritativeState/.test(window)) bare.push(line.trim());
  });
  assert.deepEqual(bare, [], "every terminal return must install an authoritative state first");
  ["no-cloud", "file-local", "signed-out"].forEach((tag) => {
    assert.ok(init.indexOf(tag) > -1, tag + " path covered");
  });
});

test("N-1: a no-cloud deployment still evaluates the lifecycle", () => {
  const h = createProdHarness({ cache: [goal({ deadline: dateOffset(-5) })] });
  h.context.installAuthoritativeState("local-only");
  assert.equal(h.context.authoritativeStateReady, true);
  assert.equal(h.context.goals[0].migrationOverdue, true, "the overdue record was classified, not ignored");
});

test("N-2: the Overdue - Review Needed state has a real surface and can be cleared", () => {
  const h = createProdHarness({ cloud: [goal({ id: "old", deadline: dateOffset(-30) })] });
  h.installAuthoritative();
  h.context.render();

  const html = h.elements.overdueReviewList.innerHTML;
  assert.match(html, /Overdue - review needed/i, "it is actually rendered");
  assert.match(html, /An active goal/, "the goal is identifiable");
  assert.match(html, /clearMigrationOverdue/, "and can be cleared from the UI");
  assert.match(html, /Review and re-plan/);

  assert.equal(h.context.clearMigrationOverdue("old"), true);
  assert.equal(h.context.migrationOverdueGoals().length, 0);
});

test("N-2: re-planning an overdue record with a new deadline clears the review flag", () => {
  const h = createProdHarness({ cloud: [goal({ id: "old", deadline: dateOffset(-30) })] });
  h.installAuthoritative();
  assert.equal(h.context.goals[0].migrationOverdue, true);

  h.context.openForm("old");
  h.elements.fTitle.value = "An active goal";
  h.elements.fDeadline.value = dateOffset(60);
  h.context.saveForm();

  assert.equal(h.context.goals[0].migrationOverdue, false, "a new deadline rejoins the ordinary lifecycle");
  assert.equal(h.context.goals[0].outcome, "", "and it is not missed");
});

test("N-3: a FAILED cloud read locks editing instead of unlocking it", () => {
  const h = createProdHarness({ cache: [goal()] });
  // handleInitialCloudSyncFailure leaves exactly this state.
  h.context.cloudSave.startupPending = false;
  h.context.cloudSave.initialReadDone = false;
  h.context.authoritativeStateReady = false;

  assert.equal(h.context.canEditOrExportGoals(), false, "must stay locked after a failed read");
  assert.equal(h.context.completeGoal("g1"), false);
  h.context.render();
  assert.match(h.elements.activeList.innerHTML, /Loading your saved cloud goals/,
    "and the stale cache is not presented as confirmed");
});

test("N-4: a legacy record is not rewritten just because new fields exist", () => {
  const h = createProdHarness({});
  const legacy = { id: "g1750000000000abc", title: "An old goal", goalType: "active", createdAt: 1750000000000 };
  const normalized = h.context.normalizeGoals([legacy])[0];
  assert.equal(normalized.migrationOverdue, undefined, "no empty flag added to every record");
  assert.equal(normalized.lifecycleMigratedVersion, undefined);
  const again = h.context.normalizeGoals([legacy])[0];
  assert.equal(JSON.stringify(normalized), JSON.stringify(again), "and the payload is stable");
});

test("N-5: the migration decision travels with the data, not just localStorage", () => {
  const overdue = goal({ id: "old", deadline: dateOffset(-30) });
  const deviceA = createProdHarness({ cloud: [overdue] });
  deviceA.installAuthoritative();
  assert.equal(deviceA.context.goals[0].migrationOverdue, true);
  assert.equal(deviceA.context.goals[0].lifecycleMigratedVersion, 4, "the record carries the marker");

  // Device B opens later with NO local flag, reading the migrated record.
  const migrated = JSON.parse(JSON.stringify(deviceA.context.goals[0]));
  const deviceB = createProdHarness({ cloud: [migrated] });
  deviceB.installAuthoritative();
  assert.equal(deviceB.context.goals[0].migrationOverdue, true, "still a review item, not re-decided");
  assert.equal(deviceB.context.goals[0].outcome, "", "and device B did not mark it missed");
});

test("N-5: a goal that goes overdue AFTER migration is missed even on a fresh device", () => {
  const today = dateOffset(0);
  const past = new Date(today + "T23:59:59").getTime() + 1000;
  const live = goal({ deadline: today, lifecycleMigratedVersion: 4 });
  const h = createProdHarness({ cloud: [live] });
  h.installAuthoritative(past);
  assert.equal(h.context.goals[0].outcome, "missed", "the live workflow still applies");
  assert.ok(!h.context.goals[0].migrationOverdue, "and it is not treated as a review item");
});

test("N-6: a second restore cannot destroy the first safety copy", () => {
  const h = createProdHarness({
    cloud: [goal({ id: "a" }), goal({ id: "b" }), goal({ id: "c" }), goal({ id: "d" })],
    storage: { "achieve.lifecycle.migrated.v1": "1" },
    backupEndpoint: "/api/backup",
  });
  h.installAuthoritative();
  const original = h.context.canonicalJson(h.context.buildBackupPayload().goals);

  function envelopeWith(ids) {
    const env = h.context.buildBackupEnvelope();
    env.payload.goals = h.context.normalizeGoals(ids.map((id) => goal({ id })));
    env.recordCount = env.payload.goals.length;
    env.checksum = h.context.checksumOf(h.context.canonicalJson(env.payload));
    return env;
  }
  assert.equal(h.context.restoreFromEnvelope(envelopeWith(["a", "b", "c", "d", "e"])).ok, true);
  assert.equal(h.context.restoreFromEnvelope(envelopeWith(["a", "b", "c", "d", "e", "f"])).ok, true);

  const list = JSON.parse(h.storage["achieve.restore.safety.v1"]);
  assert.ok(list.length >= 2, "both safety copies are kept");
  const oldest = list[list.length - 1];
  assert.equal(h.context.restoreFromEnvelope(oldest).ok, true);
  assert.equal(h.context.canonicalJson(h.context.buildBackupPayload().goals), original, "rolled all the way back");
});

test("H-3: the restore guard matches computeDangerousChange exactly", () => {
  const ids = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
  const h = createProdHarness({
    cloud: ids.map((id) => goal({ id })),
    storage: { "achieve.lifecycle.migrated.v1": "1" },
    backupEndpoint: "/api/backup",
  });
  h.installAuthoritative();

  function tryRestore(keepIds) {
    // Reset to the full live set so each case is measured from the same base.
    h.context.goals = h.context.normalizeGoals(ids.map((id) => goal({ id })));
    const env = h.context.buildBackupEnvelope();
    env.payload.goals = h.context.normalizeGoals(keepIds.map((id) => goal({ id })));
    env.recordCount = env.payload.goals.length;
    env.checksum = h.context.checksumOf(h.context.canonicalJson(env.payload));
    return h.context.restoreFromEnvelope(env).ok;
  }
  // sync-safety-v2: dangerous when removedCount >= 3 OR ratio >= 0.5 OR empty.
  assert.equal(tryRestore(ids.slice(0, 8)), true, "removing 2 is safe");
  assert.equal(tryRestore(ids.slice(0, 7)), false, "removing 3 is refused, matching the sync guard");
  assert.equal(tryRestore(ids.slice(0, 6)), false, "the old count-based check wrongly allowed 10 to 6");
  assert.equal(tryRestore([]), false, "empty is refused");
});

test("BL-1: the backup panel tells the truth when nothing is configured", () => {
  const h = createProdHarness({ cloud: [goal()], storage: { "achieve.lifecycle.migrated.v1": "1" } });
  h.installAuthoritative();
  const html = h.context.backupPanelHtml();
  assert.match(html, /Not configured/);
  assert.doesNotMatch(html, /files on disk/, "no false storage claim");
  assert.doesNotMatch(html, /outside browser storage/);
  assert.doesNotMatch(html, /Back up now/, "and no control that would 404");

  return Promise.resolve(h.context.backupNow()).then((r) => {
    assert.equal(r, false);
    assert.equal(h.posted.length, 0, "nothing was requested");
    return h.context.refreshBackupList();
  }).then((r) => {
    assert.equal(r, false);
    assert.equal(h.posted.length, 0, "still nothing requested");
  });
});

test("H-4: two devices mint identical ids for children with dirty or missing ids", () => {
  const payload = [{
    id: "g1786957111769001", title: "With messy children", goalType: "active",
    smallGoals: [
      { what: "No id at all", why: "Because it matters here" },
      { id: "has space", what: "Invalid id", why: "Because it matters here" },
      { id: "dup", what: "First dup", why: "Because it matters here" },
      { id: "dup", what: "Second dup", why: "Because it matters here" },
    ],
  }];
  const a = createProdHarness({});
  const b = createProdHarness({});
  const idsA = a.context.normalizeGoals(payload)[0].smallGoals.map((s) => s.id);
  const idsB = b.context.normalizeGoals(payload)[0].smallGoals.map((s) => s.id);
  assert.deepEqual(JSON.parse(JSON.stringify(idsA)), JSON.parse(JSON.stringify(idsB)),
    "child ids must be identical across devices");
  assert.equal(new Set(idsA).size, idsA.length, "and still unique within the goal");
  assert.equal(a.context.canonicalJson(a.context.normalizeGoals(payload)),
               b.context.canonicalJson(b.context.normalizeGoals(payload)),
               "the whole canonical payload matches");
});

test("H-4: the determinism guard covers the small-goal and step functions too", () => {
  const script = extractScript();
  ["function normalizeSmallGoals(", "function normalizeSmallGoalSteps("].forEach((marker) => {
    const start = script.indexOf(marker);
    // Slice to the END of the function, not a fixed window - otherwise this
    // reads into normalizeTimerSessions, which legitimately uses the clock.
    const body = script.slice(start, script.indexOf(String.fromCharCode(10) + "}", start));
    assert.doesNotMatch(body, /Date\.now\(\)/, marker + " must not read the clock");
    assert.doesNotMatch(body, /Math\.random\(\)/, marker + " must not mint random ids");
  });
});

/* ================================================================== */
/* Pre-deploy review — BLOCKER-1, HIGH-1, HIGH-2                       */
/* ================================================================== */

test("BLOCKER-1: a goal created AFTER go-live is MISSED at the next boot, not treated as pre-existing", () => {
  // Create through the real UI path, persist, then reboot and advance the clock.
  const today = dateOffset(0);
  const past = new Date(today + "T23:59:59").getTime() + 1000;

  const h = createProdHarness({ cloud: [] });
  h.installAuthoritative();                       // system is live, empty account

  h.context.openForm(null, "active");
  h.elements.fTitle.value = "A goal I created after go-live";
  h.elements.fDeadline.value = today;
  h.context.saveDraft();
  const id = h.context.editId;
  h.context.goals.find((g) => g.id === id).status = "active";
  h.context.save();
  assert.equal(h.context.goals.find((g) => g.id === id).lifecycleMigratedVersion, 4,
    "a record created now carries the migration marker immediately");

  // Second boot, from what was actually persisted, after the deadline passes.
  const persisted = JSON.parse(h.storage["achieve.goals.v1"]);
  const reboot = createProdHarness({ cloud: persisted });
  reboot.installAuthoritative(past);

  const g = reboot.context.goals.find((x) => x.id === id);
  assert.equal(g.outcome, "missed", "it follows the Missed workflow, NOT Overdue-review");
  assert.ok(!g.migrationOverdue, "and is not mistaken for a pre-existing overdue record");
  assert.equal(g.reflectionStatus, "pending", "reflection is required as designed");
  assert.equal(reboot.context.migrationOverdueGoals().length, 0);
});

test("BLOCKER-1: an Idea created after go-live also carries the marker", () => {
  const h = createProdHarness({ cloud: [] });
  h.installAuthoritative();
  h.context.openIdeaForm(null);
  h.elements.fIdeaTitle.value = "An idea captured after go-live";
  h.elements.fIdeaBrainstorm.value = "Some rough thinking";
  h.context.saveIdea();
  assert.equal(h.context.ideaRecords()[0].lifecycleMigratedVersion, 4);
});

test("BLOCKER-1: a genuinely pre-existing overdue record is still reviewed, not missed", () => {
  // The other half of Q-1 must not regress while fixing the first.
  const h = createProdHarness({ cloud: [goal({ id: "old", deadline: dateOffset(-30) })] });
  h.installAuthoritative();
  const g = h.context.goals[0];
  assert.equal(g.migrationOverdue, true);
  assert.equal(g.outcome, "");
  assert.equal(g.missedAt, null);
  assert.equal(g.reflectionStatus, "");
});

test("HIGH-1: the migration itself is cross-device deterministic, not just normalize()", () => {
  const payload = [
    { id: "g1786957111769001", title: "Legacy future one", goalType: "future", futureMonth: "2026-10", createdAt: 1750000000000 },
    { id: "g1786957111769002", title: "Legacy future two", goalType: "future", futureMonth: "2026-11" },
    { id: "g1786957111769003", title: "An overdue active", goalType: "active", status: "active", deadline: dateOffset(-9) },
  ];
  const a = createProdHarness({ cloud: payload });
  const b = createProdHarness({ cloud: payload });
  // Deliberately different clocks: the migration must not bake either one in.
  a.installAuthoritative(1800000000000);
  b.installAuthoritative(1900000000000);

  assert.equal(
    a.context.canonicalJson(a.context.normalizeGoals(a.context.goals)),
    b.context.canonicalJson(b.context.normalizeGoals(b.context.goals)),
    "two devices must produce byte-identical payloads after migrating"
  );
});

test("HIGH-2: no demo copy reaches the production notifications UI", () => {
  const html = fs.readFileSync(htmlPath, "utf8");
  assert.doesNotMatch(html, /local adapter in this demo/i, "demo wording must not ship");
  assert.doesNotMatch(html, /in this demo/i);

  const h = createProdHarness({ cloud: [goal()], storage: { "achieve.lifecycle.migrated.v1": "1" } });
  h.installAuthoritative();
  h.context.render();
  const summary = h.context.notificationChannelSummary();
  assert.match(summary, /not configured for this deployment/i, "channels are described honestly");
  assert.match(summary, /Gmail and Command Center/);
  assert.doesNotMatch(h.elements.notifyList.innerHTML, /demo/i);
});

test("MEDIUM-1: undefined checks walk the LIVE objects, not a JSON round trip", () => {
  // JSON.stringify silently drops undefined, so a round-trip walk can never
  // fail. What Firestore actually receives is the in-memory payload.
  const h = createProdHarness({ cloud: [goal({ id: "a" }), { id: "idea", title: "An idea", recordKind: "idea" }] });
  h.installAuthoritative();
  const live = h.context.syncableGoals();
  const bad = [];
  const walk = (v, p) => {
    if (Array.isArray(v)) return v.forEach((x, i) => walk(x, p + "[" + i + "]"));
    if (v && typeof v === "object") {
      Object.keys(v).forEach((k) => {
        if (v[k] === undefined) bad.push(p + "." + k);
        if (typeof v[k] === "function") bad.push(p + "." + k + " (function)");
        walk(v[k], p + "." + k);
      });
    }
  };
  live.forEach((g, i) => walk(g, "record[" + i + "]"));
  assert.deepEqual(bad, [], "no undefined or function values reach the sync payload");
  assert.ok(live.length >= 2, "and the check actually inspected records");
});

/* ================================================================== */
/* HIGH-A — "Keep as active" must survive the NEXT boot                 */
/* ================================================================== */

test("HIGH-A: Keep as active genuinely keeps it active across a reboot", () => {
  // The previous coverage stopped at "the review list is empty" and never
  // rebooted, which is exactly how this defect survived two review rounds.
  const overdue = goal({ id: "old", deadline: dateOffset(-9) });
  const h = createProdHarness({ cloud: [overdue] });
  h.installAuthoritative();
  assert.equal(h.context.goals[0].migrationOverdue, true, "flagged for review first");

  assert.equal(h.context.clearMigrationOverdue("old"), true);
  assert.equal(h.context.migrationOverdueGoals().length, 0);
  assert.equal(h.context.goals[0].overdueAcknowledgedDeadline, overdue.deadline,
    "the accepted deadline is recorded");

  // SECOND BOOT from what was actually persisted.
  const persisted = JSON.parse(h.storage["achieve.goals.v1"]);
  const reboot = createProdHarness({ cloud: persisted });
  reboot.installAuthoritative();

  const g = reboot.context.goals[0];
  assert.equal(g.outcome, "", "it is NOT silently missed on the next boot");
  assert.equal(g.missedAt, null, "no miss timestamp");
  assert.equal(g.reflectionStatus, "", "and no reflection debt");
  assert.equal(reboot.context.needsReflectionGoals().length, 0);
  assert.equal(reboot.context.migrationOverdueGoals().length, 0, "nor back in the review list");
});

test("HIGH-A: the exemption ends as soon as the deadline changes", () => {
  const h = createProdHarness({ cloud: [goal({ id: "old", deadline: dateOffset(-9) })] });
  h.installAuthoritative();
  h.context.clearMigrationOverdue("old");

  // Give it a new deadline that is ALSO in the past: the acknowledgement no
  // longer matches, so the ordinary Missed workflow must apply again.
  const newDeadline = dateOffset(-3);
  h.context.goals[0].deadline = newDeadline;
  h.context.save();

  const persisted = JSON.parse(h.storage["achieve.goals.v1"]);
  const reboot = createProdHarness({ cloud: persisted });
  reboot.installAuthoritative();
  const g = reboot.context.goals[0];
  assert.equal(g.outcome, "missed", "a different deadline is not covered by the old acknowledgement");
  assert.equal(g.reflectionStatus, "pending");
});

test("HIGH-A: a future deadline set through the planner clears the review cleanly", () => {
  const h = createProdHarness({ cloud: [goal({ id: "old", deadline: dateOffset(-9) })] });
  h.installAuthoritative();
  h.context.openForm("old");
  h.elements.fTitle.value = "An active goal";
  h.elements.fDeadline.value = dateOffset(60);
  h.context.saveForm();

  const persisted = JSON.parse(h.storage["achieve.goals.v1"]);
  const reboot = createProdHarness({ cloud: persisted });
  reboot.installAuthoritative();
  const g = reboot.context.goals[0];
  assert.equal(g.migrationOverdue, undefined || !g.migrationOverdue ? g.migrationOverdue : true, "not in review");
  assert.ok(!g.migrationOverdue);
  assert.equal(g.outcome, "", "and not missed - the deadline is in the future");
});

test("HIGH-A: the acknowledgement is deterministic and prunes when unused", () => {
  const h = createProdHarness({});
  const plain = h.context.normalizeGoals([{ id: "g1750000000000a", title: "x", goalType: "active" }])[0];
  assert.equal(plain.overdueAcknowledgedDeadline, undefined, "absent on records that never used it");

  // It stores the deadline string itself, never a clock reading.
  const acked = h.context.normalize({ id: "g2", title: "x", goalType: "active",
    deadline: "2026-08-16", overdueAcknowledgedDeadline: "2026-08-16" });
  assert.equal(acked.overdueAcknowledgedDeadline, "2026-08-16");
  const again = h.context.normalize(acked);
  assert.equal(again.overdueAcknowledgedDeadline, "2026-08-16", "stable across reads");
});
