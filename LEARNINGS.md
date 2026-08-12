# Learnings

- Recreated the app from the deployed Netlify HTML because the workspace only had the approved plan. Kept the saved data array-based and normalized old milestone-only exports so existing backups still load.
- Future goals should remain lightweight: title, estimated month/year, and description. Activation carries the description into the active goal's why field so the user does not lose context.
- High-volume small goals need stable item IDs and timestamps. Keep the main goal card bounded to summary/recent items, and manage the full action list in a focused modal so hundreds of day-sized goals do not bloat the page.
- Standalone small goals must stay separate from child small goals: use `goalType: "small"` for one-day top-level wins, while preserving active goals' `smallGoals` manager and victory totals.
- Standalone one-day small goals are separate from child small goals under large goals. Keep them as `goalType: "small"` with lightweight about/target-date fields so quick wins can move into Victories without becoming full active goals.
- When one modal supports multiple goal types, lock the type while editing existing records. Free tab switching during edit can silently clear hidden fields; use explicit actions for conversion flows.
- Timer sessions for standalone small goals must stay separate from `achievedAt`: logging time is effort history, while `Win` is the explicit completion action. Preserve `timerSessions` on every form save path so editing a card does not erase logged work.
- Timer sessions should stay separate from win state. Logging 30 minutes or 1 hour records effort on a standalone small goal, but only the explicit Win action should move it into Victories.
- Firebase cloud save should remain local-first: write localStorage and render before attempting Firestore, and surface cloud failures without blocking the app.
- Demo data should be explicit and confirmation-gated because it replaces the user's current goals through the normal save path.
- Daily repeatable goals should record completion events instead of using `achievedAt`; focus limits should split overflow into visible next sections so limiting today's work never hides or deletes saved goals.
- Page-like tabs should share one view state and one visibility helper. Duplicate `setView` implementations can make tests pass the wrong hidden state while the browser shows a different section.
- Daily repeatable goals work better as their own tracker view: keep completion events removable by ID so mistaken wins can be corrected without touching the daily goal itself.


- Anonymous Firebase identities cannot provide cross-device ownership; Google authentication must establish the shared UID first.
- Goal App and Hub must use the same Firestore document shape (`value`, `updatedAt`, `device`) as well as the same path.
- Legacy local goals lack sync timestamps. Preserve them on first sign-in and upload them rather than silently replacing them.
- Top-level small goals can reuse the shared `milestones` field for progress checkpoints; preserve done states by matching unchanged milestone text during edits.
# 2026-07-23 - Recovery-safe initial sync

- Treat malformed JSON, non-array JSON, and an empty array as empty regardless of its timestamp, so it cannot replace populated cloud goals.
- Make signed-out state explicit in the sync button so an empty local view is not mistaken for confirmed cloud data loss.
# 2026-07-23 - Goal recovery sync

- Merge goal objects by ID with the newer side winning conflicts while preserving fields and records found on only one side.
- Authentication readiness is not enough to permit writes; the initial Firestore read must complete first.
- Persist deliberate deletions as tombstones so shrink protection can distinguish user intent from data loss.

# 2026-07-23 - Per-record recovery

- A nonempty destination collection does not prove migration completion; resume deterministic IDs individually and verify exact ID parity.
- Polling must preserve records with pending local transactions so old cloud payloads cannot temporarily replace an in-flight edit.
- Firestore rules for a shared project must retain the exact known overlays used by Morning Read and Life Systems Tracker.
- Seed requested user records with stable IDs only after authenticated cloud initialization; generic local load paths must remain side-effect free for imports and tests.
- Match requested seeds by normalized title as well as ID so older user-created versions are preserved instead of duplicated or overwritten.
- Dark themes must set foreground colors on the native `button`, input, select, and textarea bases; relying on browser defaults can produce black-on-dark controls even when surrounding text is correct.
- Active-tab selectors need their own foreground assertion because a light-theme color can survive a palette migration and remain unreadable.

# 2026-08-10 - Simpler goal planning without data loss

- Removing old form controls must also remove every DOM read for those controls, while editing keeps normalized legacy and unknown fields through the existing object merge. Standalone small-goal steps can be relabeled in the UI while continuing to use `milestones` so old checklist completion states survive without migration.
- Compatibility preservation must merge unknown keys inside normalized nested objects, not only at the goal's top level. Text-based checklist reconciliation must consume each old match once; otherwise duplicate lines inherit the first item's completion state and stable ID.
- Nested steps under an Active Goal's child Small Goal need their own stable IDs and timestamps, but they must remain progress-neutral. Only the parent child-goal checkbox contributes to Active Goal progress; finishing every nested step must never silently complete it.
- Once child Small Goals gain nested state, the parent Active Goal form must stop reconciling them from a titles-only textarea. Preserve the array unchanged on ordinary edits, manage one child at a time in a bounded view, and use nested Trash/Restore rather than cloud-record deletion because the child is part of its parent record.

# 2026-08-11 - Requested child-step visibility

- When the user asks for child Small Goals and their Steps to appear in Active Goals / All Goals, render that structure directly on the saved Active Goal card. A Manage panel may support editing, but it must not hide the requested primary display.

# 2026-08-11 - Never invent user goals

- Production goal code must never seed, recreate, or migrate example goals into a user's record set. If an earlier build injected known records, identify them by reserved immutable IDs only, move them to recoverable Trash during authenticated v2 startup, and never remove a user goal merely because its title matches an old example.

# 2026-08-11 - Cloud startup must not impersonate parity

- A device cache can be stale or empty even when the cloud record is intact. While the first authenticated cloud read is pending, hide cache-derived goal cards, make the loading state explicit, and surface a retryable failure rather than leaving a misleading `connecting` indicator.
