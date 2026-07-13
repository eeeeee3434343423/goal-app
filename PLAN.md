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
