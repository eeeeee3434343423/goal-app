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
