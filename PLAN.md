# Plan: Nested Steps for Small Goals Inside Active Goals (2026-08-10)

## Refine
Make an Active Goal's `Milestones and small goals` area work as one planning system where every child Small Goal can contain its own checkable steps, while keeping Active Goal progress based only on completed milestones and completed child Small Goals.

## Confirmed Progress Rules
1. A child Small Goal inside an Active Goal may contain any number of steps.
2. Checking a child step does **not** increase the Active Goal's progress.
3. After its steps are finished, the user manually checks the entire child Small Goal complete; only that completion increases Active Goal progress.
4. A standalone top-level Small Goal remains different: its own steps directly calculate that standalone Small Goal's progress.
5. Completing all child steps does not automatically complete the child Small Goal.

## Files to Change
1. `goal-app.html`
   - Extend each child item in an Active Goal's existing `smallGoals` array with a nested `steps` checklist.
   - Keep the existing `milestones` and `smallGoals` storage fields for backward compatibility; this is a nested extension, not a migration or replacement.
   - Present Active Goal milestones and child Small Goals together under the existing `Milestones and small goals` heading.
   - Update the Small Goals manager so adding or editing a child Small Goal provides:
     - Small Goal title.
     - `Steps for this small goal`, one step per line.
     - Checkboxes for the child steps.
     - A separate checkbox for completing the entire child Small Goal.
   - Show child-step completion such as `3/4 steps` without counting those steps in Active Goal progress.
   - Preserve the current standalone Small Goal form and its `milestones`-backed step progress.
   - Preserve Google-auth sync, local-first saving, revisions, suspicious-shrink protection, Trash, recovery history, imports, exports, and unknown fields.

2. `tests/goal-app.test.js`
   - Add dependency-free regression tests for the nested child-step shape, UI, progress rules, edits, duplicate text, and saved-data compatibility.
   - Keep all existing tests green.

3. `LEARNINGS.md`
   - Append the implementation lesson after the feature and production verification are complete.

## Interface and Data Signatures
1. `function normalizeSmallGoalSteps(items, state)`
   - Accepts legacy strings, `{ text, done }`, and new step objects.
   - Returns `Array<{ id: string, text: string, done: boolean, createdAt: number, completedAt: number | null }>` with safe unique IDs.

2. `function normalizeSmallGoals(items)`
   - Extends each child Small Goal to:
   - `{ id, text, done, createdAt, completedAt, steps: Array<SmallGoalStep> }`.
   - Old child Small Goals without `steps` normalize to `steps: []` without changing completion state.

3. `function addSmallGoal(id, text, stepsText)`
   - Adds one child Small Goal and its optional newline-separated steps to the specified Active Goal.

4. `function saveChildSmallGoal(id, smallGoalId, text, stepsText)`
   - Updates one child Small Goal by stable ID.
   - Preserves step IDs and completion states for unchanged step text and consumes duplicate matches once.

5. `function toggleSmallGoalStep(id, smallGoalId, stepId)`
   - Toggles one nested step by stable IDs and persists timestamps.
   - Never changes the child Small Goal's `done` state automatically.

6. `function toggleSmallGoal(id, smallGoalId)`
   - Continues to manually complete or reopen the whole child Small Goal.
   - This is the only nested action that changes the child Small Goal's contribution to Active Goal progress.

7. `function progress(g)`
   - For Active Goals: counts only `g.milestones[].done` and `g.smallGoals[].done`.
   - Ignores `g.smallGoals[].steps[].done`.
   - For standalone Small Goals: continues using that goal's own `milestones` steps.

## Test Cases
1. A legacy Active Goal child Small Goal without steps loads unchanged with `steps: []`.
2. A child Small Goal can be created with the four Khan Academy Algebra 2 example steps.
3. Nested steps render only under their specific child Small Goal and never leak to another child or Active Goal.
4. Checking one nested step persists its ID, completion state, and timestamp.
5. Completing every nested step does not mark the child Small Goal complete and does not change Active Goal progress.
6. Manually completing the entire child Small Goal increases Active Goal progress exactly once.
7. Reopening the child Small Goal reduces Active Goal progress while preserving its nested checked steps.
8. Editing a child Small Goal preserves unchanged nested-step completion states and unknown fields.
9. Duplicate child-step text retains distinct IDs and independent checked states.
10. Malformed nested steps fail closed without deleting the valid sibling steps or child Small Goal.
11. Existing standalone Small Goal step progress remains unchanged.
12. Export/import, cloud merge, reload, offline, stale/concurrent, delete/restore, empty-device, and suspicious-shrink protections remain green.

## Verification
1. Run `node --test tests/*.test.js`.
2. Parse the embedded `goal-app.html` script with `node --check` or `vm.Script`.
3. Adversarially review data preservation, nested ID targeting, progress calculations, duplicate text, accessibility, and mobile layout.
4. Before deployment, verify the existing dated recovery backup still matches its recorded hash.
5. After separate deployment approval, verify the canonical Vercel URL, authenticated `Cloud: v2 ready`, two fresh clients with the same goal IDs/count, nested-step persistence after reload, console/network state, mobile overflow, and rollback commit.

## Stop Point
No implementation code, saved goal data, Git commit, push, or Vercel deployment will change until this plan is approved. Deployment remains a second explicit approval gate after local implementation and verification.

---

# Plan: Permanent Goal Backup and Simpler Goal Steps (2026-08-10)

## Refine
Protect every goal that exists in the signed-in production Goal App before changing the interface, simplify New Goal by removing Steps 9-15, and let each standalone Small Goal contain its own ordered checklist of steps.

## Assumed Product Meaning
1. Current New Goal Steps 9-15 (Evidence log through Recovery protocol) disappear from the create/edit form.
2. Existing values previously saved in those fields remain in storage and survive edits, imports, synchronization, and export; this UI removal must not erase historical data.
3. Current New Goal Steps 7 and 8 become one section named `Milestones and small goals`, retaining both larger checkpoints and concrete next actions for a regular active goal.
4. A standalone Small Goal gets a field labeled `Steps for this small goal`. These items belong only to that Small Goal and use its existing `milestones` checklist internally for backward compatibility.

## Approval-Gated Execution Plan
1. Back up and prove the current production data before implementation.
   - Identify the canonical Vercel production URL and confirm it corresponds to this repository and `origin/master`.
   - Open the production app in the existing signed-in browser session and wait for an authenticated `Cloud: synced` state.
   - Record the visible goal count and IDs/titles from the authenticated cloud-backed state without exposing private goal content in logs beyond what is necessary for verification.
   - Use the app's Export action to create a dated JSON recovery file, then parse it locally and verify it is a nonempty array with unique stable goal IDs.
   - Read the current Firestore v2 records, Trash, and audit/recovery export through the existing authenticated app paths; verify every live goal in the browser/export exists in the cloud record set.
   - Do not perform any migration, cleanup, deletion, or production write if local, export, and cloud counts/IDs disagree. Stop and report the mismatch first.

2. Add tests first in `tests/goal-app.test.js`.
   - Assert Steps 9-15 controls are absent from the New Goal form.
   - Assert editing an old active goal preserves all advanced Step 9-15 fields unchanged even though they are hidden/removed from the form.
   - Assert the regular active-goal form presents one combined `Milestones and small goals` section and saves both lists without losing completion states.
   - Assert a standalone Small Goal saves multiple goal-specific steps, renders them only on that Small Goal, toggles them independently, and preserves completed states on edit.
   - Use the Khan Academy Algebra 2 example as a representative four-step test fixture.
   - Backtest legacy, empty, duplicate, malformed, stale/concurrent, delete/restore, reload, import/export, and offline data paths, including unknown-field preservation.

3. Implement the smallest compatible change in `goal-app.html`.
   - Remove the Step 9-15 form markup and all form reads for those controls.
   - Keep `normalize()`, existing advanced saved fields, and `Object.assign({}, old || {}, g)` compatibility so historical values remain losslessly round-trippable.
   - Replace the separate Step 7 and Step 8 headings with one combined planning heading while retaining `milestones` and `smallGoals` storage fields.
   - Relabel standalone Small Goal `Milestones` as `Steps for this small goal`; continue storing it in that Small Goal's `milestones` field so existing records need no migration.
   - Preserve the storage key `achieve.goals.v1`, stable IDs, Google-auth UID, per-record revisions, suspicious-shrink lockout, 30-day Trash, audit history, local-first saving, and export/import behavior.

4. Review the diff adversarially and repair real issues.
   - Check for accidental data-field deletion, cross-goal step leakage, index/ID toggle mistakes, malformed-import crashes, concurrent overwrite risk, and mobile form regressions.
   - Confirm only `goal-app.html`, `tests/goal-app.test.js`, `PLAN.md`, and the final append to `LEARNINGS.md` are changed.

5. Verify locally before publishing.
   - Run `node --test tests/*.test.js`.
   - Run `node --check` on the extracted browser script and relevant standalone JavaScript files.
   - Exercise create, edit, toggle, export/import, delete/restore, reload, and offline behavior in the browser.

6. Publish only after a separate deployment approval.
   - Commit the reviewed change, push to the repository connected to Vercel, and confirm the intended production deployment SHA.
   - Verify the canonical live URL on desktop and mobile width with no console/network errors.
   - Using the same authenticated account, prove two fresh clients show identical goals and per-small-goal steps after reload.
   - Re-export production data and compare stable live goal IDs against the pre-change backup; confirm no current goal disappeared.
   - Retain the pre-change JSON recovery file and identify the rollback deployment.

7. Append the implementation lesson to `LEARNINGS.md` only after verification.

## Interfaces Kept or Adjusted
1. `function normalize(g)`
   - Keeps all legacy and unknown goal fields while normalizing `milestones` and `smallGoals`.

2. `function saveForm()`
   - No longer reads Step 9-15 controls.
   - Preserves Step 9-15 data already present on an edited goal.
   - Saves standalone Small Goal steps with `syncTextList(old.milestones, value)`.

3. `function toggleMs(id, i)`
   - Continues toggling one step belonging to the specified standalone Small Goal.

4. `function smallCardHtml(g)`
   - Renders the Small Goal's own steps and progress without mixing them with another goal.

## Stop Point
No goal data, implementation code, cloud records, Git history, or Vercel deployment will be changed until this plan is approved. Publishing remains a separate approval gate after local tests and review pass.

## 2026-08-11 clarification - child Small Goal visibility

The combined planning form stays simple for bulk creation, but saved Active Goal cards must visibly render every child Small Goal with its own completion checkbox and its own nested Step checkboxes. Do not hide requested planning detail behind a secondary Manage view when the requested behavior says it must appear in Active Goals / All Goals.

---

# Plan: Future Goals, Small Goals, and Milestone Goals

## Refine
Improve the Achieve goal tracker so large goals can be broken into milestone goals and small action goals, while future goals/ideas live in a lightweight separate section with only basic planning details.

## Files to Change
1. `goal-app.html`
   - Recreate the current deployed static app locally from the Netlify source snapshot.
   - Extend goal data normalization and rendering for:
     - `goalType`: `"active"` or `"future"`
     - `futureMonth`: `"YYYY-MM"` for estimated month/year
     - `smallGoals`: array of small action goals under a large goal
   - Keep existing `milestones` behavior and progress calculation for compatibility with current saved data.
   - Add UI sections:
     - Active goals
     - Future goals / ideas
     - Achieved goals
   - Update the modal so:
     - Active goals keep the full Psychology of Achievement fields.
     - Future goals require only title, estimated month/year, and description/why.
     - Large active goals can include milestone goals and small goals.

2. `tests/goal-app.test.js`
   - Add dependency-free Node tests using built-in `node:test`, `assert`, and `vm`.
   - Test the app logic without a browser by loading the script portion from `goal-app.html` into a minimal DOM/localStorage harness.

3. `LEARNINGS.md`
   - Create or append a short note after implementation describing any mistake, edge case, or compatibility concern found during the work.

## Interface / Function Signatures
In `goal-app.html`:

1. `function normalize(g)`
   - Accepts old and new saved goal shapes.
   - Returns a goal with:
     - `id: string`
     - `title: string`
     - `goalType: "active" | "future"`
     - `futureMonth: string`
     - `description: string`
     - existing fields: `mdp`, `why`, `deadline`, `start`, `obstacles`, `skills`, `milestones`, `createdAt`, `achievedAt`
     - `smallGoals: Array<{ text: string, done: boolean }>`

2. `function progress(g)`
   - Calculates progress from both `milestones` and `smallGoals`.
   - Returns `null` when neither list exists.

3. `function cardHtml(g)`
   - Renders active and achieved goals with milestone/small-goal checklists.
   - Renders future goals as lightweight idea cards with estimate and description.

4. `function toggleSmallGoal(id, i)`
   - Toggles completion of a small action goal.

5. `function activateFutureGoal(id)`
   - Converts a future goal into an active goal without losing title/description.

6. `function openForm(id, mode)`
   - `id: string | null`
   - `mode: "active" | "future" | undefined`
   - Opens the modal in the right mode for creating or editing active/future goals.

## Test Cases
In `tests/goal-app.test.js`:

1. Normalization preserves current exported data that only has `milestones`.
2. Normalization accepts future goals with `futureMonth` and `description`.
3. `progress()` counts both milestone goals and small goals.
4. `toggleSmallGoal()` flips one small goal and persists through `save()`.
5. `activateFutureGoal()` moves a future goal into active state and keeps its description as the active goal's `why`.
6. Export/import compatibility remains array-based and normalized after import.

## Verification Commands
Run after implementation:

1. `node --test tests/goal-app.test.js`
2. `node --check tests/goal-app.test.js`
3. `node --check extracted-goal-app-script.js` or equivalent temporary script extraction check

## Stop Point
No implementation code will be changed until this plan is approved.

---

# Plan Addendum: Scalable Small Goals and Victory Log

## Refine
Improve the current small-goal experience so it can handle hundreds of day-or-less goals without making the main goal card unwieldy, and replace the plain achieved-goals area with a clearer victories/wins section.

## Files to Change
1. `goal-app.html`
   - Keep the existing static single-file app structure.
   - Change small goals from a fully expanded checklist on every active goal card into a compact, scalable section:
     - Show small-goal count and completion count on the goal card.
     - Show only a short recent/next subset by default.
     - Add a focused small-goals manager modal or expanded panel for viewing, adding, editing, completing, and deleting many small goals.
   - Extend small-goal data shape while preserving compatibility:
     - Existing: `{ text: string, done: boolean }`
     - New normalized shape: `{ id: string, text: string, done: boolean, createdAt: number, completedAt: number | null }`
   - Add fast small-goal entry:
     - A single input for adding one small goal at a time.
     - Keep the multiline small-goals field for initial bulk entry if it remains useful.
   - Replace/rename the achieved section as a Victory / Win section:
     - Show achieved goals as wins with completion date.
     - Include completed milestone/small-goal totals.
     - Preserve the existing `achievedAt` field and `reopenGoal(id)` behavior.
   - Do not change the storage key `achieve.goals.v1`.

2. `tests/goal-app.test.js`
   - Add coverage for the new small-goal normalized shape.
   - Add coverage that old small goals without IDs/dates still normalize correctly.
   - Add coverage for adding one small goal without rewriting the whole multiline list.
   - Add coverage for deleting one small goal without affecting other small goals.
   - Add coverage for the Victory / Win section rendering achieved goals with `achievedAt`.

3. `LEARNINGS.md`
   - Append any implementation lesson, especially around preserving old small-goal data and avoiding large DOM renders for hundreds of actions.

## Interface / Function Signatures
In `goal-app.html`:

1. `function normalizeSmallGoals(items)`
   - Returns `Array<{ id: string, text: string, done: boolean, createdAt: number, completedAt: number | null }>`.
   - Accepts strings, old `{ text, done }` objects, and new objects.

2. `function smallGoalSummary(g)`
   - Returns `{ total: number, done: number, open: number }`.

3. `function recentSmallGoals(g, limit)`
   - Returns the limited subset shown on the goal card.

4. `function openSmallGoals(id)`
   - Opens a small-goals manager for one active goal.

5. `function addSmallGoal(id, text)`
   - Adds one small goal without replacing the full list.

6. `function deleteSmallGoal(id, smallGoalId)`
   - Removes one small goal by stable ID.

7. `function toggleSmallGoal(id, smallGoalId)`
   - Toggles by stable small-goal ID instead of list index.

8. `function victoryCardHtml(g)`
   - Renders an achieved goal as a victory/win card.

## Test Cases
In `tests/goal-app.test.js`:

1. Old `smallGoals: ["Do thing"]` normalize into ID-backed small goals.
2. Old `smallGoals: [{ text, done }]` preserve completion status.
3. `addSmallGoal()` appends one goal and preserves existing goals.
4. `deleteSmallGoal()` removes only the selected small goal.
5. `toggleSmallGoal()` toggles by ID and sets/clears `completedAt`.
6. `smallGoalSummary()` returns correct total/done/open counts for hundreds of items.
7. Victory rendering includes achieved goals and excludes active/future goals.

## Verification Commands
Run after implementation:

1. `node --test tests/goal-app.test.js`
2. `node --check tests/goal-app.test.js`
3. Extract and parse the `goal-app.html` browser script with Node.

## Stop Point
No implementation code for this addendum will be changed until this plan is approved.

---

# Plan Addendum: Small Goal Milestones

## Refine
Add milestone checkpoints to top-level Small Goals so each milestone counts as progress toward completing that small goal, similar to a regular active goal.

## Files to Change
1. `goal-app.html`
   - Keep the existing `achieve.goals.v1` saved-data shape compatible.
   - Reuse the existing `milestones: [{ text, done }]` field for `goalType: "small"` instead of introducing a new storage field.
   - Add a milestone textarea to the Small Goal form mode:
     - One milestone per line.
     - Label: `Milestones`
     - Helper text: `progress checkpoints for this small goal`.
   - Update `openForm(id, mode)`:
     - When editing a standalone small goal, fill the new small-goal milestone textarea from `g.milestones`.
   - Update `saveForm()` for `formMode === "small"`:
     - Save milestone lines with `syncTextList(old ? old.milestones : [], smallMilestoneTextarea.value)`.
     - Preserve existing milestone done states when milestone text is unchanged.
     - Preserve existing timer sessions and other small-goal fields.
   - Update `smallCardHtml(g)`:
     - Show a progress bar when the small goal has milestones.
     - Render milestone checkboxes under the small goal card.
     - Toggling milestones should use the existing `toggleMs(id, index)` path.
   - Update `victoryCardHtml(g)` for `goalType === "small"`:
     - Include milestone completion count in the win card, alongside target date and timer time.
   - Keep child small goals under active goals unchanged.

2. `tests/goal-app.test.js`
   - Add `fSmallMilestones` to the DOM harness IDs.
   - Add coverage that `normalize()` preserves milestones on a standalone small goal.
   - Add coverage that a standalone small goal with milestones renders progress and milestone checkboxes.
   - Add coverage that toggling a small-goal milestone updates progress and saved data.
   - Add coverage that editing a standalone small goal preserves existing milestone done states by text.
   - Add coverage that winning a small goal shows milestone count in Victories.

3. `LEARNINGS.md`
   - Append one short lesson if implementation reveals a rule about top-level small-goal milestones.

## Interface / Function Signatures
In `goal-app.html`:

1. `function progress(g)`
   - Existing signature stays the same.
   - For standalone small goals, progress comes from `g.milestones`.

2. `function smallCardHtml(g)`
   - Adds progress and milestone rendering for `goalType: "small"` cards.

3. `function saveForm()`
   - Existing signature stays the same.
   - Small-goal branch reads `document.getElementById("fSmallMilestones").value`.

4. `function toggleMs(id, i)`
   - Existing signature stays the same and should work for small-goal milestones.

## Test Cases
1. A small goal can be saved with three milestones.
2. Completing one milestone shows progress toward that small goal.
3. Editing milestone text preserves done states for unchanged lines.
4. Winning the small goal still moves it to Victories and includes milestone count.
5. Existing small goals without milestones still render normally.

## Verification Commands
1. `node --test tests/goal-app.test.js`
2. `node --check tests/goal-app.test.js`
3. Extract and parse the `goal-app.html` browser script with Node.

## Stop Point
No implementation code for this addendum will be changed until this plan is approved.

---

# Plan Addendum: Daily Goals Page and Completion Tracker

## Refine
Make Daily Goals feel like its own in-app page/tab, and improve daily completion tracking so each completed daily win can be added, reviewed, or removed.

## Files to Change
1. `goal-app.html`
   - Add a simple in-app navigation state:
     - `var currentView = "today";`
     - supported values: `"today"`, `"daily"`, `"future"`, `"victories"` if useful, with daily as the main new page.
   - Add top navigation buttons near the header:
     - `Today`
     - `Daily`
     - optional existing sections can stay on Today if keeping the change small.
   - Add helper signatures:
     - `function setView(view)`
       - Switches the visible section without leaving the HTML file or losing saved state.
     - `function renderTodayView(activeFocus, smallFocus, future)`
       - Shows active focus, small goals, and future ideas.
     - `function renderDailyView(dailyGoals)`
       - Shows only daily repeatable goals and daily tracker controls.
   - Keep the existing `Daily goal` add button, but make it naturally available from the Daily page.
   - Improve each daily goal card:
     - Title and notes.
     - Editable Minimum / Standard / Max fields through the existing edit form.
     - Completion buttons for Minimum, Standard, and Max.
     - A recent completion list below the card.
     - A delete/remove action per completion.
   - Add helper signatures:
     - `function removeDailyCompletion(goalId, completionId)`
       - Removes a single daily completion after confirmation.
     - `function dailyCompletionListHtml(g)`
       - Renders recent completions for one daily goal.
   - Improve daily wins:
     - Daily completions remain visible in Victories as `Daily win`.
     - Removing a completion removes the matching Victory entry.
   - Preserve current saved data compatibility:
     - Keep `goalType: "daily"`.
     - Keep `dailyCompletions: [{ id, date, level, note, completedAt }]`.
     - Do not count daily goals against active or small goal limits.

2. `tests/goal-app.test.js`
   - Add coverage that `setView("daily")` hides Today content and shows Daily content.
   - Add coverage that Daily page cards show recent completions.
   - Add coverage that `removeDailyCompletion(goalId, completionId)` removes only the chosen completion.
   - Add coverage that removing a daily completion also removes its Victory entry.
   - Add coverage that editing daily Minimum / Standard / Max still persists.

3. `LEARNINGS.md`
   - Append one short lesson if this reveals a new rule about daily tracker behavior.

## Test Cases
1. Daily goals have their own page-like view inside the app.
2. Today view still shows active and small goal focus limits.
3. Adding a Minimum / Standard / Max completion updates the daily card and Victories.
4. Removing one completion leaves other completions intact.
5. Daily completion data survives save/load normalization.

## Verification Commands
1. `node --test tests/goal-app.test.js`
2. `node --check tests/goal-app.test.js`
3. Extract and parse the `goal-app.html` browser script with Node.

## Stop Point
No implementation code for this addendum will be changed until this plan is approved.

---

# Plan Addendum: Daily Repeatable Goals and Goal Notes

## Refine
Add a separate Daily Goals section for repeatable habits/routines that do not count as active goals or standalone small goals, and add goal notes with Minimum / Standard / Max variants for daily execution.

## Files to Change
1. `goal-app.html`
   - Keep the existing static single-file app and Firebase/localStorage save behavior.
   - Add a new goal type:
     - `goalType: "daily"`
   - Add a new top-level section:
     - `Daily repeatable goals`
   - Daily goals do not count toward:
     - active-goal focus limit
     - small-goal daily limit
   - Add a header button:
     - `Daily goal`
   - Add daily-goal fields:
     - `title`
     - `description`
     - `dailyMinimum`
     - `dailyStandard`
     - `dailyMax`
     - `notes`
     - `dailyCompletions: Array<{ id: string, date: "YYYY-MM-DD", level: "minimum" | "standard" | "max", note: string, completedAt: number }>`
   - Render daily goals as cards with:
     - title
     - notes/about
     - Minimum / Standard / Max descriptions
     - buttons: `Minimum`, `Standard`, `Max`, `Edit`
   - Completing a daily goal records a daily completion without moving the daily goal out of the section.
   - Victories / wins should clearly distinguish daily completions from one-time wins:
     - Example label: `Daily win`
     - Example title: `Complete Morning Routine - Standard`
   - Preserve existing Active, Small, Future, Demo, Firebase, and export/import behavior.

2. `tests/goal-app.test.js`
   - Add coverage for normalizing `goalType: "daily"`.
   - Add coverage that daily goals render in their own section.
   - Add coverage that daily goals do not count toward active/small focus limits.
   - Add coverage for recording Minimum / Standard / Max daily completions.
   - Add coverage that daily completions render in Victories with a daily-specific label.
   - Add coverage that notes and Minimum / Standard / Max fields survive editing/import/export.

3. `LEARNINGS.md`
   - Append any implementation lesson around separating repeatable daily completions from one-time goal wins.

## Interface / Function Signatures
In `goal-app.html`:

1. `function normalizeGoalType(g)`
   - Returns `"active"`, `"small"`, `"future"`, or `"daily"`.

2. `function normalizeDailyCompletions(items)`
   - Returns normalized daily completion records.

3. `function dailyCardHtml(g)`
   - Renders a repeatable daily goal card.

4. `function completeDailyGoal(id, level)`
   - Adds a daily completion for today's date and selected level.
   - Does not set `achievedAt` and does not remove the daily goal from its section.

5. `function dailyVictoryHtml(completion, goal)`
   - Renders daily completions inside the Victories / wins section with a distinct daily label.

6. Existing `openForm(id, mode)` / `setFormMode(mode)`
   - Supports `mode: "daily"` with only daily fields visible.

## Test Cases
In `tests/goal-app.test.js`:

1. Daily goals normalize with empty `dailyCompletions`.
2. Daily goals render in `Daily repeatable goals`, not Active or Small.
3. Completing a daily goal at `minimum`, `standard`, and `max` records completions.
4. Daily completion appears in Victories as `Daily win`.
5. Daily goal remains repeatable after completion.
6. Daily notes and Minimum / Standard / Max fields persist through save/import/export.
7. Existing Firebase/localStorage, focus-limit, demo, timer, and victory tests still pass.

## Verification Commands
Run after implementation:

1. `node --test tests/goal-app.test.js`
2. `node --check tests/goal-app.test.js`
3. Extract and parse the `goal-app.html` browser script with Node.

## Stop Point
No implementation code for this addendum will be changed until this plan is approved.

---

# Plan Addendum: Focus Limits and Daily Order

## Refine
Prevent goal hopping by limiting what appears in today's focus list and giving users an explicit order for what to do first.

## Default Behavior
Use these defaults unless the user says otherwise:
- Active goals shown today: max `5`
- Standalone small goals shown today: max `20`
- Overflow is not deleted; it is moved into an overflow/next-up section and can be pushed to tomorrow or manually promoted.

## Files to Change
1. `goal-app.html`
   - Keep the existing static single-file app and Firebase/localStorage save behavior.
   - Extend normalized goal data with ordering/scheduling fields:
     - `focusOrder: number`
     - `deferredUntil: "YYYY-MM-DD" | ""`
   - Add focus helpers:
     - Active goals are sorted by Major Definite Purpose first, then `focusOrder`, then created date.
     - Small goals are sorted by target date, then `focusOrder`, then created date.
   - Render active goals as:
     - `Today's active focus` with up to 5 active goals.
     - `Next active goals` for active overflow/deferred goals.
   - Render standalone small goals as:
     - `Today's small goals - 1 day or less` with up to 20 due/available small goals.
     - `Next small goals` for overflow/deferred small goals.
   - Add controls on active and standalone small goal cards:
     - `Up`
     - `Down`
     - `Tomorrow`
     - `Today`
   - Add functions that update focus order and defer dates without losing existing data.
   - Preserve Future Ideas and Victories sections.
   - Preserve export/import compatibility.

2. `tests/goal-app.test.js`
   - Add coverage for normalization of `focusOrder` and `deferredUntil`.
   - Add coverage that only the first 5 active goals render in today's active focus.
   - Add coverage that only the first 20 small goals render in today's small goals.
   - Add coverage that overflow goals render in next-up sections.
   - Add coverage for `deferGoalToTomorrow(id)` and `moveGoalToToday(id)`.
   - Add coverage for moving goals up/down in the order.
   - Keep all existing tests passing.

3. `LEARNINGS.md`
   - Append any implementation lesson about focus limits, priority order, and avoiding hidden data loss.

## Interface / Function Signatures
In `goal-app.html`:

1. `function normalize(g)`
   - Adds `focusOrder` and `deferredUntil` defaults.

2. `function isAvailableToday(g)`
   - Returns true when `deferredUntil` is empty or is today/past.

3. `function splitFocusLists(items, limit)`
   - Returns `{ today: [], next: [] }`.

4. `function reorderGoal(id, direction)`
   - Moves a goal up/down among goals of the same type.

5. `function deferGoalToTomorrow(id)`
   - Sets `deferredUntil` to tomorrow.

6. `function moveGoalToToday(id)`
   - Clears `deferredUntil`.

7. `function focusControlsHtml(g)`
   - Renders `Up`, `Down`, `Tomorrow`, and `Today` controls.

## Test Cases
In `tests/goal-app.test.js`:

1. More than 5 active goals are split into 5 today and the rest next.
2. More than 20 small goals are split into 20 today and the rest next.
3. Deferred goals do not appear in today's focus.
4. `moveGoalToToday()` brings a deferred goal back into today's list.
5. `reorderGoal()` changes displayed order and persists through save.
6. Existing Firebase/localStorage, demo, timer, and victory tests still pass.

## Verification Commands
Run after implementation:

1. `node --test tests/goal-app.test.js`
2. `node --check tests/goal-app.test.js`
3. Extract and parse the `goal-app.html` browser script with Node.

## Stop Point
No implementation code for this addendum will be changed until this plan is approved.

---

# Plan Addendum: In-App Demo Success Example

## Refine
Add a built-in demo example inside the app showing a person who successfully used Achieve, with realistic active goals, small goals, future ideas, timer sessions, and victories.

## Files to Change
1. `goal-app.html`
   - Add a `Load demo` button in the header.
   - Add `function demoGoals()` returning a realistic sample dataset for a person using the app successfully.
   - Add `function loadDemoGoals()` that asks for confirmation before replacing current goals with demo goals.
   - Demo should include:
     - One active Major Definite Purpose with milestones and child small goals.
     - Several standalone one-day small goals with timer sessions.
     - Future ideas.
     - At least one victory/win with completed date and timer history.
   - Save demo data through the existing `save()` path so local/Firebase persistence still works.

2. `tests/goal-app.test.js`
   - Add coverage that `demoGoals()` returns active, small, future, and achieved goals.
   - Add coverage that `loadDemoGoals()` replaces current goals only after confirmation.
   - Add coverage that demo goals normalize and render into the correct sections.

3. `LEARNINGS.md`
   - Append any lesson about keeping demo data explicit and confirmation-gated so it does not overwrite real user data by accident.

## Interface / Function Signatures
In `goal-app.html`:

1. `function demoGoals()`
   - Returns an array of normalized goal objects.

2. `function loadDemoGoals()`
   - Confirms with the user, replaces `goals`, saves, and renders.

## Test Cases
In `tests/goal-app.test.js`:

1. Demo data includes at least one active, small, future, and achieved goal.
2. `loadDemoGoals()` does not replace current goals when `confirm()` returns false.
3. `loadDemoGoals()` replaces and saves when `confirm()` returns true.
4. Demo render places records in Active, Small Goals, Future Ideas, and Victories sections.

## Verification Commands
Run after implementation:

1. `node --test tests/goal-app.test.js`
2. `node --check tests/goal-app.test.js`
3. Extract and parse the `goal-app.html` browser script with Node.

## Stop Point
No implementation code for this addendum will be changed until this plan is approved.

---

# Plan Addendum: Firebase Cloud Save

## Refine
Add Firebase-backed cloud saving so goal data persists beyond one browser/device, while keeping localStorage as a fallback and preserving existing import/export behavior.

## Required User Input Before Implementation
1. Firebase web app config object:
   - `apiKey`
   - `authDomain`
   - `projectId`
   - `appId`
   - plus any other Firebase fields shown in the Firebase console.
2. Confirmation that anonymous sign-in is enabled in Firebase Authentication.
3. Confirmation that Firestore is enabled.

## Files to Change
1. `goal-app.html`
   - Add Firebase SDK imports from Google-hosted Firebase modules.
   - Add a `FIREBASE_CONFIG` placeholder block.
   - Add anonymous authentication.
   - Add Firestore storage for the current anonymous user:
     - Collection: `goalAppUsers`
     - Document ID: Firebase `uid`
     - Data shape: `{ goals: [...], updatedAt: serverTimestamp() }`
   - Replace `load()` / `save()` with a sync-aware flow:
     - Load localStorage immediately for fast startup.
     - If Firebase initializes, sign in anonymously.
     - Load the user document from Firestore.
     - If Firestore has goals, normalize and render them.
     - If Firestore is empty but localStorage has goals, upload local goals.
     - Every save writes to localStorage and then attempts Firestore.
   - Add small status text in the header or banner:
     - `Saved locally`
     - `Cloud saved`
     - `Cloud unavailable`
   - Keep export/import array-based and compatible.
   - Do not remove localStorage fallback.

2. `tests/goal-app.test.js`
   - Keep current offline tests passing.
   - Add tests for fallback save behavior if Firebase is unavailable by stubbing cloud helpers.
   - Add tests that `save()` still updates localStorage before attempting cloud save.
   - Add tests that cloud-loaded goals are normalized.

3. `LEARNINGS.md`
   - Append any implementation lesson around cloud sync and preserving offline fallback.

## Interface / Function Signatures
In `goal-app.html`:

1. `function hasFirebaseConfig()`
   - Returns true only when Firebase config is filled in.

2. `async function initCloudSave()`
   - Initializes Firebase app, anonymous auth, and Firestore if config exists.
   - Leaves the app usable offline if anything fails.

3. `async function loadCloudGoals()`
   - Loads `{ goals }` from Firestore for the signed-in anonymous user.
   - Returns `null` if unavailable or empty.

4. `async function saveCloudGoals()`
   - Writes the current normalized `goals` array to Firestore.
   - Does not block local save/render.

5. `function setSaveStatus(text)`
   - Updates visible save status.

6. Existing `load()` and `save()`
   - Continue supporting localStorage.
   - Delegate cloud sync through the new helpers.

## Firestore Rules Required
Use rules that allow each signed-in anonymous user to read/write only their own document:

```text
match /goalAppUsers/{userId} {
  allow read, write: if request.auth != null && request.auth.uid == userId;
}
```

## Test Cases
In `tests/goal-app.test.js`:

1. `save()` writes to localStorage when Firebase is unavailable.
2. `save()` does not throw if cloud saving fails.
3. Cloud-loaded goal arrays are normalized.
4. Export/import remains array-based.
5. Existing localStorage-only tests still pass.

## Verification Commands
Run after implementation:

1. `node --test tests/goal-app.test.js`
2. `node --check tests/goal-app.test.js`
3. Extract and parse the `goal-app.html` browser script with Node.
4. Manual browser check after Firebase config is supplied:
   - Create a small goal.
   - Refresh page.
   - Confirm it reloads.
   - Open in another browser/device after deployment.
   - Confirm data appears for the same anonymous user only if same browser profile is used; for cross-device persistence, upgrade to email/Google sign-in later.

## Important Note
Anonymous Firebase auth persists per browser profile. It will save across reloads and deployments, but it will not automatically identify the same person across different devices. Cross-device sync requires a real sign-in method such as Google or email/password.

## Stop Point
No implementation code for this addendum will be changed until this plan is approved and the Firebase config is provided.

---

# Plan Addendum: Vercel Root Page Fix

## Refine
Fix the Vercel `404: NOT_FOUND` on the root website URL by adding a root `index.html` entry point for the static app.

## Files to Change
1. `index.html`
   - Add a root page that redirects immediately to `goal-app.html`.
   - Include a plain link fallback to `goal-app.html` for browsers or hosts that do not follow the redirect.
   - Keep `goal-app.html` as the source app file to avoid duplicating the full app.

2. `tests/goal-app.test.js`
   - No change needed unless redirect behavior is tested separately.

## Interface / Behavior
1. Visiting `/` on Vercel should load `index.html`.
2. `index.html` should send users to `/goal-app.html`.
3. Visiting `/goal-app.html` should continue to open the app directly.

## Verification Commands
Run after implementation:

1. `node --test tests/goal-app.test.js`
2. `node --check tests/goal-app.test.js`
3. Confirm `index.html` exists at the repo root.

## Stop Point
No implementation code for this addendum will be changed until this plan is approved.

---

# Plan Addendum: Small Goal Timer Sessions

## Refine
Add timer sessions to standalone one-day small goals so a user can work on the same small goal multiple times with presets like 30 minutes or 1 hour, track total time, and still mark the goal as a win separately.

## Files to Change
1. `goal-app.html`
   - Keep the existing static single-file app and `achieve.goals.v1` storage key.
   - Apply timers only to standalone `goalType: "small"` goals.
   - Add timer session data to each standalone small goal:
     - `timerSessions: Array<{ id: string, minutes: number, startedAt: number, completedAt: number }>`
   - Normalize old small goals without timers to `timerSessions: []`.
   - Add timer controls on standalone small-goal cards:
     - `30 min`
     - `1 h`
     - `Custom`
   - A timer session should log completed time immediately when selected, not require a live countdown in this first version.
   - Show total logged time on each standalone small-goal card.
   - Show total logged time on small-goal victory cards.
   - Keep `Win` separate from time logging.
   - Preserve existing active goals, future ideas, child small-goal manager, import/export, and victories behavior.

2. `tests/goal-app.test.js`
   - Add coverage for timer normalization on old and new small goals.
   - Add coverage for adding 30-minute, 60-minute, and custom timer sessions.
   - Add coverage that multiple timer sessions accumulate total minutes.
   - Add coverage that logging time does not mark the small goal as won.
   - Add coverage that winning a small goal preserves its timer sessions in Victories.
   - Add coverage that active/future goals are unaffected.

3. `LEARNINGS.md`
   - Append any implementation lesson about keeping time sessions separate from win/completion state.

## Interface / Function Signatures
In `goal-app.html`:

1. `function normalizeTimerSessions(items)`
   - Returns `Array<{ id: string, minutes: number, startedAt: number, completedAt: number }>`
   - Drops invalid sessions with non-positive minutes.

2. `function totalTimerMinutes(g)`
   - Returns the sum of `timerSessions[].minutes` for a goal.

3. `function formatMinutes(minutes)`
   - Returns compact display text such as `30 min`, `1 h`, or `1 h 30 min`.

4. `function addTimerSession(id, minutes)`
   - Adds a completed timer session to a standalone small goal.
   - Does not set `achievedAt`.

5. `function addCustomTimerSession(id)`
   - Prompts for minutes, validates a positive integer, then calls `addTimerSession(id, minutes)`.

6. `function timerControlsHtml(g)`
   - Renders timer buttons and total time for standalone small-goal cards.

## Test Cases
In `tests/goal-app.test.js`:

1. `normalize()` gives old standalone small goals `timerSessions: []`.
2. `normalize()` preserves valid existing timer sessions.
3. `addTimerSession(id, 30)` appends a 30-minute session and keeps `achievedAt` null.
4. Multiple sessions accumulate in `totalTimerMinutes()`.
5. Invalid timer values do not create sessions.
6. Winning a standalone small goal keeps its timer session history visible in Victory rendering.

## Verification Commands
Run after implementation:

1. `node --test tests/goal-app.test.js`
2. `node --check tests/goal-app.test.js`
3. Extract and parse the `goal-app.html` browser script with Node.

## Stop Point
No implementation code for this addendum will be changed until this plan is approved.

---

# Plan Addendum: Standalone One-Day Small Goals

## Refine
Add a top-level Small Goals section, similar to Future Ideas, for standalone goals that should take one day or less and only need a short about/description field.

## Files to Change
1. `goal-app.html`
   - Keep the existing static single-file app and `achieve.goals.v1` storage key.
   - Add a new top-level section between Active goals and Future goals:
     - Section label: `Small goals - 1 day or less`
     - Empty state explaining these are quick wins or tasks that should be finishable today or within one day.
   - Add a new header button:
     - `Small goal`
   - Add support for a new goal type:
     - `goalType: "small"`
   - Add lightweight fields for standalone small goals:
     - `title: string`
     - `about: string` or reuse `description: string`
     - `targetDate: "YYYY-MM-DD"` optional, defaulting to today when created from the UI if reasonable
     - `createdAt: number`
     - `achievedAt: number | null`
   - Keep active-goal child `smallGoals` working as-is. Do not merge or remove the existing per-goal small-goal manager.
   - Render standalone small goals as compact cards:
     - Title
     - About text
     - Target date or `Today`
     - `Win` / `Edit` actions
   - When a standalone small goal is won:
     - Set `achievedAt`
     - Move it into the existing Victories / wins section using the same victory rendering path or a small-goal-specific victory card.
   - Update the modal mode system:
     - Existing modes: `active`, `future`
     - New mode: `small`
     - Small-goal mode only shows title, target date, and about fields.

2. `tests/goal-app.test.js`
   - Add coverage for normalizing `goalType: "small"`.
   - Add coverage that small goals render in the standalone Small Goals section, not Active or Future.
   - Add coverage that winning a standalone small goal moves it to Victories / wins.
   - Add coverage that future and active goals remain unaffected.
   - Add coverage that import/export remains array-based and compatible.

3. `LEARNINGS.md`
   - Append any lesson about keeping standalone small goals separate from child small goals under active goals.

## Interface / Function Signatures
In `goal-app.html`:

1. `function normalizeGoalType(g)`
   - Returns `"active"`, `"future"`, or `"small"`.

2. `function normalize(g)`
   - Preserves existing active/future behavior.
   - For `goalType: "small"`, returns lightweight fields:
     - `goalType`
     - `title`
     - `description`
     - `targetDate`
     - `createdAt`
     - `achievedAt`

3. `function smallCardHtml(g)`
   - Renders a standalone one-day small goal card.

4. `function winGoal(id)`
   - Marks active or standalone small goals as achieved.
   - Keeps current `achieveGoal(id)` behavior or delegates to it, as long as existing button behavior is preserved.

5. `function openForm(id, mode)`
   - Supports `mode: "small"` in addition to `active` and `future`.

6. `function setFormMode(mode)`
   - Shows only small-goal fields when `mode === "small"`.

## Test Cases
In `tests/goal-app.test.js`:

1. `normalize()` accepts `{ goalType: "small", title, description, targetDate }`.
2. `render()` places active, small, future, and won goals in separate sections.
3. `winGoal()` or `achieveGoal()` moves a standalone small goal into Victories / wins.
4. Editing a standalone small goal preserves its type and description/about text.
5. Array-based import/export keeps `goalType: "small"` intact.

## Verification Commands
Run after implementation:

1. `node --test tests/goal-app.test.js`
2. `node --check tests/goal-app.test.js`
3. Extract and parse the `goal-app.html` browser script with Node.

## Stop Point
No implementation code for this addendum will be changed until this plan is approved.

---

# Goal App Cross-Device Sync - Staged Replacement

## 2026-08-11 Full Integrity Repair - Approved by user

### Verified causes
1. Startup treats the saved `requested-belgian-malinois`, `requested-get-contacts`, and `requested-paint-room` records as unwanted seeds, attempts to Trash them again, receives `permission-denied` because matching Trash records already exist, and aborts the authenticated read.
2. The same incorrect filter hides those three user-approved records, including the missing Paint Room victory.
3. Known demo records and one exact incident-contaminated Algebra record remain in the cloud projection and appear as if they were current goals.
4. Hub duplicate cleanup failure falls back to rendering raw duplicate app records.

### Files and behavior
1. `goal-app.html`
   - Preserve and display the three `requested-*` saved records; never auto-Trash them.
   - Exclude only exact proven contamination IDs from live projections and legacy migration inputs.
   - Keep every other goal/victory, including Boundaries and Develop a proper notes format.
   - Reach `Cloud: v2 ready` even when old Trash records exist.
2. `tests/goal-app.test.js`
   - Prove approved records survive load/projection.
   - Prove only exact contaminated IDs are excluded.
   - Prove startup does not auto-delete any approved record.
3. Hub files listed in the Hub repository plan.
4. `LEARNINGS.md`
   - Record that requested user records cannot later be reclassified as disposable seeds.

### Production verification
1. Run every existing Goal and Hub test plus embedded-script syntax checks.
2. Verify every inline button handler resolves to a function.
3. Verify authenticated Goal reaches `Cloud: v2 ready` with no console errors.
4. Verify Goal and Hub show the same goal IDs/categories after reload in two fresh clients.
5. Verify add/edit/check/reorder/timer/victory/reopen/delete/restore/import/export and Hub navigation/timer/app/information controls using disposable test records, with cleanup through recoverable Trash.


## 2026-08-11 Incident Repair: Do Not Display Unsynced Goal State

### Refine
Prevent Goal App from presenting an empty or stale device cache as the signed-in account's data while the first authenticated cloud read is still pending or has failed.

### Approved implementation
1. `goal-app.html`
   - Add an explicit cloud-startup state.
   - Replace goal views with a non-editable “Loading your saved cloud goals” state until the authenticated V2 read is complete.
   - Catch initial V2 errors, retain local data, show a clear tap-to-retry status, and never leave the button at `Cloud: connecting...` indefinitely.
   - Retry the initial read when a signed-in user taps the failed sync status; do not sign them out instead.
   - Leave Firestore records, Trash, migrations, and existing goal data untouched.
2. `tests/goal-app.test.js`
   - Add regressions for the startup gate, successful release of the gate, and retryable initial-sync failure.
3. `LEARNINGS.md`
   - Record that visible device cache is not proof of cloud parity.

### Verification
1. `node --test tests/goal-app.test.js`
2. Extract the inline script and run `node --check`.
3. Open the deployed Goal page as the authenticated account, verify it reaches `Cloud: v2 ready`, and compare its visible major-goal titles with Hub before a new deployment.

### Boundaries
No cloud data will be deleted, merged, migrated, or deployed until the code and live authenticated parity checks pass.


## Approved Scope
1. Replace anonymous authentication with Google sign-in.
2. Preserve `achieve.goals.v1` local storage, import/export, and every current goal feature.
3. Store the same serialized value Hub reads at `users/{uid}/appdata/achieve.goals.v1`.
4. Resolve first sync with timestamps and never let empty device data erase populated cloud goals.
5. Show actionable sign-in, local fallback, loading, synced-time, and error states.

## Verification
1. [done] Existing Goal App suite updated and green.
2. [done] New deterministic conflict tests green.
3. [done] Embedded JavaScript syntax check.
4. [pending] Copy to the separate Goal App repository and verify hosted Google sign-in after deployment.

## 2026-07-23 v2 recovery extension

Approved implementation replaces whole-array goal writes with per-record revisioned transactions, recoverable Trash, append-only audit records, resumable legacy migration, abnormal-shrink lockout, and a Git/Vercel preview gate. Legacy documents remain read-only migration and rollback inputs.

## 2026-07-23 Requested Goal Personalization

Approved scope removes demo-loading code and idempotently seeds Belgian Malinois and Get Contacts as future goals plus Paint Room as a victory. Existing title-matched user records always win and are never overwritten. Verification covers exact-once behavior, reloads, and cloud migration.

## 2026-07-23 Dark Theme Contrast

Approved Wakeup palette applied to native controls, inputs, active tabs, placeholders, disabled states, and generated action buttons. The full 87-test suite passes with explicit foreground regressions.

# Approved: visible Major Goal deletion (2026-08-11)

## Requested outcome

Every active Major Goal card, including the Major Definite Purpose, has a visible Delete button. Deletion must require confirmation, remove only the selected goal, sync across signed-in devices, and remain recoverable from 30-day Trash.

## Planned files and interfaces

1. `goal-app.html`
   - Add `deleteGoalById(id) -> Promise<boolean>` as the single deletion path.
   - Keep `deleteGoal() -> Promise<boolean>` as the edit-modal wrapper that calls `deleteGoalById(editId)`.
   - Add a clearly labeled `Delete <goal title>` button directly to each active Major Goal card.
   - On cancellation or cloud/Trash failure, preserve the goal and display the failure; on success, write the tombstone, save, rerender, and close the editor only when applicable.
2. `tests/goal-app.test.js`
   - Prove active Major Goal and MDP cards render the correct direct Delete control.
   - Prove confirmation cancel changes nothing.
   - Prove successful deletion moves the exact v2 record to Trash, records its tombstone, removes only that goal, and survives reload.
   - Prove a cloud failure preserves the goal and reports the error.
   - Re-run the static handler audit so every rendered button references an implemented function.
3. `sync-v2-api.js` and `tests/sync-v2-runtime.test.js`
   - Treat a matching cloud Trash record as a durable deletion marker during legacy migration so a stale second device cannot recreate the deleted Major Goal.
   - Prove migrate, delete, and fresh-device remigration leaves the goal deleted and recoverable.
   - Atomically preserve a durable tombstone in the legacy Goal envelope during the cloud Trash transaction so deletion remains permanent after the 30-day recoverable Trash payload expires.
   - Keep Goal Recovery scoped to Goal Trash and live Goal records so restoring a goal never depends on unrelated Hub-app collection access.
   - Replace JavaScript prompt-based selection with an accessible in-page Recovery dialog containing labeled Restore and Close buttons so the flow works in mobile and embedded browsers.
4. `LEARNINGS.md`
   - Record that destructive actions users need must be visible on the relevant card, while retaining confirmation and recoverability.

## Verification and release

Run the complete Goal suite, syntax and diff checks, then review the diff for accidental multi-goal removal, revision races, inaccessible button labels, and delete-on-cancel behavior. After approval to implement this plan, deploy to the canonical Goal URL and use a disposable Major Goal to verify create, delete, reload, Trash visibility, two authenticated clients, and zero console errors without touching the user's saved goals.
