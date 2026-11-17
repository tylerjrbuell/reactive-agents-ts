/**
 * Run the active session's saved plan through the framework's plan executor
 * (`POST .../plan/execute` -> `agent.execute(plan, { strategy })`). The reply lands in the thread
 * server side; this reloads the thread and keeps the plan the run ended with (each step's final
 * status). Kept out of `chat-mode-store.ts` (one concern each).
 */
import { get } from "svelte/store";
import { chatStore } from "./chat-store.js";
import { setPlanFor } from "./chat-plan-store.js";
import { toast } from "./toast-store.js";
import { runSessionPlan } from "../plan-api.js";
import type { PlanExecutorName } from "../plan-strategy.js";

/**
 * Run the plan. Resolves `undefined` when the run finished, else the line to show next to the plan
 * (the framework's own reason when it refused the plan, the server's wording otherwise); the same
 * line is toasted.
 */
export async function runPlanInStrategy(strategy: PlanExecutorName | undefined): Promise<string | undefined> {
  const sid = get(chatStore).activeSessionId;
  if (sid === null) return "Open a chat first.";
  const res = await runSessionPlan(sid, strategy);
  if (!res.ok) {
    const line = res.reason ?? res.error;
    toast.error("Could not run the plan", line);
    return line;
  }
  if (res.plan !== null) setPlanFor(sid, res.plan);
  if (!res.success) toast.info("The plan run did not finish", "See the reply in the thread.");
  await chatStore.refreshActive();
  return undefined;
}
