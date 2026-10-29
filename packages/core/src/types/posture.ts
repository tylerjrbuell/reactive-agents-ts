/**
 * The posture a run is executed under.
 *
 * - `"execute"` (default; also the meaning of an absent posture) — the agent
 *   may use its full tool surface and work toward the task.
 * - `"plan"` — plan-only: the harness limits the run to planning tools and
 *   derives its guidance from the posture. Carried on the run envelope as
 *   `rails.posture`; absent === `"execute"` (request bytes unchanged).
 */
export type RunPosture = "execute" | "plan";
