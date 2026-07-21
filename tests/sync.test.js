"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const html = fs.readFileSync(require("node:path").join(__dirname, "..", "goal-app.html"), "utf8");
const start = html.indexOf("function goalPayloadEmpty");
const end = html.indexOf("function setSaveStatus", start);
assert.ok(start >= 0 && end > start, "goal sync helpers must exist");
const context = {};
vm.createContext(context);
vm.runInContext(html.slice(start, end), context);

test("empty phone cannot overwrite populated cloud goals", () => {
  assert.equal(context.resolveGoalInitialSync({ value: "[]", updatedAt: 20 }, { value: "[{\"id\":\"r\"}]", updatedAt: 10 }).source, "remote");
});
test("newer populated value wins", () => {
  assert.equal(context.resolveGoalInitialSync({ value: "[{\"id\":\"l\"}]", updatedAt: 20 }, { value: "[{\"id\":\"r\"}]", updatedAt: 10 }).source, "local");
  assert.equal(context.resolveGoalInitialSync({ value: "[{\"id\":\"l\"}]", updatedAt: 10 }, { value: "[{\"id\":\"r\"}]", updatedAt: 20 }).source, "remote");
});
test("legacy local goals are preserved on first sign-in", () => {
  assert.equal(context.resolveGoalInitialSync({ value: "[{\"id\":\"l\"}]", updatedAt: 0 }, { value: "[{\"id\":\"r\"}]", updatedAt: 20 }).source, "local");
});
