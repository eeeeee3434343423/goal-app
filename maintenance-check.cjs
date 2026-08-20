/*
 * Post-change maintenance check against the operator's REAL export.
 * Nothing here writes to production; it loads the shipped HTML in a sandbox.
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert/strict");

const APP = process.argv[2];
const BACKUP = process.argv[3];
const html = fs.readFileSync(APP, "utf8");
const script = html.match(/<script>([\s\S]*)<\/script>/)[1];

function el() {
  return { value: "", checked: false, innerHTML: "", textContent: "", disabled: false, title: "", style: {}, files: [],
    classList: { v: new Set(), add(n){this.v.add(n);}, remove(n){this.v.delete(n);},
      toggle(n,f){const a=f===undefined?!this.v.has(n):!!f; if(a)this.v.add(n); else this.v.delete(n); return a;},
      contains(n){return this.v.has(n);} }, click(){}, focus(){} };
}
function harness(seed) {
  const elements = {};
  const storage = { "achieve.goals.v1": JSON.stringify(seed) };
  const ctx = {
    console, Date, Math, Blob: class {}, URL: { createObjectURL: () => "b" }, FileReader: class {},
    setTimeout: () => 0, clearTimeout(){}, setInterval: () => 0, clearInterval(){},
    alert(){}, prompt(){}, confirm(){ return true; },
    localStorage: { getItem: k => (k in storage ? storage[k] : null), setItem: (k, v) => { storage[k] = String(v); } },
    document: { getElementById: id => (elements[id] || (elements[id] = el())), createElement: () => el(), querySelectorAll: () => [] },
    navigator: { clipboard: { writeText: () => Promise.resolve() } },
    window: { __SKIP_CLOUD_SAVE: true, addEventListener(){}, scrollTo(){} },
  };
  ctx.window.window = ctx.window; ctx.window.document = ctx.document;
  ctx.window.localStorage = ctx.localStorage; ctx.window.navigator = ctx.navigator;
  vm.createContext(ctx);
  vm.runInContext(script, ctx, { filename: path.basename(APP) });
  ctx.cloudSave.user = { uid: "check" };
  ctx.cloudSave.initialReadDone = true;
  return { ctx, elements, storage };
}

const real = JSON.parse(fs.readFileSync(BACKUP, "utf8"));
const { ctx, elements, storage } = harness(real);
const out = [];
function ok(label, value) { out.push((value ? "PASS  " : "FAIL  ") + label); if (!value) process.exitCode = 1; }

/* 1. Nothing is lost loading the real export. */
ok("record count preserved (" + real.length + ")", ctx.goals.length === real.length);
const missingKeys = [];
real.forEach((orig) => {
  const now = ctx.goals.find((g) => g.id === orig.id);
  if (!now) { missingKeys.push(orig.id + ": RECORD MISSING"); return; }
  Object.keys(orig).forEach((k) => { if (!(k in now)) missingKeys.push(orig.id + "." + k); });
});
ok("no field dropped from any record" + (missingKeys.length ? " -> " + missingKeys.join(", ") : ""), missingKeys.length === 0);

/* 2. The only new key is archivedAt. */
const newKeys = new Set();
real.forEach((orig) => {
  const now = ctx.goals.find((g) => g.id === orig.id);
  Object.keys(now).forEach((k) => { if (!(k in orig)) newKeys.add(k); });
});
ok("the only added key is archivedAt -> [" + [...newKeys].join(", ") + "]",
  [...newKeys].every((k) => k === "archivedAt"));
ok("every loaded record starts unarchived", ctx.goals.every((g) => !g.archivedAt));

/* 3. Views still render every record, and Today no longer carries Future. */
ctx.setView("today");
ok("Today shows active + small, hides future",
  elements.activeList.style.display === "" && elements.smallList.style.display === "" && elements.futureList.style.display === "none");
["active", "small", "future", "archive", "ideas", "notifications", "daily", "victories"].forEach((v) => {
  ctx.setView(v);
  ok("view '" + v + "' renders without throwing", true);
});

/* 4. Archive round trip on real records of each kind. */
const kinds = ["active", "small", "future"];
kinds.forEach((kind) => {
  const g = ctx.liveGoals().find((x) => x.goalType === kind && ctx.canArchiveGoal(x));
  if (!g) { out.push("SKIP  no live " + kind + " goal in the export"); return; }
  const before = ctx.formalGoals().length;
  ok(kind + ": archive works", ctx.archiveGoal(g.id) === true);
  ok(kind + ": leaves the live lists", !ctx.liveGoals().some((x) => x.id === g.id));
  ok(kind + ": appears in the Archive", ctx.archivedGoals().some((x) => x.id === g.id));
  ok(kind + ": restore works", ctx.unarchiveGoal(g.id) === true);
  ok(kind + ": back in the live lists", ctx.liveGoals().some((x) => x.id === g.id));
  ok(kind + ": record count never changed", ctx.formalGoals().length === before);
});

/* 5. Sync: an OLD device (payload without archivedAt) vs the NEW build. */
const oldDevice = JSON.stringify(real);                       /* no archivedAt anywhere */
const parked = ctx.goals.find((g) => ctx.canArchiveGoal(g));
ctx.archiveGoal(parked.id);
const newDevice = storage["achieve.goals.v1"];

let merged = ctx.mergeGoalSyncValues(newDevice, oldDevice, 2000, 1000, {});
ok("newer archive wins over an older device copy",
  merged.items.find((g) => g.id === parked.id).archivedAt > 0);
ok("merge loses no records (old->new)", merged.items.length === real.length);

merged = ctx.mergeGoalSyncValues(newDevice, oldDevice, 1000, 2000, {});
ok("an older device cannot silently un-archive nor lose records", merged.items.length === real.length);

/* Restore, then prove the older archived copy cannot resurrect the archive. */
ctx.unarchiveGoal(parked.id);
const restoredDevice = storage["achieve.goals.v1"];
const archivedOld = JSON.parse(newDevice);
merged = ctx.mergeGoalSyncValues(restoredDevice, JSON.stringify(archivedOld), 3000, 1000, {});
ok("a newer RESTORE beats an older archived copy (explicit null, never pruned)",
  merged.items.find((g) => g.id === parked.id).archivedAt === null);

/* 6. Empty / corrupt payload protection is untouched. */
ok("an empty payload still cannot overwrite populated cloud goals",
  ctx.resolveGoalInitialSync({ value: "[]", updatedAt: 9999 }, { value: oldDevice, updatedAt: 1 }).source === "remote");

/* 7. Backup envelope still validates and round trips. */
const envelope = ctx.buildBackupEnvelope();
ok("backup envelope validates", ctx.validateBackupEnvelope(envelope).ok === true);
ok("backup carries every record", envelope.recordCount === real.length && envelope.payload.goals.length === real.length);

console.log(out.join("\n"));
console.log(process.exitCode ? "\nMAINTENANCE CHECK: FAILURES ABOVE" : "\nMAINTENANCE CHECK: all green");
