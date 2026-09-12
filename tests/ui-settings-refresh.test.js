const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const htmlPath = path.join(__dirname, "..", "goal-app.html");

function html() { return fs.readFileSync(htmlPath, "utf8"); }
function extractScript() {
  const match = html().match(/<script>([\s\S]*)<\/script>/);
  assert.ok(match, "goal-app.html should contain one inline script");
  return match[1];
}
function element(id) {
  const attrs = {};
  return {
    id, value: "", checked: false, innerHTML: "", textContent: "", hidden: false,
    disabled: false, style: {}, files: [],
    setAttribute(name, value) { attrs[name] = String(value); },
    getAttribute(name) { return attrs[name] ?? null; },
    removeAttribute(name) { delete attrs[name]; },
    focus() {}, click() {},
    classList: {
      values: new Set(),
      add(n) { this.values.add(n); }, remove(n) { this.values.delete(n); },
      toggle(n, force) { const on = force === undefined ? !this.values.has(n) : !!force; on ? this.values.add(n) : this.values.delete(n); return on; },
      contains(n) { return this.values.has(n); },
    },
  };
}
function harness(seed = [], settingsValue) {
  const elements = {};
  const storage = { "achieve.goals.v1": JSON.stringify(seed) };
  if (settingsValue !== undefined) storage["achieve.settings.v1"] = settingsValue;
  const root = element("root");
  const listeners = {};
  const context = {
    console, Date, Math,
    Blob: class Blob {}, URL: { createObjectURL: () => "blob:test" }, FileReader: class FileReader {},
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    alert() {}, prompt() {}, confirm: () => true,
    localStorage: {
      getItem: (key) => Object.prototype.hasOwnProperty.call(storage, key) ? storage[key] : null,
      setItem: (key, value) => { storage[key] = String(value); },
    },
    document: {
      documentElement: root,
      getElementById(id) { return elements[id] || (elements[id] = element(id)); },
      createElement: (tag) => element(tag),
      querySelectorAll: () => [],
      addEventListener(type, fn) { listeners[type] = fn; },
    },
    navigator: { clipboard: { writeText: () => Promise.resolve() } },
    window: { __SKIP_CLOUD_SAVE: true, addEventListener() {}, scrollTo() {} },
  };
  context.window.window = context.window;
  context.window.document = context.document;
  context.window.localStorage = context.localStorage;
  context.window.navigator = context.navigator;
  vm.createContext(context);
  vm.runInContext(extractScript(), context, { filename: "goal-app.html" });
  context.cloudSave.user = { uid: "test" };
  context.cloudSave.initialReadDone = true;
  return { context, elements, storage, root, listeners };
}

test("Goals and New Goal are accessible menus with the approved choices", () => {
  const source = html();
  assert.match(source, /id="goalsMenuButton"[^>]+aria-haspopup="menu"[^>]+aria-expanded="false"/);
  assert.match(source, /id="goalsMenu"[^>]+role="menu"/);
  for (const id of ["viewActive", "viewSmall", "viewFuture"]) assert.match(source, new RegExp(`id="${id}"[^>]+role="menuitem"`));
  assert.match(source, /id="newGoalMenuButton"[^>]+aria-haspopup="menu"[^>]+aria-expanded="false"/);
  for (const mode of ["active", "small", "future"]) assert.match(source, new RegExp(`selectNewGoalType\\('${mode}'\\)`));
  assert.match(source, /openForm\(null, 'daily'\)/);
  assert.match(source, /openIdeaForm\(null\)/);
});

test("menus support keyboard, outside-click, selection, Escape, and selected-view state", () => {
  const { context, elements, listeners } = harness([]);
  let focused = "";
  const firstItem = element("firstMenuItem");
  const lastItem = element("lastMenuItem");
  firstItem.focus = () => { focused = "first"; };
  lastItem.focus = () => { focused = "last"; };
  elements.goalsMenu.querySelectorAll = () => [firstItem, lastItem];
  elements.goalsMenuButton.focus = () => { focused = "button"; };
  context.handleMenuButtonKey({ key: "ArrowDown", preventDefault() {} }, "goalsMenu");
  assert.equal(elements.goalsMenu.hidden, false);
  assert.equal(elements.goalsMenuButton.getAttribute("aria-expanded"), "true");
  assert.equal(focused, "first");
  context.setMenuOpen("goalsMenu", false);
  context.handleMenuButtonKey({ key: "ArrowUp", preventDefault() {} }, "goalsMenu");
  assert.equal(focused, "last", "ArrowUp opens at the last menu item");
  listeners.click({ target: { closest: () => null } });
  assert.equal(elements.goalsMenu.hidden, true, "a click outside closes the menu");
  context.toggleMenu("goalsMenu");
  context.selectGoalView("future");
  assert.equal(context.currentView, "future");
  assert.equal(elements.goalsMenu.hidden, true);
  assert.equal(focused, "button", "selection returns focus to the menu button");
  assert.equal(elements.viewFuture.getAttribute("aria-current"), "page");
  context.toggleMenu("newGoalMenu");
  context.handleMenuEscape({ key: "Escape" });
  assert.equal(elements.newGoalMenu.hidden, true);
});

test("Settings owns guarded Import and Export and has the placeholder", () => {
  const source = html();
  const header = source.slice(source.indexOf('<div class="hdr-btns">'), source.indexOf('<div class="banner"'));
  const settings = source.slice(source.indexOf('id="settingsList"'), source.indexOf('id="overdueReviewList"'));
  assert.doesNotMatch(header, />Export<|>Import</);
  assert.match(settings, /Procedure &amp; Rules/);
  assert.match(settings, /Coming soon/i);
  assert.match(settings, /if\(canEditOrExportGoals\(\)\)exportGoals\(\)/);
  assert.match(settings, /if\(canEditOrExportGoals\(\)\)importGoals\(this\)/);
  const { context, elements } = harness([]);
  context.setView("settings");
  assert.equal(elements.settingsList.style.display, "");
  assert.equal(elements.activeList.style.display, "none");
  context.cloudSave.ready = true;
  context.cloudSave.startupPending = true;
  context.cloudSave.initialReadDone = false;
  context.authoritativeStateReady = false;
  context.render();
  assert.equal(elements.settingsExport.disabled, true);
  assert.equal(elements.settingsImport.disabled, true);
});

test("theme settings default safely, persist, reload, and support all choices", () => {
  const first = harness([]);
  assert.equal(first.context.appSettings.theme, "blue-orange");
  assert.equal(first.root.getAttribute("data-theme"), "blue-orange");
  for (const theme of ["blue-orange", "blue-white", "orange-red"]) {
    first.context.setTheme(theme);
    assert.equal(JSON.parse(first.storage["achieve.settings.v1"]).theme, theme);
    assert.equal(first.root.getAttribute("data-theme"), theme);
  }
  const reloaded = harness([], first.storage["achieve.settings.v1"]);
  assert.equal(reloaded.context.appSettings.theme, "orange-red");
  const malformed = harness([], "{bad json");
  assert.equal(malformed.context.appSettings.theme, "blue-orange");
  malformed.context.setTheme("not-real");
  assert.equal(malformed.context.appSettings.theme, "blue-orange");
});

test("legacy research Ideas render as ordinary Ideas without mutating their metadata", () => {
  const originals = [
    { id: "r1", recordKind: "idea", title: "Old research", brainstorm: "Keep this", ideaStatus: "researching", researchStartedAt: 123, roughEffortMinutes: 900, customLegacy: { keep: true } },
    { id: "r2", recordKind: "idea", title: "Ready before refresh", ideaStatus: "researchComplete", researchStartedAt: 456, researchCompletedAt: 789 },
  ];
  const { context, elements, storage } = harness(originals);
  const before = storage["achieve.goals.v1"];
  context.setView("ideas");
  const rendered = elements.ideasList.innerHTML;
  assert.match(rendered, /Old research/);
  assert.match(rendered, /Ready before refresh/);
  assert.match(rendered, /planGoalFromIdea\('r1'\)/, "ordinary Ideas can still enter the formal planner");
  assert.doesNotMatch(rendered, /Start research|Research complete|Copy for Goal Research|Suggested research|Estimated effort|Back to idea/);
  assert.equal(storage["achieve.goals.v1"], before, "rendering does not rewrite saved legacy fields");
  assert.equal(context.goals[0].ideaStatus, "researching");
  assert.equal(context.goals[0].roughEffortMinutes, 900);
  assert.deepEqual(JSON.parse(JSON.stringify(context.goals[0].customLegacy)), { keep: true });
});

test("HUD styling includes visible focus and responsive menu behavior", () => {
  const source = html();
  assert.match(source, /linear-gradient\([^;]+var\(--grid\)/s);
  assert.match(source, /button:focus-visible/);
  assert.doesNotMatch(source, /onclick="event\.stopPropagation/);
  assert.match(source, /@media\(max-width:640px\)[\s\S]+\.menu-panel\{position:absolute/);
});

test("Future Goal is the current UI name while the stored future mode is unchanged", () => {
  const source = html();
  const futureFields = source.slice(source.indexOf('id="futureFields"'), source.indexOf('id="smallFields"'));
  assert.doesNotMatch(futureFields, /idea/i);
  const { context, elements } = harness([]);
  context.setFormMode("future");
  assert.equal(context.formMode, "future");
  assert.equal(elements.formTitle.textContent, "New future goal");
  assert.equal(elements.saveButton.textContent, "Save future goal");
  assert.doesNotMatch(elements.formHint.textContent, /idea/i);
  context.setView("future");
  assert.doesNotMatch(elements.futureList.innerHTML, /idea/i);
});
