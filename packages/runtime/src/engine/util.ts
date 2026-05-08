/**
 * Shared utilities used across phase modules. Keep this file tiny — only put
 * helpers here that are used by 2+ phases. Single-phase helpers stay in their
 * phase module.
 */

/**
 * Extract a human-readable string from a task input. The input may be:
 * - a plain string (returned as-is)
 * - an object with a `question` field (returned)
 * - anything else (JSON-stringified)
 */
export function extractTaskText(input: unknown): string {
  if (typeof input === "string") return input;
  if (typeof input === "object" && input !== null) {
    const q = (input as Record<string, unknown>).question;
    if (typeof q === "string") return q;
  }
  return JSON.stringify(input);
}

/**
 * Returns `allowedTools` names that don't match any registered tool name.
 *
 * Used at bootstrap to warn when the caller specified tool names that are not
 * actually registered (e.g. a typo or an MCP tool name change). Trims each
 * entry so whitespace typos (" recall") don't produce false positives —
 * mirrors the ToolService filter layer normalization.
 *
 * Hoisted from `execution-engine.ts:298` (W23 step 4); re-exported there for
 * backward compatibility.
 */
export function checkAllowedToolsMismatch(
  allowedTools: readonly string[],
  registeredTools: readonly { name: string }[],
): string[] {
  const registered = new Set(registeredTools.map((t) => t.name));
  return allowedTools.filter((name) => !registered.has(name.trim()));
}

/** Map SkillResolver rows on execution metadata into `brief` skill entries. */
export function briefResolvedSkillsFromMetadata(
  metadata: Record<string, unknown>,
): readonly { readonly name: string; readonly purpose: string }[] | undefined {
  const rs = metadata.resolvedSkills;
  if (!Array.isArray(rs) || rs.length === 0) return undefined;
  const out: { name: string; purpose: string }[] = [];
  for (const item of rs) {
    if (typeof item !== "object" || item === null) continue;
    const rec = item as Record<string, unknown>;
    const name = rec.name;
    if (typeof name !== "string" || name.length === 0) continue;
    const description = rec.description;
    out.push({
      name,
      purpose: typeof description === "string" ? description : "",
    });
  }
  return out.length > 0 ? out : undefined;
}

/**
 * Normalized shape of a `ReasoningService.execute()` result, after defensive
 * validation. Hoisted from `execution-engine.ts:237` (W23 step 6a-2 prep)
 * so both the engine and inline-path modules can share the helper.
 */
export type ExecutionReasoningResult = {
  output: unknown;
  status: string;
  strategy?: string;
  steps?: readonly { id: string; type: string; content: string; metadata?: { toolUsed?: string; duration?: number } }[];
  metadata: { cost: number; tokensUsed: number; stepsCount: number; strategyFallback?: boolean; confidence?: number; llmCalls?: number; terminatedBy?: string };
};

export function normalizeReasoningResult(
  value: unknown,
): ExecutionReasoningResult | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const candidate = value as Record<string, unknown>;
  const metadata = candidate.metadata;
  if (typeof metadata !== "object" || metadata === null) return undefined;
  const md = metadata as Record<string, unknown>;
  if (
    typeof md.cost !== "number" ||
    typeof md.tokensUsed !== "number" ||
    typeof md.stepsCount !== "number"
  ) {
    return undefined;
  }

  return {
    output: candidate.output,
    status: typeof candidate.status === "string" ? candidate.status : "error",
    strategy: typeof candidate.strategy === "string" ? candidate.strategy : undefined,
    steps: Array.isArray(candidate.steps)
      ? (candidate.steps as ExecutionReasoningResult["steps"])
      : undefined,
    metadata: {
      cost: md.cost,
      tokensUsed: md.tokensUsed,
      stepsCount: md.stepsCount,
      strategyFallback: typeof md.strategyFallback === "boolean"
        ? md.strategyFallback
        : undefined,
      confidence: typeof md.confidence === "number" ? md.confidence : undefined,
      llmCalls: typeof md.llmCalls === "number" ? md.llmCalls : undefined,
      terminatedBy: typeof md.terminatedBy === "string" ? md.terminatedBy : undefined,
    },
  };
}
