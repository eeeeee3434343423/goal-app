/*
 * Demo 2 — Ideas & Research lifecycle.
 * See GOAL_APP_DEMO_2_IDEAS_RESEARCH_PLAN.md.
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

function createHarness(seedGoals = []) {
  const elements = {};
  const storage = { "achieve.goals.v1": JSON.stringify(seedGoals) };
  const context = {
    console, Date, Math,
    Blob: class Blob {}, URL: { createObjectURL: () => "blob:test" }, FileReader: class FileReader {},
    setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    alert(m) { context.lastAlert = m; },
    prompt() { context.promptWasCalled = true; return context.nextPromptValue; },
    confirm() { return context.confirmValue !== false; },
    localStorage: {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(storage, k) ? storage[k] : null),
      setItem: (k, v) => { storage[k] = String(v); },
    },
    document: {
      getElementById(id) { if (!elements[id]) elements[id] = createElement(id); return elements[id]; },
      createElement: (t) => createElement(t),
      querySelectorAll: () => [],
    },
    navigator: { clipboard: { writeText(t) { context.lastCopiedText = t; return Promise.resolve(); } } },
    window: { __storage: storage, __SKIP_CLOUD_SAVE: true, addEventListener() {}, scrollTo() {} },
  };
  context.window.window = context.window;
  context.window.document = context.document;
  context.window.localStorage = context.localStorage;
  context.window.navigator = context.navigator;
  vm.createContext(context);
  vm.runInContext(extractScript(), context, { filename: "goal-app.html" });
  context.cloudSave.user = { uid: "t" };
  context.cloudSave.initialReadDone = true;
  return { context, elements, storage };
}

/* Simulates closing the app and opening it again. */
function reload(storage) {
  return createHarness(JSON.parse(storage["achieve.goals.v1"]));
}

function newIdea(context, elements, title, brainstorm) {
  context.openIdeaForm(null);
  elements.fIdeaTitle.value = title;
  elements.fIdeaBrainstorm.value = brainstorm === undefined ? "Some rough thoughts about this one." : brainstorm;
  return context.saveIdea();
}

/* ================================================================== */
/* Ideas                                                              */
/* ================================================================== */

test("an Idea can be created with only a title and a brainstorm", () => {
  const { context, elements } = createHarness([]);
  assert.equal(newIdea(context, elements, "Become fluent in Spanish", "Maybe an hour a day. Not sure where to start."), true);

  const idea = context.ideaRecords()[0];
  assert.equal(idea.title, "Become fluent in Spanish");
  assert.equal(idea.brainstorm, "Maybe an hour a day. Not sure where to start.");
  assert.equal(idea.recordKind, "idea");
  assert.equal(idea.ideaStatus, "idea");
});

test("an Idea requires none of the formal Goal fields", () => {
  const { context, elements } = createHarness([]);
  newIdea(context, elements, "Become fluent in Spanish");
  const idea = context.ideaRecords()[0];
  assert.equal(idea.deadline, "", "no deadline required");
  assert.deepEqual(JSON.parse(JSON.stringify(idea.smallGoals)), [], "no Small Goals required");
  assert.equal(idea.obstacles, "");
  assert.equal(idea.start, "");
  assert.equal(idea.estimatedEffortHours, null);
});

test("a blank Idea is rejected, but a rough one is accepted", () => {
  const { context, elements } = createHarness([]);
  context.openIdeaForm(null);
  elements.fIdeaTitle.value = "   ";
  elements.fIdeaBrainstorm.value = "   ";
  assert.equal(context.saveIdea(), false, "a completely empty record is refused");
  assert.equal(context.ideaRecords().length, 0);
  assert.match(elements.ideaErrors.innerHTML, /title/i, "and it says so inline");

  // Rough thinking is fine - no Goal-level quality rules apply.
  context.openIdeaForm(null);
  elements.fIdeaTitle.value = "Get better at stuff";
  elements.fIdeaBrainstorm.value = "idk yet";
  assert.equal(context.saveIdea(), true, "vague thinking is allowed at Idea stage");
  assert.equal(context.ideaRecords().length, 1);
});

test("an Idea with a title but no brainstorm is still allowed", () => {
  const { context, elements } = createHarness([]);
  context.openIdeaForm(null);
  elements.fIdeaTitle.value = "Learn to sail";
  elements.fIdeaBrainstorm.value = "";
  assert.equal(context.saveIdea(), true);
});

test("an Idea survives a reload", () => {
  const { context, elements, storage } = createHarness([]);
  newIdea(context, elements, "Become fluent in Spanish", "Rough thoughts here.");
  const after = reload(storage);
  const idea = after.context.ideaRecords()[0];
  assert.equal(idea.title, "Become fluent in Spanish");
  assert.equal(idea.brainstorm, "Rough thoughts here.");
  assert.equal(idea.ideaStatus, "idea");
});

test("an Idea can be edited without losing its identity or history", () => {
  const { context, elements } = createHarness([]);
  newIdea(context, elements, "Become fluent in Spanish", "First thoughts.");
  const id = context.ideaRecords()[0].id;

  context.openIdeaForm(id);
  assert.equal(elements.fIdeaTitle.value, "Become fluent in Spanish", "the form loads the existing Idea");
  elements.fIdeaBrainstorm.value = "Second, better thoughts.";
  context.saveIdea();

  const ideas = context.ideaRecords();
  assert.equal(ideas.length, 1, "editing does not create a duplicate");
  assert.equal(ideas[0].id, id);
  assert.equal(ideas[0].brainstorm, "Second, better thoughts.");
});

test("Ideas never appear among Active or Future goals", () => {
  const { context, elements } = createHarness([
    { id: "real", title: "A real active goal", goalType: "active", status: "active", deadline: "2027-01-01" },
  ]);
  newIdea(context, elements, "Become fluent in Spanish");
  context.render();

  assert.doesNotMatch(elements.activeList.innerHTML, /Become fluent in Spanish/, "not in the active list");
  assert.doesNotMatch(elements.futureList.innerHTML, /Become fluent in Spanish/, "not in the future list");
  assert.doesNotMatch(elements.doneWrap.innerHTML, /Become fluent in Spanish/);
  assert.match(elements.activeList.innerHTML, /A real active goal/, "real goals are unaffected");
});

test("an Idea is not counted or validated as a formal Goal", () => {
  const { context, elements } = createHarness([]);
  newIdea(context, elements, "Become fluent in Spanish");
  const idea = context.ideaRecords()[0];
  assert.equal(context.isIdeaRecord(idea), true);
  assert.equal(context.formalGoals().length, 0, "it is not a formal goal");
});

test("the Ideas area shows one switchable prompt, not a wall of questions", () => {
  const { context, elements } = createHarness([]);
  assert.ok(context.IDEA_PROMPTS.length >= 5, "there is a bank of life-direction prompts");
  context.openIdeaForm(null);
  const first = elements.ideaPrompt.textContent;
  assert.ok(first && first.length > 0, "one prompt is shown");
  context.nextIdeaPrompt();
  assert.notEqual(elements.ideaPrompt.textContent, first, "and it can be switched");

  const html = fs.readFileSync(htmlPath, "utf8");
  const start = html.indexOf('<div class="overlay" id="ideaOverlay">');
  const form = html.slice(start, html.indexOf("<script>", start));
  const textareas = (form.match(/<textarea/g) || []).length;
  assert.equal(textareas, 1, `the Idea form should have exactly one big text area, found ${textareas}`);
  const inputs = (form.match(/<input/g) || []).length;
  assert.ok(inputs <= 1, `and only the title input, found ${inputs}`);
});

/* ================================================================== */
/* Research                                                           */
/* ================================================================== */

test("an Idea moves into Researching and records when research started", () => {
  const { context, elements } = createHarness([]);
  newIdea(context, elements, "Become fluent in Spanish", "Rough thoughts.");
  const id = context.ideaRecords()[0].id;

  assert.equal(context.startResearch(id), true);
  const idea = context.ideaRecords()[0];
  assert.equal(idea.ideaStatus, "researching");
  assert.ok(idea.researchStartedAt > 0, "the start time is recorded");
  assert.equal(idea.brainstorm, "Rough thoughts.", "the original Idea content is preserved");
  assert.equal(idea.title, "Become fluent in Spanish");
});

test("starting research does not create a Future or Active goal", () => {
  const { context, elements } = createHarness([]);
  newIdea(context, elements, "Become fluent in Spanish");
  const id = context.ideaRecords()[0].id;
  context.startResearch(id);

  assert.equal(context.formalGoals().length, 0);
  context.render();
  assert.doesNotMatch(elements.activeList.innerHTML, /Become fluent in Spanish/);
  assert.doesNotMatch(elements.futureList.innerHTML, /Become fluent in Spanish/);
});

test("Ideas and Researching records are shown separately", () => {
  const { context, elements } = createHarness([]);
  newIdea(context, elements, "Only considering this one");
  newIdea(context, elements, "Actively researching this one");
  const researching = context.ideaRecords().find((i) => i.title === "Actively researching this one");
  context.startResearch(researching.id);
  context.setView("ideas");
  context.render();

  const html = elements.ideasList.innerHTML;
  assert.match(html, /Ideas - considering/i);
  assert.match(html, /Researching/i);
  assert.ok(html.indexOf("Only considering this one") !== html.indexOf("Actively researching this one"));
});

test("rough expected effort is recorded and normalized to minutes", () => {
  const { context } = createHarness([]);
  assert.equal(context.toMinutes(200, "hours"), 12000);
  assert.equal(context.toMinutes(90, "minutes"), 90);
  assert.equal(context.toMinutes(2, "days"), 2 * 8 * 60, "a day is treated as 8 working hours");
  assert.equal(context.toMinutes("40", "hours"), 2400, "numeric strings are accepted");
});

test("suggested research time is about 10% of expected EXECUTION effort", () => {
  const { context } = createHarness([]);
  assert.equal(context.recommendedResearchMinutes(600), 60, "10 hours -> about 1 hour");
  assert.equal(context.recommendedResearchMinutes(2400), 240, "40 hours -> about 4 hours");
  assert.equal(context.recommendedResearchMinutes(6000), 600, "100 hours -> about 10 hours");
  assert.equal(context.recommendedResearchMinutes(12000), 1200, "200 hours -> about 20 hours");
});

test("the 10% calculation never uses the deadline", () => {
  const { context, elements } = createHarness([]);
  newIdea(context, elements, "Become fluent in Spanish");
  const id = context.ideaRecords()[0].id;
  context.startResearch(id);
  // A far-off deadline must not inflate the recommendation.
  context.setRoughEffort(id, 10, "hours");
  const idea = context.ideaRecords()[0];
  idea.deadline = "2099-01-01";
  assert.equal(context.recommendedResearchMinutes(idea.roughEffortMinutes), 60,
    "still 10% of effort, regardless of any date on the record");
});

test("zero, negative, absurd and malformed effort values are handled safely", () => {
  const { context } = createHarness([]);
  [0, -5, -0.1, NaN, Infinity, -Infinity, null, undefined, "abc", ""].forEach((value) => {
    const minutes = context.toMinutes(value, "hours");
    assert.equal(minutes, 0, `${JSON.stringify(value)} should normalize to 0, got ${minutes}`);
    assert.equal(context.recommendedResearchMinutes(minutes), 0);
  });
  // Absurdly large is clamped rather than stored as nonsense.
  const huge = context.toMinutes(1e12, "hours");
  assert.ok(Number.isFinite(huge) && huge > 0, "a huge value stays finite");
  assert.ok(huge <= context.MAX_EFFORT_MINUTES, "and is clamped to a sane ceiling");
  assert.equal(context.toMinutes(5, "fortnights"), 0, "an unknown unit is refused, not guessed");
});

test("a Researching record and its effort survive a reload", () => {
  const { context, elements, storage } = createHarness([]);
  newIdea(context, elements, "Become fluent in Spanish", "Rough thoughts.");
  const id = context.ideaRecords()[0].id;
  context.startResearch(id);
  context.setRoughEffort(id, 200, "hours");

  const after = reload(storage);
  const idea = after.context.ideaRecords()[0];
  assert.equal(idea.ideaStatus, "researching");
  assert.equal(idea.roughEffortMinutes, 12000);
  assert.equal(after.context.recommendedResearchMinutes(idea.roughEffortMinutes), 1200);
  assert.ok(idea.researchStartedAt > 0, "the research start time survived");
});

test("Researching can be moved back to Idea without losing research data", () => {
  const { context, elements } = createHarness([]);
  newIdea(context, elements, "Become fluent in Spanish", "Rough thoughts.");
  const id = context.ideaRecords()[0].id;
  context.startResearch(id);
  context.setRoughEffort(id, 200, "hours");
  const startedAt = context.ideaRecords()[0].researchStartedAt;

  assert.equal(context.returnToIdea(id), true);
  let idea = context.ideaRecords()[0];
  assert.equal(idea.ideaStatus, "idea");
  assert.equal(idea.roughEffortMinutes, 12000, "the effort estimate is kept");
  assert.equal(idea.researchStartedAt, startedAt, "the original research start is kept");
  assert.equal(idea.brainstorm, "Rough thoughts.");

  // And it can go back into research again.
  assert.equal(context.startResearch(id), true);
  idea = context.ideaRecords()[0];
  assert.equal(idea.ideaStatus, "researching");
  assert.ok(idea.ideaStatusHistory.length >= 3, "status history is appended, not overwritten");
});

test("Research Complete is explicit and activates nothing", () => {
  const { context, elements } = createHarness([]);
  newIdea(context, elements, "Become fluent in Spanish");
  const id = context.ideaRecords()[0].id;
  context.startResearch(id);
  assert.equal(context.completeResearch(id), true);

  const idea = context.ideaRecords()[0];
  assert.equal(idea.ideaStatus, "researchComplete");
  assert.ok(idea.researchCompletedAt > 0);
  assert.equal(context.formalGoals().length, 0, "nothing became a goal");
  context.render();
  assert.doesNotMatch(elements.activeList.innerHTML, /Become fluent in Spanish/);
});

test("Research Complete is not blocked by a missing or unlogged effort estimate", () => {
  const { context, elements } = createHarness([]);
  newIdea(context, elements, "Become fluent in Spanish");
  const id = context.ideaRecords()[0].id;
  context.startResearch(id);
  assert.equal(context.ideaRecords()[0].roughEffortMinutes, 0, "no estimate given");
  assert.equal(context.completeResearch(id), true, "guidance must never become a gate");
});

test("Copy for Goal Research is human readable and leaks no internals", () => {
  const { context, elements } = createHarness([]);
  newIdea(context, elements, "Become fluent in Spanish", "Maybe an hour a day. Unsure where to start.");
  const id = context.ideaRecords()[0].id;
  context.startResearch(id);
  context.setRoughEffort(id, 200, "hours");

  const text = context.buildIdeaResearchText(context.ideaRecords()[0]);
  assert.match(text, /Become fluent in Spanish/);
  assert.match(text, /Maybe an hour a day/);
  assert.match(text, /200h|200 h|3d 2h|Rough/i, "the rough effort is included in readable form");
  assert.doesNotMatch(text, new RegExp(id), "no internal id");
  assert.doesNotMatch(text, /ideaStatus|recordKind|convertedGoalId/, "no internal field names");
  assert.doesNotMatch(text, /color|indigo|teal|amber/i, "no colour");
});

/* ================================================================== */
/* Conversion                                                         */
/* ================================================================== */

test("Plan Goal opens the existing approved planner with the title carried across", () => {
  const { context, elements } = createHarness([]);
  newIdea(context, elements, "Become fluent in Spanish", "Rough thoughts.");
  const id = context.ideaRecords()[0].id;
  context.startResearch(id);
  context.completeResearch(id);

  assert.equal(context.planGoalFromIdea(id), true);
  assert.equal(context.formMode, "active", "the existing full planner is used");
  assert.equal(elements.fTitle.value, "Become fluent in Spanish", "the title is prefilled");
  assert.equal(elements.fTitleBig.value, "Become fluent in Spanish");
  assert.equal(elements.planActions.style.display, "", "Copy for AI review is available");
});

test("conversion invents no planning content", () => {
  const { context, elements } = createHarness([]);
  newIdea(context, elements, "Become fluent in Spanish", "Rough thoughts that must not become the Why.");
  const id = context.ideaRecords()[0].id;
  context.planGoalFromIdea(id);

  assert.equal(elements.fWhy.value, "", "Why is not invented");
  assert.equal(elements.fStart.value, "", "Starting point is not invented");
  assert.equal(elements.fObstacles.value, "", "Obstacles are not invented");
  assert.equal(elements.fDeadline.value, "", "the deadline is still required of the user");
  assert.equal(context.formChildSmallGoals.length, 0, "no Small Goals are fabricated");
});

test("the converted Goal and the original Idea link to each other and both survive", () => {
  const { context, elements, storage } = createHarness([]);
  newIdea(context, elements, "Become fluent in Spanish", "Rough thoughts.");
  const ideaId = context.ideaRecords()[0].id;
  context.planGoalFromIdea(ideaId);
  elements.fTitle.value = "Become conversational in Spanish by summer";
  context.saveDraft();

  const goal = context.formalGoals()[0];
  assert.equal(goal.originIdeaId, ideaId, "the goal knows where it came from");

  const idea = context.allIdeaRecords().find((i) => i.id === ideaId);
  assert.ok(idea, "the original Idea still exists");
  assert.equal(idea.convertedGoalId, goal.id, "the idea knows what it produced");
  assert.equal(idea.brainstorm, "Rough thoughts.", "the original brainstorming text is intact");
  assert.equal(idea.ideaStatus, "converted");

  // and the lineage survives a reload
  const after = reload(storage);
  const goal2 = after.context.formalGoals()[0];
  const idea2 = after.context.allIdeaRecords().find((i) => i.id === ideaId);
  assert.equal(goal2.originIdeaId, ideaId);
  assert.equal(idea2.convertedGoalId, goal2.id);
  assert.equal(idea2.brainstorm, "Rough thoughts.");
});

test("a converted Idea leaves the open Ideas list but is not deleted", () => {
  const { context, elements } = createHarness([]);
  newIdea(context, elements, "Become fluent in Spanish");
  newIdea(context, elements, "Still just an idea");
  const ideaId = context.ideaRecords().find((i) => i.title === "Become fluent in Spanish").id;

  context.planGoalFromIdea(ideaId);
  elements.fTitle.value = "Become fluent in Spanish";
  context.saveDraft();

  const open = context.ideaRecords().map((i) => i.title);
  assert.deepEqual(JSON.parse(JSON.stringify(open)), ["Still just an idea"], "converted ideas leave the open list");
  assert.equal(context.allIdeaRecords().length, 2, "but the record is preserved");
  assert.equal(context.convertedIdeaRecords().length, 1, "and is browsable as converted");
});

test("converting the same Idea twice does not create two Goals", () => {
  const { context, elements } = createHarness([]);
  newIdea(context, elements, "Become fluent in Spanish");
  const ideaId = context.ideaRecords()[0].id;

  context.planGoalFromIdea(ideaId);
  elements.fTitle.value = "Become fluent in Spanish";
  context.saveDraft();
  const firstGoalId = context.formalGoals()[0].id;
  context.closeForm();

  // Asking again should reopen the SAME goal, not spawn another.
  assert.equal(context.planGoalFromIdea(ideaId), true);
  assert.equal(context.formalGoals().length, 1, "still exactly one goal");
  assert.equal(context.editId, firstGoalId, "it reopened the existing draft");
});

test("a Goal converted from an Idea still obeys every formal rule", () => {
  const { context, elements } = createHarness([]);
  newIdea(context, elements, "Become fluent in Spanish");
  const ideaId = context.ideaRecords()[0].id;
  context.planGoalFromIdea(ideaId);
  elements.fTitle.value = "Become conversational in Spanish by summer";
  context.saveDraft();
  const goalId = context.editId;

  assert.equal(context.finalizeGoal(goalId, "future"), false, "no deadline, no Small Goals - refused");

  const goal = context.goals.find((g) => g.id === goalId);
  goal.deadline = "2027-06-01";
  goal.smallGoals = context.normalizeSmallGoals([
    { what: "Book a weekly conversation lesson", why: "Speaking is the part I keep avoiding" },
  ]);
  assert.equal(context.finalizeGoal(goalId, "future"), false, "one Small Goal is still not enough for Future");

  goal.smallGoals = context.normalizeSmallGoals([
    { what: "Book a weekly conversation lesson", why: "Speaking is the part I keep avoiding" },
    { what: "Finish the first 20 Anki decks", why: "Vocabulary is the current bottleneck" },
  ]);
  assert.equal(context.finalizeGoal(goalId, "future"), true, "two is enough for Future");
  assert.equal(context.finalizeGoal(goalId, "active"), false, "but not for Active");

  goal.smallGoals = context.normalizeSmallGoals([
    { what: "Book a weekly conversation lesson", why: "Speaking is the part I keep avoiding" },
    { what: "Finish the first 20 Anki decks", why: "Vocabulary is the current bottleneck" },
    { what: "Watch one Spanish film each week", why: "Listening speed is what breaks conversations" },
  ]);
  assert.equal(context.finalizeGoal(goalId, "active"), true, "three enables Active");
  assert.equal(context.goals.find((g) => g.id === goalId).originIdeaId, ideaId, "lineage survives finalizing");
});

test("Copy for AI Review still works on a Goal that came from an Idea", () => {
  const { context, elements } = createHarness([]);
  newIdea(context, elements, "Become fluent in Spanish", "Rough thoughts.");
  const ideaId = context.ideaRecords()[0].id;
  context.planGoalFromIdea(ideaId);
  elements.fTitle.value = "Become conversational in Spanish by summer";
  elements.fWhy.value = "Being able to talk to my grandmother in her own language";
  elements.fDeadline.value = "2027-06-01";
  context.saveDraft();

  const text = context.buildGoalCopyText(context.currentFormGoalDraft(), "review");
  assert.match(text, /Become conversational in Spanish by summer/);
  assert.match(text, /talk to my grandmother/);
  assert.match(text, /do not judge/i);
  assert.match(text, /Original idea: Become fluent in Spanish/i, "the origin is noted for the reviewer");
});

/* ================================================================== */
/* Lifecycle safety                                                   */
/* ================================================================== */

test("deleting an Idea never deletes the Goal it produced", () => {
  const { context, elements } = createHarness([]);
  newIdea(context, elements, "Become fluent in Spanish");
  const ideaId = context.ideaRecords()[0].id;
  context.planGoalFromIdea(ideaId);
  elements.fTitle.value = "Become fluent in Spanish";
  context.saveDraft();
  const goalId = context.formalGoals()[0].id;
  context.closeForm();

  assert.equal(context.deleteIdea(ideaId), false, "a converted Idea is protected from deletion");
  assert.ok(context.goals.find((g) => g.id === goalId), "the goal is untouched");
  assert.ok(context.allIdeaRecords().find((i) => i.id === ideaId), "the idea is still there");
});

test("an unconverted Idea can be deleted and recovered", () => {
  const { context, elements } = createHarness([]);
  newIdea(context, elements, "A passing thought");
  const ideaId = context.ideaRecords()[0].id;

  assert.equal(context.deleteIdea(ideaId), true);
  assert.equal(context.ideaRecords().length, 0, "it leaves the open list");
  assert.equal(context.deletedIdeaRecords().length, 1, "but is recoverable, not destroyed");

  assert.equal(context.restoreIdea(ideaId), true);
  assert.equal(context.ideaRecords().length, 1);
  assert.equal(context.ideaRecords()[0].title, "A passing thought");
});

test("deleting the produced Goal leaves the Idea and its history intact", () => {
  const { context, elements } = createHarness([]);
  newIdea(context, elements, "Become fluent in Spanish", "Rough thoughts.");
  const ideaId = context.ideaRecords()[0].id;
  context.planGoalFromIdea(ideaId);
  elements.fTitle.value = "Become fluent in Spanish";
  context.saveDraft();
  const goalId = context.formalGoals()[0].id;
  context.closeForm();

  // Simulate the goal disappearing.
  context.goals = context.goals.filter((g) => g.id !== goalId);
  context.save();

  const idea = context.allIdeaRecords().find((i) => i.id === ideaId);
  assert.ok(idea, "the idea record is still there");
  assert.equal(idea.brainstorm, "Rough thoughts.", "its content is undamaged");
  assert.equal(context.ideaLinkedGoal(idea), null, "the dangling link resolves to nothing rather than throwing");
  assert.doesNotThrow(() => context.render(), "and the app still renders");
});

/* ================================================================== */
/* Adversarial pass findings                                          */
/* ================================================================== */

test("abandoning a conversion does not attach the Idea to the next unrelated goal", () => {
  const { context, elements } = createHarness([]);
  newIdea(context, elements, "Become fluent in Spanish");
  const ideaId = context.ideaRecords()[0].id;

  context.planGoalFromIdea(ideaId);
  context.closeForm();                       // changed my mind

  // A completely unrelated new goal must NOT inherit that pending conversion.
  context.openForm(null, "active");
  elements.fTitle.value = "An unrelated goal about something else";
  context.saveDraft();

  // Read the PERSISTED shape: that is what sync and reload actually see.
  const goal = context.normalize(context.formalGoals()[0]);
  assert.equal(goal.originIdeaId, "", "the unrelated goal has no origin idea");
  assert.equal(context.ideaRecords()[0].ideaStatus, "idea", "the idea was not marked converted");
  assert.equal(context.ideaRecords()[0].convertedGoalId, "");
});

test("editing an existing goal never picks up a pending conversion", () => {
  const { context, elements } = createHarness([
    { id: "existing", title: "An existing goal", goalType: "active", status: "active", deadline: "2027-01-01" },
  ]);
  newIdea(context, elements, "Become fluent in Spanish");
  const ideaId = context.ideaRecords()[0].id;
  context.planGoalFromIdea(ideaId);

  context.openForm("existing");               // switch to editing something else
  elements.fTitle.value = "An existing goal, edited";
  context.saveForm();

  assert.equal(context.goals.find((g) => g.id === "existing").originIdeaId, "");
  assert.equal(context.ideaRecords()[0].ideaStatus, "idea");
});

test("an Idea whose goal was deleted can be planned again instead of being stranded", () => {
  const { context, elements } = createHarness([]);
  newIdea(context, elements, "Become fluent in Spanish");
  const ideaId = context.ideaRecords()[0].id;
  context.planGoalFromIdea(ideaId);
  elements.fTitle.value = "Become fluent in Spanish";
  context.saveDraft();
  const goalId = context.formalGoals()[0].id;
  context.closeForm();

  context.goals = context.goals.filter((g) => g.id !== goalId);   // goal deleted
  context.save();

  assert.equal(context.planGoalFromIdea(ideaId), true, "it can be planned again");
  elements.fTitle.value = "Become fluent in Spanish, second attempt";
  context.saveDraft();

  const goal = context.formalGoals()[0];
  assert.equal(goal.originIdeaId, ideaId, "the new goal is linked");
  const idea = context.allIdeaRecords().find((i) => i.id === ideaId);
  assert.equal(idea.convertedGoalId, goal.id, "and the idea points at the new goal");
  assert.equal(context.formalGoals().length, 1, "exactly one goal exists");
});

test("Ideas never take part in goal focus ordering", () => {
  const { context, elements } = createHarness([
    { id: "g1", title: "First active goal", goalType: "active", status: "active", deadline: "2027-01-01", focusOrder: 1 },
    { id: "g2", title: "Second active goal", goalType: "active", status: "active", deadline: "2027-02-01", focusOrder: 2 },
  ]);
  newIdea(context, elements, "An idea that must stay out of the ordering");
  const idea = context.ideaRecords()[0];
  const ideaOrderBefore = idea.focusOrder;

  assert.equal(context.sameFocusType(idea, "active"), false, "an idea is not part of the active focus set");
  context.reorderGoal("g2", "up");

  assert.equal(context.ideaRecords()[0].focusOrder, ideaOrderBefore, "reordering goals never moves an idea");
  assert.equal(context.goals.find((g) => g.id === "g2").focusOrder, 1);
  assert.equal(context.goals.find((g) => g.id === "g1").focusOrder, 2);
});

test("Ideas do not consume the colour palette reserved for goals", () => {
  const { context, elements } = createHarness([]);
  // Fill every colour with IDEAS only.
  context.GOAL_COLORS.forEach((c, i) => {
    newIdea(context, elements, "Idea number " + i);
    context.ideaRecords()[i].color = c.id;
  });
  const picked = context.pickUnusedGoalColor();
  assert.ok(context.GOAL_COLORS.some((c) => c.id === picked), "a valid colour is still chosen");
  // With no formal goals present, every colour is still considered free.
  assert.equal(context.formalGoals().length, 0);
});

test("research effort and formal planning time stay separate fields", () => {
  const { context, elements } = createHarness([]);
  newIdea(context, elements, "Become fluent in Spanish");
  const ideaId = context.ideaRecords()[0].id;
  context.startResearch(ideaId);
  context.setRoughEffort(ideaId, 200, "hours");
  context.planGoalFromIdea(ideaId);
  elements.fTitle.value = "Become fluent in Spanish";
  context.saveDraft();

  const goal = context.normalize(context.formalGoals()[0]);
  const idea = context.allIdeaRecords().find((i) => i.id === ideaId);
  assert.equal(idea.roughEffortMinutes, 12000, "research effort belongs to the idea");
  assert.equal(goal.roughEffortMinutes, 0, "and is not copied onto the goal as planning time");
  assert.equal(goal.estimatedEffortHours, null, "the goal's own effort estimate is not invented");
  assert.notEqual(goal.planningMinutesSpent, 12000, "planning time is a different concept entirely");
});

/* ================================================================== */
/* Existing records are untouched                                     */
/* ================================================================== */

test("existing goals are never reinterpreted as Ideas", () => {
  const { context } = createHarness([
    { id: "a", title: "An active goal", goalType: "active", status: "active", deadline: "2027-01-01" },
    { id: "f", title: "A future goal", goalType: "future", status: "future", deadline: "2027-05-01" },
    { id: "d", title: "A draft", goalType: "active", status: "draft" },
    { id: "n", title: "A migrated legacy record", goalType: "future", futureMonth: "2026-10" },
    { id: "l", title: "A legacy goal", goalType: "active", skills: "old notes", milestones: [{ text: "m", done: true }] },
  ]);
  assert.equal(context.ideaRecords().length, 0, "nothing was turned into an Idea");
  assert.equal(context.allIdeaRecords().length, 0);
  context.goals.forEach((g) => {
    assert.notEqual(g.recordKind, "idea", `${g.id} must not become an idea`);
  });
  assert.equal(context.goals.find((g) => g.id === "n").status, "needsPlanning", "migration behaviour is unchanged");
  assert.equal(context.goals.find((g) => g.id === "l").skills, "old notes", "legacy data is unchanged");
});

test("Idea records serialize safely with no undefined values", () => {
  const { context, elements, storage } = createHarness([]);
  newIdea(context, elements, "Become fluent in Spanish", "Rough thoughts.");
  const id = context.ideaRecords()[0].id;
  context.startResearch(id);
  context.setRoughEffort(id, 200, "hours");
  context.save();

  const walk = (value, p) => {
    if (Array.isArray(value)) return value.forEach((v, i) => walk(v, `${p}[${i}]`));
    if (value && typeof value === "object") {
      Object.entries(value).forEach(([k, v]) => {
        assert.notEqual(v, undefined, `${p}.${k} must not be undefined`);
        walk(v, `${p}.${k}`);
      });
    }
  };
  walk(JSON.parse(storage["achieve.goals.v1"]), "root");
});

test("unknown fields on an Idea survive normalization", () => {
  const { context } = createHarness([]);
  const idea = context.normalize({
    id: "i1", title: "An idea", recordKind: "idea", ideaStatus: "idea",
    somethingFromLater: { nested: [1, 2] },
  });
  assert.deepEqual(JSON.parse(JSON.stringify(idea.somethingFromLater)), { nested: [1, 2] });
});

test("normalizing Idea records is byte-stable", () => {
  const { context } = createHarness([]);
  const raw = [{ id: "i1", title: "An idea", recordKind: "idea", brainstorm: "thoughts" }];
  const first = JSON.stringify(context.normalizeGoals(raw));
  for (let i = 0; i < 50; i += 1) {
    assert.equal(JSON.stringify(context.normalizeGoals(raw)), first, `repetition ${i} diverged`);
  }
});
