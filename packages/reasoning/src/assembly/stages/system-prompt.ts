import type { AssemblyCtx } from "../project.js";
import { pushStage } from "../trace.js";
import { buildEnvironmentContext, buildToolReference } from "../../context/context-engine.js";
import type { ToolSchema } from "../../kernel/capabilities/attend/tool-formatting.js";

/**
 * Assemble the system prompt: Environment block + persona + tool reference + goal
 * (+ remaining steps).
 *
 * Two blocks are ported from legacy `buildStaticContext` (which curate() supplied and
 * the RA_ASSEMBLY flip dropped when project() became default):
 *  - Environment (date/time/timezone/platform) — ALWAYS injected; without it agents
 *    hallucinate stale dates on date-sensitive tasks.
 *  - Tool reference — the tier-adaptive in-prompt tool disclosure (names-only / compact /
 *    full, with a "Required tools (call these)" grouping for local). Native FC passes
 *    tools via the FC `tools` field, but weak-FC local models benefit from seeing them
 *    in-prompt too (belt-and-suspenders for the small-model-uplift mission). Ported into
 *    the canonical core so every project() caller reproduces the contract.
 */
export const systemPromptStage = (c: AssemblyCtx): AssemblyCtx => {
  const goal = c.log.byKind("goal").at(-1)?.text ?? "";
  const remaining = c.log.byKind("goal_state").at(-1)?.remaining ?? [];
  const parts = [buildEnvironmentContext(c.persona.environmentContext)];
  if (c.persona.system) parts.push(c.persona.system);
  // schemas arrive as unknown[] — normalize at this boundary before handing to the
  // typed tool formatters (which assume name:string + parameters:array). Coerce a
  // missing/non-array `parameters` to [] so minimal schemas can't crash the stage.
  const schemas = (c.tools.schemas as Array<Record<string, unknown>>)
    .filter((s) => s && typeof s.name === "string")
    .map((s) => ({ ...s, parameters: Array.isArray(s.parameters) ? s.parameters : [] })) as readonly ToolSchema[];
  parts.push(
    buildToolReference(goal, schemas, c.tools.requiredTools, c.tools.detail, c.capability.tier),
  );
  if (goal) parts.push(`\nGoal: ${goal}`);
  if (remaining.length) parts.push(`Remaining steps: ${remaining.join(", ")}`);
  const systemPrompt = parts.join("\n");
  return { ...c, systemPrompt, trace: pushStage(c.trace, "systemPrompt", `env+tools+goal+${remaining.length} remaining`) };
};
