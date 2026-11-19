/**
 * Wait for a finished run's final cost before tearing its agent down.
 *
 * The framework publishes `RunCostFinalized` after the background debrief call
 * settles, which is after `run()` resolves. A desk or gateway run that
 * unsubscribes from the agent's bus when `run()` resolves never forwards that
 * event, so its stored cost stays the provisional per-call sum. Teardown waits
 * on `result.totalCost()` (runtime `AgentResult`), which resolves once the event
 * is published and never rejects.
 */

/** Resolves once the run's `RunCostFinalized` was published; at once when `result` has no `totalCost`. */
export function runCostSettled(result: unknown): Promise<void> {
  const totalCost = result !== null && typeof result === "object" ? Reflect.get(result, "totalCost") : undefined;
  if (typeof totalCost !== "function") return Promise.resolve();
  return Promise.resolve()
    .then(() => totalCost.call(result))
    .then(
      () => undefined,
      () => undefined,
    );
}
