import type { AssemblyCtx } from "../project.js";
import { pushStage } from "../trace.js";
import { buildEnvironmentContext } from "../../context/context-engine.js";

/**
 * Assemble the system prompt: Environment block + persona + goal (+ remaining steps).
 *
 * The Environment block (date/time/timezone/platform) is ALWAYS injected — it is the
 * temporal grounding that legacy `buildStaticContext` (inside curate()) supplied and
 * without which agents hallucinate stale dates on date-sensitive tasks. When project()
 * became the default assembler (RA_ASSEMBLY flip) this block was dropped; ported here so
 * the canonical core reproduces the contract for every caller (NOT re-injected upstream
 * in think.ts, which would re-create two assembly paths). Custom environmentContext
 * fields ride on `persona.environmentContext` when the caller threads them.
 */
export const systemPromptStage = (c: AssemblyCtx): AssemblyCtx => {
  const goal = c.log.byKind("goal").at(-1)?.text ?? "";
  const remaining = c.log.byKind("goal_state").at(-1)?.remaining ?? [];
  const parts = [buildEnvironmentContext(c.persona.environmentContext)];
  if (c.persona.system) parts.push(c.persona.system);
  if (goal) parts.push(`\nGoal: ${goal}`);
  if (remaining.length) parts.push(`Remaining steps: ${remaining.join(", ")}`);
  const systemPrompt = parts.join("\n");
  return { ...c, systemPrompt, trace: pushStage(c.trace, "systemPrompt", `env+goal+${remaining.length} remaining`) };
};
