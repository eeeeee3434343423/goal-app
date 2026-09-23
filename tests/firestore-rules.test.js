"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const rules = fs.readFileSync(path.join(__dirname, "..", "firestore.rules"), "utf8");

test("rules isolate records by authenticated owner", () => {
  assert.match(rules, /request\.auth != null && request\.auth\.uid == uid/);
});

test("rules forbid direct deletion and require monotonic revisions", () => {
  assert.match(rules, /allow delete: if false/);
  assert.match(rules, /request\.resource\.data\.revision == resource\.data\.revision \+ 1/);
});

test("rules allowlist live fields and prohibit arbitrary protected fields", () => {
  assert.match(rules, /hasOnly\(\['id','payload','schemaVersion','revision','createdAt','updatedAt','updatedBy'\]\)/);
});

test("rules narrowly validate the owner focus record", () => {
  assert.match(rules, /function validFocus\(data\)/);
  assert.match(rules, /data\.keys\(\)\.hasOnly\(\['activeGoalId','revision','createdAt','updatedAt','updatedBy'\]\)/);
  assert.match(rules, /match \/users\/\{uid\}\/focus\/active-goal/);
  assert.match(rules, /function focusGoalExistsAfter\(uid, activeGoalId\)/);
  assert.match(rules, /existsAfter\(\/databases\/\$\(database\)\/documents\/users\/\$\(uid\)\/goals\/\$\(activeGoalId\)\)/);
  assert.match(rules, /focusGoalExistsAfter\(uid, request\.resource\.data\.activeGoalId\)/);
  assert.match(rules, /resource\.data\.activeGoalId == null && request\.resource\.data\.activeGoalId is string/);
  assert.match(rules, /function focusClearHasCompletion\(uid, activeGoalId\)/);
  assert.match(rules, /getAfter\(\/databases\/\$\(database\)\/documents\/users\/\$\(uid\)\/goals\/\$\(activeGoalId\)\)/);
  assert.match(rules, /request\.resource\.data\.activeGoalId == null/);
  assert.match(rules, /completedGoal\.data\.payload\.achievedAt != null/);
  assert.match(rules, /completedGoal\.data\.payload\.outcome != null/);
  assert.match(rules, /request\.resource\.data\.revision == resource\.data\.revision \+ 1/);
  assert.match(rules, /allow delete: if false/);
});
