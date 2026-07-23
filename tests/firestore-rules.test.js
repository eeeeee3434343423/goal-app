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
