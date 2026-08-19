/*
 * Demo 4 — notifications, backup and recovery.
 * See GOAL_APP_DEMO_4_NOTIFICATIONS_BACKUP_INTEGRATION_PLAN.md.
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

/*
 * The harness models the local backup service in memory: a fake fetch that
 * behaves like demo-server.mjs, including retention. options.offline makes
 * every external channel fail, so failure handling can be proven.
 */
function createHarness(seedGoals = [], options = {}) {
  const elements = {};
  const storage = Object.assign({ "achieve.goals.v1": JSON.stringify(seedGoals) }, options.storage || {});
  const server = options.server || { backups: [], spool: [], retention: 10, nextId: 1 };

  function fakeFetch(url, init) {
    if (options.offline) return Promise.reject(new Error("network down"));
    const method = (init && init.method) || "GET";
    const body = init && init.body ? JSON.parse(init.body) : null;
    const ok = (json) => Promise.resolve({ ok: true, json: () => Promise.resolve(json) });

    if (url.split("?")[0] === "/api/backup" && method === "POST") {
      if (!body || !body.backupVersion || !body.checksum) {
        return Promise.resolve({ ok: false, status: 400, json: () => Promise.resolve({ error: "bad envelope" }) });
      }
      // Mirrors the authoritative server-side shrink guard.
      const intent = /intent=manual/.test(url) ? "manual" : "auto";
      const newest = server.backups.find((b2) => Number(b2.envelope.recordCount) > 0);
      if (intent === "auto" && newest) {
        const nowCount = Number(body.recordCount) || 0;
        if (nowCount === 0 || nowCount < newest.envelope.recordCount / 2) {
          return Promise.resolve({ ok: false, status: 409, json: () => Promise.resolve({ error: "suspicious-shrink" }) });
        }
      }
      const id = `backup-${String(1700000000000 + server.nextId).padStart(13, "0")}-${String(server.nextId).padStart(6, "0")}.json`;
      server.nextId += 1;
      server.backups.unshift({ id, envelope: JSON.parse(JSON.stringify(body)) });
      server.backups = server.backups.slice(0, server.retention);
      return ok({ ok: true, id, retained: server.backups.length });
    }
    if (url === "/api/backups") {
      return ok({ backups: server.backups.map((b) => ({
        id: b.id, backupVersion: b.envelope.backupVersion, createdAt: b.envelope.createdAt,
        recordCount: b.envelope.recordCount, checksum: b.envelope.checksum, bytes: JSON.stringify(b.envelope).length,
      })) });
    }
    if (url.startsWith("/api/backup/")) {
      const id = decodeURIComponent(url.slice("/api/backup/".length));
      const found = server.backups.find((b) => b.id === id);
      if (!found) return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({ error: "nf" }) });
      return ok(found.envelope);
    }
    if (url === "/api/notify" && method === "POST") {
      server.spool.push(body);
      return ok({ ok: true, mode: "mock" });
    }
    return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
  }

  const context = {
    console, Date, Math, Promise,
    Blob: class Blob {}, URL: { createObjectURL: () => "blob:test" }, FileReader: class FileReader {},
    setTimeout: (fn) => { if (options.runTimers && typeof fn === "function") fn(); return 1; },
    clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    fetch: fakeFetch,
    alert(m) { context.lastAlert = m; },
    prompt() { return context.nextPromptValue; },
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
    navigator: { clipboard: { writeText() { return Promise.resolve(); } } },
    window: {
      __storage: storage, __SKIP_CLOUD_SAVE: true, addEventListener() {}, scrollTo() {},
      // Phase 0B BL-1: endpoints are opt-in. The harness models a deployment
      // where the local backup service IS configured, unless a test opts out.
      __GOAL_APP_BACKUP_ENDPOINT: options.noBackupEndpoint ? undefined : "/api/backup",
      __GOAL_APP_NOTIFY_ENDPOINT: options.noNotifyEndpoint ? undefined : "/api/notify",
    },
  };
  context.window.window = context.window;
  context.window.document = context.document;
  context.window.localStorage = context.localStorage;
  context.window.navigator = context.navigator;
  context.window.fetch = fakeFetch;
  vm.createContext(context);
  vm.runInContext(extractScript(), context, { filename: "goal-app.html" });
  context.cloudSave.user = { uid: "t" };
  context.cloudSave.initialReadDone = true;
  return { context, elements, storage, server };
}

function reload(storage, server, options = {}) {
  return createHarness(JSON.parse(storage["achieve.goals.v1"]), Object.assign({ server, storage }, options));
}

const DAY = 86400000;
function dateOffset(days) {
  const d = new Date(Date.now() + days * DAY);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function futureGoal(overrides = {}) {
  return Object.assign({
    id: "f1", title: "Launch the accountability group", goalType: "future", status: "future",
    deadline: dateOffset(30), color: "violet",
    smallGoals: [
      { id: "a", what: "Write the group charter", why: "Nobody joins unclear terms", estimateMinutes: 90 },
      { id: "b", what: "Invite the first five members", why: "A direct ask fills the cohort", estimateMinutes: 60 },
    ],
  }, overrides);
}

/* ================================================================== */
/* Future reminder window                                             */
/* ================================================================== */

/* Drives the clock explicitly so "N days remaining" means exactly what the
   app own daysUntilDeadline() reports - no calendar drift in the test. */
function clockForDaysLeft(deadline, n) {
  return new Date(deadline + "T23:59:59").getTime() - n * DAY + 1000;
}

test("no reminder fires at 15 days out", () => {
  const deadline = dateOffset(60);
  const { context } = createHarness([futureGoal({ deadline })]);
  const now = clockForDaysLeft(deadline, 15);
  assert.equal(context.daysUntilDeadline(context.goals[0], now), 15, "the fixture really is 15 days out");
  assert.equal(context.evaluateNotifications(now), 0, "no reminder yet");
  assert.equal(context.notificationState.items.length, 0);
});

test("a reminder fires at exactly 14 days out", () => {
  const deadline = dateOffset(60);
  const { context } = createHarness([futureGoal({ deadline })]);
  const now = clockForDaysLeft(deadline, 14);
  assert.equal(context.daysUntilDeadline(context.goals[0], now), 14);
  assert.equal(context.evaluateNotifications(now), 1, "the window opens at 14");
  const items = context.notificationState.items.filter((n) => n.type === "future_activation_window");
  assert.equal(items.length, 1, "exactly one reminder");
  assert.match(items[0].message, /Review it and decide whether to move it to Active/);
  assert.equal(items[0].action, "Review and move to Active");
});

test("a reminder still applies inside the window at 13 days and on the deadline day", () => {
  const deadline = dateOffset(60);
  [13, 1, 0].forEach((n) => {
    const { context } = createHarness([futureGoal({ deadline })]);
    const now = clockForDaysLeft(deadline, n);
    assert.equal(context.evaluateNotifications(now), 1, n + " days remaining should remind");
    assert.equal(context.notificationState.items.length, 1);
  });
});

test("the reminder is emitted once and never duplicates across reloads", () => {
  const { context, storage, server } = createHarness([futureGoal({ deadline: dateOffset(10) })]);
  assert.equal(context.notificationState.items.length, 1);
  context.evaluateNotifications(Date.now());
  context.evaluateNotifications(Date.now());
  assert.equal(context.notificationState.items.length, 1, "repeat evaluation adds nothing");

  const after = reload(storage, server);
  assert.equal(after.context.notificationState.items.length, 1, "reload does not duplicate");
  after.context.evaluateNotifications(Date.now());
  assert.equal(after.context.notificationState.items.length, 1);
});

test("an Active goal gets no Future reminder", () => {
  const { context } = createHarness([futureGoal({ status: "active", goalType: "active", deadline: dateOffset(10) })]);
  assert.equal(context.notificationState.items.filter((n) => n.type === "future_activation_window").length, 0);
});

test("moving a Future goal to Active stops it being reminded again", () => {
  const { context } = createHarness([futureGoal({ deadline: dateOffset(20) })]);
  assert.equal(context.notificationState.items.length, 0, "outside the window to begin with");
  context.activateFutureGoal("f1");
  assert.equal(context.evaluateNotifications(Date.now() + 11 * DAY), 0, "no reminder once it is Active");
});

test("completed, missed and invalid records never get a Future reminder", () => {
  const cases = [
    ["completed", futureGoal({ deadline: dateOffset(5), achievedAt: 123, outcome: "completed", reflectionStatus: "complete" })],
    ["missed", futureGoal({ deadline: dateOffset(5), outcome: "missed", reflectionStatus: "complete" })],
    ["one small goal", futureGoal({ deadline: dateOffset(5), smallGoals: [{ id: "a", what: "Only one thing", why: "Not enough for future" }] })],
    ["no deadline", futureGoal({ deadline: "" })],
    ["draft", futureGoal({ status: "draft", deadline: dateOffset(5) })],
    ["needs planning", { id: "n", title: "Old capture", goalType: "future", futureMonth: "2026-10" }],
    ["idea", { id: "i", title: "An idea", recordKind: "idea", ideaStatus: "idea", deadline: dateOffset(5) }],
    ["researching", { id: "r", title: "Researching", recordKind: "idea", ideaStatus: "researching", deadline: dateOffset(5) }],
  ];
  cases.forEach(([label, record]) => {
    const { context } = createHarness([record]);
    const reminders = context.notificationState.items.filter((n) => n.type === "future_activation_window");
    assert.equal(reminders.length, 0, `${label} must not be reminded`);
  });
});

/* ================================================================== */
/* Reflection + missed notifications                                  */
/* ================================================================== */

test("completing a goal raises exactly one reflection notification", () => {
  const { context } = createHarness([{
    id: "g", title: "A goal", goalType: "active", status: "active", deadline: dateOffset(40),
    smallGoals: [{ id: "s", what: "Do the thing", why: "Because it matters" }],
  }]);
  context.completeGoal("g");
  context.evaluateNotifications(Date.now());
  context.evaluateNotifications(Date.now());
  const items = context.notificationState.items.filter((n) => n.type === "main_goal_needs_reflection");
  assert.equal(items.length, 1);
  assert.equal(items[0].action, "Complete reflection");
});

test("a missed goal raises exactly one missed notification", () => {
  const today = dateOffset(0);
  const past = new Date(today + "T23:59:59").getTime() + 1000;
  const { context } = createHarness([{
    id: "g", title: "A goal I missed", goalType: "active", status: "active", deadline: today,
    smallGoals: [{ id: "s", what: "Do the thing", why: "Because it matters" }],
  }]);
  context.evaluateMissedGoals(past);
  context.evaluateNotifications(past);
  const items = context.notificationState.items.filter((n) => n.type === "goal_missed_needs_reflection");
  assert.equal(items.length, 1);
  assert.match(items[0].message, /does not enter Victory/);
});

test("in-app unread and read state persists across reload", () => {
  const { context, storage, server } = createHarness([futureGoal({ deadline: dateOffset(10) })]);
  assert.equal(context.unreadNotificationCount(), 1);
  const id = context.notificationState.items[0].id;

  const stillUnread = reload(storage, server);
  assert.equal(stillUnread.context.unreadNotificationCount(), 1, "unread survives reload");

  stillUnread.context.markNotificationRead(id);
  assert.equal(stillUnread.context.unreadNotificationCount(), 0);

  const afterRead = reload(stillUnread.storage, server);
  assert.equal(afterRead.context.unreadNotificationCount(), 0, "read survives reload");
  assert.equal(afterRead.context.notificationState.items.length, 1, "and is not duplicated");
});

/* ================================================================== */
/* Channel fan-out and failure                                        */
/* ================================================================== */

test("one event fans out to every ENABLED channel from a single lifecycle decision", async () => {
  const { context, server } = createHarness([futureGoal({ deadline: dateOffset(10) })]);
  // Ruling Q-4: Gmail and Command Center ship disabled. Enable them explicitly
  // to prove the fan-out contract still works when a deployment turns them on.
  context.NOTIFY_CHANNEL_STATE.gmail.enabled = true;
  context.NOTIFY_CHANNEL_STATE.commandCenter.enabled = true;
  context.notificationState = { items: [], emitted: {}, history: [] };
  context.evaluateNotifications(Date.now());
  await new Promise((r) => setTimeout(r, 0));
  const channels = server.spool.map((s) => s.channel).sort();
  assert.deepEqual(channels, ["commandCenter", "gmail"], "both external adapters received the event");
  assert.equal(context.notificationState.items.length, 1, "and in-app got it once");

  const gmail = server.spool.find((s) => s.channel === "gmail");
  assert.match(gmail.subject, /^Goal approaching: Launch the accountability group$/);
  assert.match(gmail.body, /Suggested next step: Review and move to Active/);
  assert.equal(gmail.eventType, "future_activation_window");

  const cc = server.spool.find((s) => s.channel === "commandCenter");
  assert.equal(cc.app, "goal-app");
  assert.equal(cc.eventType, "future_activation_window");
});

test("a channel failure is recorded and cannot corrupt goal state", async () => {
  const { context } = createHarness([futureGoal({ deadline: dateOffset(10) })], { offline: true });
  context.NOTIFY_CHANNEL_STATE.gmail.enabled = true;
  context.NOTIFY_CHANNEL_STATE.commandCenter.enabled = true;
  context.notificationState = { items: [], emitted: {}, history: [] };
  context.evaluateNotifications(Date.now());
  await new Promise((r) => setTimeout(r, 0));
  const goal = context.goals[0];
  assert.equal(goal.status, "future", "goal untouched");
  assert.equal(goal.outcome, "");
  assert.equal(context.notificationState.items.length, 1, "in-app still worked");

  const entry = context.notificationState.history[0];
  assert.equal(entry.channels.inApp, "delivered");
  assert.match(String(entry.channels.gmail), /^failed/, "failure is recorded honestly, not as delivered");
  assert.match(String(entry.channels.commandCenter), /^failed/);
});

test("no secrets or credentials appear in the app file", () => {
  const html = fs.readFileSync(htmlPath, "utf8");
  [/client_secret/i, /refresh_token/i, /Bearer\s+[A-Za-z0-9._-]{20,}/, /-----BEGIN [A-Z ]*PRIVATE KEY/].forEach((re) => {
    assert.doesNotMatch(html, re, `must not contain ${re}`);
  });
  // The Gmail adapter must not hard-code a recipient address.
  assert.doesNotMatch(html, /to:\s*"[^"@]+@[^"]+"/, "no hard-coded recipient");
});

/* ================================================================== */
/* Backup                                                             */
/* ================================================================== */

function richHarness() {
  const today = dateOffset(0);
  const h = createHarness([
    { id: "idea1", title: "Become fluent in Spanish", recordKind: "idea", ideaStatus: "converted",
      brainstorm: "My grandmother speaks it", convertedGoalId: "won1", roughEffortMinutes: 12000,
      researchStartedAt: 1750000000000, researchCompletedAt: 1750100000000 },
    { id: "idea2", title: "Learn to sail", recordKind: "idea", ideaStatus: "researching", roughEffortMinutes: 600 },
    { id: "draft1", title: "A half planned draft", goalType: "active", status: "draft" },
    { id: "active1", title: "An active goal", goalType: "active", status: "active", deadline: dateOffset(40),
      smallGoals: [{ id: "s1", what: "Do the first thing", why: "It unblocks the rest", estimateMinutes: 45 }] },
    futureGoal({ deadline: dateOffset(60) }),
    { id: "won1", title: "A completed goal", goalType: "active", status: "active", deadline: dateOffset(40),
      originIdeaId: "idea1", skills: "Legacy knowledge notes", milestones: [{ text: "Legacy milestone", done: true }],
      smallGoals: [{ id: "ws", what: "Ship the first version", why: "Shipping creates real signal", estimateMinutes: 120 }] },
  ]);
  // Small goal completed + reflected, then main completed + reflected -> Victory
  h.context.toggleSmallGoal("won1", "ws");
  h.context.submitSmallGoalReflection("won1", "ws", {
    worked: "Blocking the whole morning for it", slowed: "I kept polishing the wording",
    learned: "Shipping rough beats polishing forever", better: "Set a timer and ship at the bell",
  });
  h.context.completeGoal("won1");
  h.context.submitGoalReflection("won1", {
    faster: "Start the outreach in week one", mistakes: "Rewrote the page three times",
    risks: "Letting a busy term stop everything", learned: "Direct messages convert best",
    worked: "Asking every happy parent for a referral", nextTime: "Ship rough and iterate",
  });
  // A missed + reflected goal
  h.context.goals.push(h.context.normalize({
    id: "missed1", title: "A goal I missed", goalType: "active", status: "active", deadline: today,
    smallGoals: [{ id: "ms", what: "Finish unit nine", why: "It is the weakest topic" }],
  }));
  h.context.evaluateMissedGoals(new Date(today + "T23:59:59").getTime() + 1000);
  h.context.submitGoalReflection("missed1", {
    cause: "I stopped once exams started", mistakes: "Never reduced the weekly target",
    different: "Kept a smaller weekly minimum", learned: "A reduced plan survives a busy term",
    worked: "The notes I did write were good", nextTime: "Set a minimum version for hard weeks",
  });
  return h;
}

test("the backup envelope is versioned, counted and checksummed", () => {
  const { context } = richHarness();
  const env = context.buildBackupEnvelope();
  assert.equal(env.backupVersion, 1);
  assert.equal(env.appSchemaVersion, 4);
  assert.ok(env.createdAt > 0);
  assert.equal(env.recordCount, context.goals.length);
  assert.match(env.checksum, /^[0-9a-f]{8}$/);
  assert.equal(context.validateBackupEnvelope(env).ok, true);
});

test("canonical serialization is stable regardless of key order", () => {
  const { context } = createHarness([]);
  const a = { b: 1, a: { d: [1, 2], c: "x" } };
  const b = { a: { c: "x", d: [1, 2] }, b: 1 };
  assert.equal(context.canonicalJson(a), context.canonicalJson(b));
  assert.equal(context.checksumOf(context.canonicalJson(a)), context.checksumOf(context.canonicalJson(b)));
});

test("the backup contains every record type and no undefined values", () => {
  const { context } = richHarness();
  const env = context.buildBackupEnvelope();
  const ids = env.payload.goals.map((g) => g.id);
  ["idea1", "idea2", "draft1", "active1", "f1", "won1", "missed1"].forEach((id) => {
    assert.ok(ids.includes(id), `${id} must be backed up`);
  });
  const walk = (v, p) => {
    if (Array.isArray(v)) return v.forEach((x, i) => walk(x, `${p}[${i}]`));
    if (v && typeof v === "object") Object.entries(v).forEach(([k, x]) => {
      assert.notEqual(x, undefined, `${p}.${k} must not be undefined`);
      walk(x, `${p}.${k}`);
    });
  };
  walk(JSON.parse(JSON.stringify(env)), "envelope");
  assert.doesNotMatch(JSON.stringify(env), /:undefined/);
});

test("a backup never contains another backup", () => {
  const { context, server } = richHarness();
  return Promise.resolve(context.runBackup(true)).then(() => {
    const env = server.backups[0].envelope;
    assert.equal(env.payload.backupVersion, undefined, "payload is data, not an envelope");
    assert.equal(env.payload.payload, undefined);
    const asText = JSON.stringify(env);
    const nested = (asText.match(/"backupVersion"/g) || []).length;
    assert.equal(nested, 1, "exactly one backupVersion in the whole file");
  });
});

test("an unchanged state does not create endless duplicate backups", () => {
  const { context, server } = richHarness();
  return Promise.resolve(context.runBackup(true))
    .then(() => context.runBackup())
    .then((r) => {
      assert.equal(r.skipped, "unchanged", "identical state is skipped");
      return context.runBackup();
    })
    .then(() => {
      assert.equal(server.backups.length, 1, "still exactly one backup");
      // A real change produces exactly one more.
      context.goals[0].brainstorm = "Changed thinking";
      context.save();
      return context.runBackup();
    })
    .then(() => {
      assert.equal(server.backups.length, 2, "a genuine change backs up once");
    });
});

test("backup retention is bounded", () => {
  const { context, server } = createHarness([{ id: "g", title: "A goal", goalType: "active", status: "active" }]);
  server.retention = 10;
  let chain = Promise.resolve();
  for (let i = 0; i < 16; i += 1) {
    chain = chain.then(() => { context.goals[0].title = "A goal " + i; return context.runBackup(true); });
  }
  return chain.then(() => {
    assert.equal(server.backups.length, 10, "older backups are pruned");
  });
});

/* ================================================================== */
/* Restore                                                            */
/* ================================================================== */

test("a malformed or corrupt backup is rejected and live data is untouched", () => {
  const { context } = richHarness();
  const good = context.buildBackupEnvelope();
  const before = context.canonicalJson(context.buildBackupPayload());

  const corrupt = JSON.parse(JSON.stringify(good));
  corrupt.payload.goals.push({ id: "injected", title: "Tampered" });
  const rejected = context.restoreFromEnvelope(corrupt);
  assert.equal(rejected.ok, false);
  assert.ok(rejected.errors.join(" ").match(/count does not match|Integrity check failed/));

  assert.equal(context.canonicalJson(context.buildBackupPayload()), before, "live data untouched");

  assert.equal(context.restoreFromEnvelope(null).ok, false);
  assert.equal(context.restoreFromEnvelope({}).ok, false);
  assert.equal(context.restoreFromEnvelope({ backupVersion: 1 }).ok, false);
  assert.equal(context.canonicalJson(context.buildBackupPayload()), before, "still untouched");
});

test("an unknown backup version is refused, not guessed at", () => {
  const { context } = richHarness();
  const env = context.buildBackupEnvelope();
  env.backupVersion = 99;
  const result = context.restoreFromEnvelope(env);
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /Unsupported backup version: 99/);
});

test("restore recovers the exact canonical state after total live-state loss", () => {
  const { context, storage, server } = richHarness();
  return Promise.resolve(context.runBackup(true)).then(() => {
    // Canonical comparison over the USER DATA. The only legitimate difference
    // after a restore is the restore_completed notice the restore itself
    // raises, so the goal records are compared exactly and the notification
    // identity state is compared separately below.
    const original = context.canonicalJson(context.buildBackupPayload().goals);
    const originalCount = context.goals.length;
    const originalEmitted = context.canonicalJson(context.notificationState.emitted);
    const envelope = server.backups[0].envelope;

    // Simulate losing the live browser state entirely.
    const wiped = createHarness([], { server });
    assert.equal(wiped.context.goals.length, 0, "live state is gone");

    const result = wiped.context.restoreFromEnvelope(envelope);
    assert.equal(result.ok, true, JSON.stringify(result.errors || []));
    assert.equal(wiped.context.goals.length, originalCount);
    assert.equal(wiped.context.canonicalJson(wiped.context.buildBackupPayload().goals), original,
      "every goal record is byte-identical to the original canonical data");

    const restoredEmitted = JSON.parse(wiped.context.canonicalJson(wiped.context.notificationState.emitted));
    JSON.parse(originalEmitted) && Object.keys(JSON.parse(originalEmitted)).forEach((k) => {
      assert.ok(Object.prototype.hasOwnProperty.call(restoredEmitted, k),
        "emitted-event key " + k + " must survive so old alerts cannot replay");
    });
  });
});

test("restore brings back Victory evidence, lineage, reflections and legacy data", () => {
  const { context, server } = richHarness();
  return Promise.resolve(context.runBackup(true)).then(() => {
    const envelope = server.backups[0].envelope;
    const wiped = createHarness([], { server });
    assert.equal(wiped.context.restoreFromEnvelope(envelope).ok, true);
    const c = wiped.context;

    const won = c.goals.find((g) => g.id === "won1");
    assert.equal(won.title, "A completed goal");
    assert.ok(won.achievedAt > 0, "completion date restored");
    assert.equal(won.reflectionStatus, "complete");
    assert.equal(won.reflection.answers.learned, "Direct messages convert best", "main reflection restored");
    assert.ok(won.victorySnapshot, "victory snapshot restored");
    assert.equal(won.smallGoals[0].reflection.answers.worked, "Blocking the whole morning for it",
      "small goal reflection restored");
    assert.equal(won.smallGoals[0].what, "Ship the first version");
    assert.equal(won.smallGoals[0].estimateMinutes, 120);
    assert.equal(won.skills, "Legacy knowledge notes", "legacy planning data restored");
    assert.equal(won.milestones[0].text, "Legacy milestone");
    assert.equal(c.victoryGoals().length, 1);

    const idea = c.goals.find((g) => g.id === "idea1");
    assert.equal(won.originIdeaId, "idea1", "lineage restored on the goal");
    assert.equal(idea.convertedGoalId, "won1", "and on the idea");
    assert.equal(idea.brainstorm, "My grandmother speaks it");
    assert.equal(idea.roughEffortMinutes, 12000, "research metadata restored");
    assert.equal(idea.researchCompletedAt, 1750100000000);

    const missed = c.goals.find((g) => g.id === "missed1");
    assert.equal(missed.outcome, "missed");
    assert.equal(missed.reflectionStatus, "complete");
    assert.equal(c.missedReflectedGoals().length, 1);
    assert.equal(c.victoryStats().mainVictories, 1, "missed never counts as a victory");
  });
});

test("a pre-restore safety copy of the current state is taken", () => {
  const { context, storage, server } = richHarness();
  return Promise.resolve(context.runBackup(true)).then(() => {
    const envelope = server.backups[0].envelope;
    context.goals.push(context.normalize({ id: "later", title: "Added after the backup", goalType: "active" }));
    context.save();
    const beforeRestore = context.canonicalJson(context.buildBackupPayload());

    assert.equal(context.restoreFromEnvelope(envelope).ok, true);
    // N-6: safety copies are now a bounded, versioned list (newest first) so a
    // second restore cannot destroy the only way back.
    const safety = context.readRestoreSafetyCopy();
    assert.ok(Array.isArray(JSON.parse(storage["achieve.restore.safety.v1"])), "stored as a list");
    assert.ok(safety && safety.payload, "safety copy exists");
    assert.equal(context.canonicalJson(safety.payload), beforeRestore, "and holds exactly the pre-restore state");
    assert.equal(context.validateBackupEnvelope(safety).ok, true, "the safety copy is itself valid and restorable");
  });
});

test("restoring an older backup returns exactly that older state", () => {
  const { context, server } = createHarness([{ id: "g", title: "Version one", goalType: "active", status: "active" }]);
  return Promise.resolve(context.runBackup(true))
    .then(() => { context.goals[0].title = "Version two"; context.save(); return context.runBackup(true); })
    .then(() => { context.goals[0].title = "Version three"; context.save(); return context.runBackup(true); })
    .then(() => {
      assert.equal(server.backups.length, 3);
      const oldest = server.backups[2].envelope;
      assert.equal(context.restoreFromEnvelope(oldest).ok, true);
      assert.equal(context.goals[0].title, "Version one", "the chosen older state came back exactly");

      const newest = server.backups[0].envelope;
      assert.equal(context.restoreFromEnvelope(newest).ok, true);
      assert.equal(context.goals[0].title, "Version three", "and the latest can be restored again");
    });
});

/* ================================================================== */
/* Restore + notification interaction                                 */
/* ================================================================== */

test("restoring a backup does not replay old notifications as new", () => {
  const { context, server } = createHarness([futureGoal({ deadline: dateOffset(10) })]);
  assert.equal(context.notificationState.items.length, 1, "reminder already emitted");
  return Promise.resolve(context.runBackup(true)).then(() => {
    const envelope = server.backups[0].envelope;
    const wiped = createHarness([], { server });
    assert.equal(wiped.context.restoreFromEnvelope(envelope).ok, true);

    // The reminder is restored as history, and re-evaluating must not re-emit.
    const reminders = () => wiped.context.notificationState.items.filter((n) => n.type === "future_activation_window");
    assert.equal(reminders().length, 1, "restored, not duplicated");
    wiped.context.evaluateNotifications(Date.now());
    wiped.context.evaluateNotifications(Date.now());
    assert.equal(reminders().length, 1, "no notification storm after restore");
  });
});

test("restore emits its own completion notice exactly once", () => {
  const { context, server } = createHarness([{ id: "g", title: "A goal", goalType: "active", status: "active" }]);
  return Promise.resolve(context.runBackup(true)).then(() => {
    const envelope = server.backups[0].envelope;
    context.restoreFromEnvelope(envelope);
    context.restoreFromEnvelope(envelope);
    const notices = context.notificationState.items.filter((n) => n.type === "restore_completed");
    assert.equal(notices.length, 1, "restoring the same backup twice notifies once");
  });
});


/* ================================================================== */
/* Adversarial: losing live state must not destroy the backups        */
/* ================================================================== */

test("an automatic backup refuses to capture a collapsed state", () => {
  const { context, server, storage } = richHarness();
  return Promise.resolve(context.runBackup(true)).then(() => {
    const goodCount = server.backups[0].envelope.recordCount;
    assert.ok(goodCount >= 6, "a healthy backup exists");

    // Live state is lost; the app reloads holding almost nothing.
    // NOTE: no backup metadata is carried over. Losing localStorage destroys
    // the client-side guard, so the server must refuse this on its own.
    const wiped = createHarness([{ id: "only", title: "One stray record", goalType: "active", status: "active" }], { server });

    return Promise.resolve(wiped.context.runBackup()).then((r) => {
      assert.equal(r.ok, false);
      assert.equal(r.blocked, "suspicious-shrink");
      assert.equal(server.backups[0].envelope.recordCount, goodCount, "the good backup is still newest");
      assert.equal(server.backups[0].envelope.recordCount, goodCount, "the good backup is still newest");
    });
  });
});

test("an empty state never overwrites a healthy backup automatically", () => {
  const { context, server, storage } = richHarness();
  return Promise.resolve(context.runBackup(true)).then(() => {
    const before = server.backups.length;
    const wiped = createHarness([], { server });   // metadata gone too
    return Promise.resolve(wiped.context.runBackup()).then((r) => {
      assert.equal(r.blocked, "suspicious-shrink");
      assert.equal(server.backups.length, before, "no new backup was written at all");
    });
  });
});

test("a deliberate forced backup is still allowed after a shrink", () => {
  const { context, server, storage } = richHarness();
  return Promise.resolve(context.runBackup(true)).then(() => {
    const wiped = createHarness([{ id: "only", title: "One stray record", goalType: "active", status: "active" }], { server });
    return Promise.resolve(wiped.context.runBackup(true)).then((r) => {
      assert.equal(r.ok, true, "the operator can still force it deliberately");
      assert.equal(server.backups[0].envelope.recordCount, 1);
    });
  });
});

test("normal growth and small edits are never mistaken for a collapse", () => {
  const { context, server } = richHarness();
  return Promise.resolve(context.runBackup(true)).then(() => {
    context.goals[0].brainstorm = "An edit";
    context.save();
    return context.runBackup();
  }).then((r) => {
    assert.equal(r.ok, true, "an ordinary edit still backs up");
    assert.equal(r.blocked, undefined);
  });
});

/* ================================================================== */
/* Carried-forward safeguards                                         */
/* ================================================================== */

test("reopening a Victory leaves the frozen evidence intact and it survives backup", () => {
  const { context, server } = richHarness();
  const snapshotBefore = JSON.stringify(context.goals.find((g) => g.id === "won1").victorySnapshot);
  context.reopenGoal("won1");
  const won = context.goals.find((g) => g.id === "won1");
  assert.equal(JSON.stringify(won.victorySnapshot), snapshotBefore, "evidence not rewritten by reopen");
  assert.ok(won.reflection.submittedAt > 0, "reflection kept");

  return Promise.resolve(context.runBackup(true)).then(() => {
    const restored = createHarness([], { server });
    restored.context.restoreFromEnvelope(server.backups[0].envelope);
    const after = restored.context.goals.find((g) => g.id === "won1");
    assert.equal(JSON.stringify(after.victorySnapshot), snapshotBefore, "and survives a backup/restore cycle");
  });
});

test("legacy milestones never count as Small Goal victories, before or after restore", () => {
  const { context, server } = richHarness();
  const before = context.victoryStats();
  assert.equal(before.smallVictories, 1, "only the real small goal completion counts");

  return Promise.resolve(context.runBackup(true)).then(() => {
    const restored = createHarness([], { server });
    restored.context.restoreFromEnvelope(server.backups[0].envelope);
    const after = restored.context.victoryStats();
    assert.deepEqual(JSON.parse(JSON.stringify(after)), JSON.parse(JSON.stringify(before)),
      "statistics are identical after restore");
    const won = restored.context.goals.find((g) => g.id === "won1");
    assert.equal(won.milestones.length, 1, "legacy milestone preserved as history");
  });
});

test("an Idea never becomes a goal, a victory, or a notification target", () => {
  const { context } = createHarness([
    { id: "i", title: "An idea", recordKind: "idea", ideaStatus: "idea", deadline: dateOffset(3) },
  ]);
  assert.equal(context.notificationState.items.length, 0);
  assert.equal(context.victoryGoals().length, 0);
  assert.equal(context.needsReflectionGoals().length, 0);
  assert.equal(context.evaluateNotifications(Date.now()), 0);
});

test("determinism guards still hold with Demo 4 present", () => {
  const script = extractScript();
  const start = script.indexOf("function normalize(g, idState)");
  const end = script.indexOf("function normalizeGoals(");
  assert.doesNotMatch(script.slice(start, end), /Date\.now\(\)/, "no unstable timestamp inside normalize");

  const { context } = createHarness([]);
  const raw = [{ id: "g", title: "A goal", goalType: "active", status: "active" }];
  const first = JSON.stringify(context.normalizeGoals(raw));
  for (let i = 0; i < 50; i += 1) {
    assert.equal(JSON.stringify(context.normalizeGoals(raw)), first, `repetition ${i} diverged`);
  }
});
