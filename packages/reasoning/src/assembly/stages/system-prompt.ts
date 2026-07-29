import type { AssemblyCtx } from "../project.js";
import { pushStage } from "../trace.js";
import { buildEnvironmentContext, buildToolReference, buildRules } from "../../context/context-engine.js";
import { buildSystemPrompt } from "../../kernel/capabilities/attend/context-utils.js";
import type { ToolSchema, ToolParamSchema } from "../../kernel/capabilities/attend/tool-formatting.js";
import { verboseRulesEnabled } from "../../harness-flags.js";

/**
 * Narrow an unknown schema list to `ToolSchema[]` without `any`. Schemas arrive
 * as `unknown[]` (the AssemblyInput boundary); coerce here before handing them
 * to the typed tool formatters. Entries lacking a string `name` are dropped; a
 * missing/non-array `parameters` becomes `[]` so minimal schemas can't crash the
 * tier-adaptive formatters.
 */
function toToolSchemas(raw: readonly unknown[]): readonly ToolSchema[] {
  const out: ToolSchema[] = [];
  for (const s of raw) {
    if (!s || typeof s !== "object") continue;
    const rec = s as Record<string, unknown>;
    if (typeof rec.name !== "string") continue;
    const parameters: readonly ToolParamSchema[] = Array.isArray(rec.parameters)
      ? (rec.parameters as readonly ToolParamSchema[])
      : [];
    out.push({
      name: rec.name,
      description: typeof rec.description === "string" ? rec.description : "",
      parameters,
    });
  }
  return out;
}

/**
 * Assemble the system prompt: Environment block + persona + tool reference + goal
 * (+ remaining steps + optional RULES).
 *
 * Ported from legacy `buildStaticContext`/`buildSystemPrompt` (which curate()
 * supplied and the RA_ASSEMBLY flip dropped when project() became default):
 *  - Environment (date/time/timezone/platform) — ALWAYS injected; without it
 *    agents hallucinate stale dates on date-sensitive tasks.
 *  - Persona — the custom system prompt when set, else the tier-adaptive default
 *    from `buildSystemPrompt` (carries the "Think step by step" CoT instruction
 *    the reactive contract depends on). project() previously pushed only a custom
 *    prompt, dropping the CoT persona entirely on unset runs.
 *  - Tool reference — the tier-adaptive in-prompt tool disclosure (names-only /
 *    compact / full, with a "Required tools (call these)" grouping for local).
 *    Native FC passes tools via the FC `tools` field, but weak-FC local models
 *    benefit from seeing them in-prompt too (small-model-uplift mission).
 *  - RULES — ported gated by the SAME `RA_LAZY_TOOLS=0` opt-in as legacy
 *    (verbose ReAct guidance; lazy by default).
 */
export const systemPromptStage = (c: AssemblyCtx): AssemblyCtx => {
  const goal = c.log.byKind("goal").at(-1)?.text ?? "";
  const parts = [buildEnvironmentContext(c.persona.environmentContext)];
  const schemas = toToolSchemas(c.tools.schemas);
  // Persona: custom prompt if set, else tier-adaptive default (incl. CoT).
  // F6: pass real tool availability so a zero-tool run does not receive tool
  // doctrine it cannot act on. Schemas are resolved first purely to feed this.
  parts.push(
    buildSystemPrompt(goal, c.persona.system || undefined, c.capability.tier, schemas.length > 0),
  );
  parts.push(
    buildToolReference(goal, schemas, c.tools.requiredTools, c.tools.detail, c.capability.tier),
  );
  if (goal) parts.push(`\nGoal: ${goal}`);
  // F10: the standing frame and `Remaining steps:` used to be pushed here.
  // They change every iteration, and everything in this string is inside
  // Anthropic's cached system block, so emitting them here invalidated the
  // system cache breakpoint (and both breakpoints after it) on every turn —
  // measured cacheRead 0 on the default kernel path. They now render in
  // `volatile-tail.ts`, after the last breakpoint. Do not move them back.
  // Gate: scripts/check-volatile-placement.sh
  if (verboseRulesEnabled()) {
    parts.push(buildRules(schemas, c.tools.requiredTools, c.capability.tier));
  }
  const systemPrompt = parts.join("\n");
  return {
    ...c,
    systemPrompt,
    trace: pushStage(c.trace, "systemPrompt", "env+persona+tools+goal"),
  };
};
