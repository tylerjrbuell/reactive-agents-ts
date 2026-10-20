/**
 * Think phase — canonical provider-request assembly seam
 * (`buildThinkProviderRequest`).
 *
 * Moved verbatim from `think.ts` (GH #219 / HS-249 decomposition). Assembles
 * the think-phase ProviderRequest via `project()` (the sole assembly path —
 * Sprint-1 A2) with display-sanitized schema names, per the doc comment
 * below. Re-exported from `think.ts` so existing import paths still resolve.
 */

import { sanitizeToolName } from "../attend/context-utils.js";
import { project, type Projection } from "../../../assembly/project.js";
import { fromKernelState } from "../../../assembly/from-kernel-state.js";
import type { ToolSchema } from "../attend/tool-formatting.js";
import type { ContextProfile } from "../../../context/context-profile.js";
import type { KernelState } from "../../../kernel/state/kernel-state.js";
import type { ResolvedHarness } from "../../../harness-config.js";

/**
 * Assemble the think-phase ProviderRequest via the canonical project() seam.
 *
 * The system-prompt tool reference (buildToolReference / buildRules, rendered
 * inside systemPromptStage) MUST display the SAME sanitized tool name that the
 * native-FC tools array carries. Outbound, the FC array sanitizes canonical MCP
 * names (e.g. `github/list_commits` → `github_list_commits`, see the llmTools
 * map in handleThinking) to satisfy the provider name regex. If the prompt text
 * instead shows the raw slash name, weak models (qwen3:14b BENCH N=5: 0/5
 * emission on the slash name, 5/5 on the underscore) read the slash name, emit a
 * <rationale> citing it, then emit NO native call for the underscore FC name →
 * empty turn → loop to max_iterations. Fix = the prompt shows the sanitized name.
 *
 * Display-only: the canonical `promptSchemas` are mapped to fresh spread copies
 * with sanitized names ONLY for the project() `{ schemas }` arg. The caller still
 * feeds the untouched surface (resolveToolSurface's callable set) to the FC
 * array, and the inbound de-sanitization map is built from the canonical
 * schemas — so FC names and registry lookup are byte-identical to before.
 */
export function buildThinkProviderRequest(
  state: KernelState,
  profile: ContextProfile,
  systemPrompt: string,
  promptSchemas: readonly ToolSchema[],
  task: string,
  /** H1: KernelInput.priorContext — rendered by systemPromptStage (03-F1). */
  priorContext?: string,
  /**
   * The model's real tool-calling dialect (`context.toolCallingDriver.mode`).
   * Native-FC → the in-prompt tool reference is skipped (the FC `tools` array is
   * the interface). Defaults to `"text-parse"` = render, the pre-fix behaviour.
   */
  dialect: "native-fc" | "text-parse" | "none" = "text-parse",
  /** Resolved harness config for this pass (`KernelInput.harness`, Task 3). */
  harness?: ResolvedHarness,
  /**
   * D-2026-07-28-C: KernelInput.remainingGoals — rendered by
   * volatileTailStage's `goal_state` read as "Remaining steps: …".
   */
  remainingGoals?: readonly string[],
): Projection {
  const displaySchemas = promptSchemas.map((ts) => ({
    ...ts,
    name: sanitizeToolName(ts.name),
  }));
  return project(
    fromKernelState(state, profile, { system: systemPrompt }, { schemas: displaySchemas }, task, priorContext, dialect, harness, remainingGoals),
  );
}
