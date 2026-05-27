/**
 * Shared utilities used across phase modules. Keep this file tiny — only put
 * helpers here that are used by 2+ phases. Single-phase helpers stay in their
 * phase module.
 */

// HS-cleanup-1 (2026-05-23): framework markup is stripped at producers
// (think.ts + step.metadata.frameworkInstrumentation). Runtime no longer
// needs stripFrameworkLeaks; the shim was removed from this file along with
// its callers in `sanitizeOutput` and `normalizeReasoningResult`.

/**
 * Resolve the effective model name for telemetry, snapshot, and capability lookup.
 *
 * Handles the schema's `selectedModel` field shape variance (string on the legacy/
 * reactive paths, object with a `.model` property on the reasoning paths).
 * Replaces the `(ctx.selectedModel as any)?.model ?? ctx.selectedModel ?? config.defaultModel ?? "unknown"`
 * pattern that was previously inlined at execution-engine.ts:834 and :950 (W26-A step 2).
 */
export function resolveModelName(
  ctx: { selectedModel?: unknown; provider?: unknown },
  config: { defaultModel?: unknown },
): string {
  const sel = ctx.selectedModel;
  if (
    sel &&
    typeof sel === "object" &&
    "model" in sel &&
    typeof (sel as { model: unknown }).model === "string"
  ) {
    return (sel as { model: string }).model;
  }
  if (typeof sel === "string") return sel;
  if (typeof config.defaultModel === "string") return config.defaultModel;
  return "unknown";
}

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
 * Strip internal agent metadata from output before it reaches the user.
 * This is a safety net — strategies should sanitize their own output, but
 * this catches anything that slips through.
 *
 * Hoisted from `execution-engine.ts` (W24-E step 1).
 */
export function sanitizeOutput(text: string): string {
  if (!text || text.length === 0) return text;
  let result = text;
  // Strip <think>...</think> tags, but capture the last block as a fallback
  // in case the model (e.g. cogito) puts the entire answer inside <think>.
  const thinkBlocks: string[] = [];
  result = result.replace(/<think>([\s\S]*?)<\/think>/gi, (_m, inner: string) => {
    thinkBlocks.push(inner.trim());
    return "";
  });
  // Strip "FINAL ANSWER:" prefix
  result = result.replace(/^FINAL ANSWER:\s*/i, "");
  // Strip internal step markers
  result = result.replace(/^\[(?:STEP \d+\/\d+|EXEC s\d+|SYNTHESIS|REFLECT \d+|SKIP s\d+|PATCH)\]\s*/gim, "");
  // Strip ReAct protocol prefixes at line start
  result = result.replace(/^(?:Thought|Action|Action Input|Observation):\s*/gim, "");
  // Strip tool call echo lines: "tool/name: {json}"
  result = result.replace(/^[\w\-]+\/[\w\-]+:\s*\{[^}]*\}\s*$/gm, "");
  // Strip lines that are just raw JSON with internal keys
  result = result.replace(/^\s*\{\s*"(?:recipient|toolName|callId|stepId|_tag)"[^}]*\}\s*$/gm, "");
  // Collapse multiple blank lines
  result = result.replace(/\n{3,}/g, "\n\n");
  result = result.trim();
  // Fallback: if stripping <think> blocks left nothing, use the last paragraph
  // of the last <think> block (models like cogito embed the answer inside thinking).
  if (!result && thinkBlocks.length > 0) {
    const lastBlock = thinkBlocks[thinkBlocks.length - 1] ?? "";
    const paragraphs = lastBlock.split(/\n{2,}/).map((p) => p.trim()).filter((p) => p.length > 0);
    result = paragraphs[paragraphs.length - 1] ?? lastBlock;
  }
  return result;
}

// ─── Task Complexity Classification ───

export type TaskComplexity = "trivial" | "moderate" | "complex";

/**
 * Classify a completed task run as trivial / moderate / complex based on
 * iteration count, entropy, tool usage, and termination signal.
 *
 * Hoisted from `execution-engine.ts` (W24-E step 1).
 */
export function classifyComplexity(
  iteration: number,
  entropy: { composite: number } | undefined,
  toolCallCount: number,
  terminatedBy: string,
): TaskComplexity {
  if (iteration <= 1 && toolCallCount === 0 && terminatedBy !== "max_iterations") return "trivial";
  if (toolCallCount <= 2 && iteration <= 3 && (entropy ? entropy.composite < 0.4 : true)) return "moderate";
  return "complex";
}

/**
 * Derive per-tool call budgets from required tool quantities.
 *
 * Behavior:
 * - parallel mode (`parallelToolCalls !== false`): each required tool gets a
 *   budget of `minCalls + retryBuffer` where the buffer allows for exploratory
 *   combined searches, failed attempts, and guard-blocked calls that don't
 *   count as successful completions. Without this buffer the agent has zero
 *   room for recovery.
 * - sequential mode (`parallelToolCalls === false`): no auto per-tool budgets;
 *   execution follows the historical one-call-at-a-time loop behavior.
 *
 * Hoisted from `execution-engine.ts` (W24-E step 1).
 */
export function buildAutoMaxCallsPerTool(input: {
  readonly parallelToolCallsEnabled: boolean;
  readonly requiredTools?: readonly string[];
  readonly requiredToolQuantities?: Readonly<Record<string, number>>;
}): Readonly<Record<string, number>> {
  if (!input.parallelToolCallsEnabled) {
    return {};
  }

  const RETRY_BUFFER = 2;
  const requiredTools = new Set(input.requiredTools ?? []);
  const requiredToolQuantities = input.requiredToolQuantities ?? {};
  const autoMaxCallsPerTool: Record<string, number> = {};

  for (const toolName of requiredTools) {
    const minCalls = Math.max(1, requiredToolQuantities[toolName] ?? 1);
    autoMaxCallsPerTool[toolName] = minCalls + RETRY_BUFFER;
  }

  return autoMaxCallsPerTool;
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
  metadata: { cost: number; tokensUsed: number; inputTokens?: number; outputTokens?: number; stepsCount: number; strategyFallback?: boolean; confidence?: number; llmCalls?: number; terminatedBy?: string; rawTerminatedBy?: string; selectedStrategy?: string };
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
      inputTokens: typeof md.inputTokens === "number" ? md.inputTokens : undefined,
      outputTokens: typeof md.outputTokens === "number" ? md.outputTokens : undefined,
      stepsCount: md.stepsCount,
      strategyFallback: typeof md.strategyFallback === "boolean"
        ? md.strategyFallback
        : undefined,
      confidence: typeof md.confidence === "number" ? md.confidence : undefined,
      llmCalls: typeof md.llmCalls === "number" ? md.llmCalls : undefined,
      terminatedBy: typeof md.terminatedBy === "string" ? md.terminatedBy : undefined,
      rawTerminatedBy: typeof md.rawTerminatedBy === "string" ? md.rawTerminatedBy : undefined,
    },
  };
}
