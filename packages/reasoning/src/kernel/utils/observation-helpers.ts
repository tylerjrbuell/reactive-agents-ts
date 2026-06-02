/**
 * observation-helpers.ts — Pure observation helpers extracted from
 * act/tool-execution.ts in WS-3 Phase 3 (cycle 2 closure).
 *
 * `makeObservationResult` is a pure, deterministic builder for ObservationResult
 * values. It has no Effect/LLMService/kernel-state coupling, so it belongs in
 * `kernel/utils/` (substrate) rather than the Act capability. Living here lets
 * Reason capability (think.ts, think-guards.ts) construct observations without
 * importing Act, eliminating the reason → act cross-capability edge.
 *
 * Same extraction pattern as Phase 1's `tool-parsing.ts`.
 */
import type { ObservationResult } from "../../types/observation.js";
import {
  categorizeToolName,
  deriveResultKind,
  KNOWN_TRUSTED_TOOL_NAMES,
  GRANDFATHER_TRUST_JUSTIFICATION,
} from "../../types/observation.js";

/**
 * Build an ObservationResult from tool name + success flag + display text.
 */
export function makeObservationResult(
  toolName: string,
  success: boolean,
  displayText: string,
  options?: { readonly delegatedToolsUsed?: readonly string[] },
): ObservationResult {
  const category = categorizeToolName(toolName);
  const resultKind = deriveResultKind(category, success);
  const preserveOnCompaction = !success || category === "error";
  // Phase 1 S2.3 — derive trustLevel from KNOWN_TRUSTED_TOOL_NAMES set in
  // observation.ts. ContextCurator (S2.5) consumes this to decide whether
  // to render the observation inline or in a <tool_output> block.
  const isTrusted = KNOWN_TRUSTED_TOOL_NAMES.has(toolName);
  return {
    success,
    toolName,
    displayText,
    category,
    resultKind,
    preserveOnCompaction,
    ...(options?.delegatedToolsUsed && options.delegatedToolsUsed.length > 0
      ? { delegatedToolsUsed: [...new Set(options.delegatedToolsUsed)] }
      : {}),
    trustLevel: isTrusted ? "trusted" : "untrusted",
    ...(isTrusted ? { trustJustification: GRANDFATHER_TRUST_JUSTIFICATION } : {}),
  };
}
