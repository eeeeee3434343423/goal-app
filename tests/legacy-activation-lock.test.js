const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const htmlPath = path.join(__dirname, "..", "goal-app.html");

function element() {
  return {
    value: "", checked: false, innerHTML: "", textContent: "", style: {}, files: [],
    classList: { add() {}, remove() {}, toggle() { return false; }, contains() { return false; } },
    click() {}, focus() {}, appendChild() {}, removeChild() {},
  };
}

function createHarness(goals) {
  const elements = {};
  const context = {
    console, Date, Math, Blob: class Blob {}, URL: { createObjectURL() { return "blob:test"; } },
    FileReader: class FileReader {}, setTimeout() { return 0; }, clearTimeout() {}, setInterval() { return 0; }, clearInterval() {},
    alert() {}, confirm() { return true; }, prompt() { return null; },
    localStorage: { getItem() { return JSON.stringify(goals); }, setItem() {} },
    navigator: { clipboard: { writeText() { return Promise.resolve(); } } },
    document: { getElementById(id) { return elements[id] || (elements[id] = element()); }, createElement() { return element(); } },
    window: { __SKIP_CLOUD_SAVE: true, addEventListener() {}, scrollTo() {} },
  };
  context.window.window = context.window;
  context.window.document = context.document;
  context.window.localStorage = context.localStorage;
  context.window.navigator = context.navigator;
  vm.createContext(context);
  const html = fs.readFileSync(htmlPath, "utf8");
  const script = html.match(/<script>([\s\S]*)<\/script>/)[1];
  vm.runInContext(script, context, { filename: "goal-app.html" });
  return { context, elements };
}

test("legacy Future activation and legacy form finalization cannot bypass switch-over", () => {
  const { context, elements } = createHarness([
    { id: "legacy", title: "Historical goal", goalType: "future", status: "future", description: "Original content" },
  ]);

  assert.equal(context.activateFutureGoal("legacy"), false);
  assert.equal(context.goals[0].goalType, "future");
  assert.equal(context.finalizeGoal("legacy", "active"), false);
  assert.equal(context.goals[0].goalType, "future");
  assert.match(elements.saveStatus.textContent, /switch-over/);
});

test("only the explicit switch-over capability may activate an unplanned legacy goal", () => {
  const { context } = createHarness([
    { id: "legacy", title: "Historical goal", goalType: "future", status: "future", description: "Original content" },
  ]);

  assert.equal(context.switchOverLegacyGoal("legacy"), true);
  assert.equal(context.goals[0].goalType, "active");
  assert.equal(context.goals[0].status, "active");
});

test("switch-over refuses an unplanned goal while a different goal remains active", () => {
  const { context, elements } = createHarness([
    { id: "active", title: "Current focus", goalType: "active", status: "active" },
    { id: "legacy", title: "Historical goal", goalType: "future", status: "future" },
  ]);

  assert.equal(context.switchOverLegacyGoal("legacy"), false);
  assert.equal(context.goals[1].goalType, "future");
  assert.match(elements.saveStatus.textContent, /Complete 'Current focus' first/);
});
