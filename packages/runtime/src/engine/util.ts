import type { TerminatedBy } from "@reactive-agents/core";

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

// MOVE-3 Phase 3 (2026-05-26) — type unification. Pre-Phase-3 this file
// owned a duplicate `TaskComplexity = "trivial" | "moderate" | "complex"`
// 3-value type definition that lived alongside the canonical 4-value
// `TaskComplexity = "trivial" | "moderate" | "complex" | "expert"` at
// `telemetry-enrichment.ts:25`. Both types were exported under the same
// name in the same package; `ctx.metadata.taskComplexity` was typed
// against the 4-value version (`types.ts:13`) and assignment compiled
// only because the 3-value is a structural subset. This duplication was
// the master-plan §3 root-cause #1 deficit at the type level: same
// concept defined twice with subtly different vocabularies. Phase 3
// re-routes to the canonical type; `classifyComplexity` keeps its
// in-loop semantics (never returns "expert" — that classification
// requires post-execution telemetry signals the in-loop classifier
// doesn't see).
export type { TaskComplexity } from "../telemetry-enrichment.js";

/**
 * Classify a completed task run as trivial / moderate / complex based on
 * iteration count, entropy, tool usage, and termination signal.
 *
 * Return type uses the 3-value subset literal; the function signature
 * declares the canonical 4-value type via the type-only import above so
 * callers see one TaskComplexity across the package.
 *
 * Hoisted from `execution-engine.ts` (W24-E step 1). Type unified
 * MOVE-3 Phase 3 (2026-05-26).
 */
export function classifyComplexity(
  iteration: number,
  entropy: { composite: number } | undefined,
  toolCallCount: number,
  terminatedBy: string,
): "trivial" | "moderate" | "complex" {
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
 * Classify a finished run into the coarse outcome enum shared by the telemetry
 * record and the procedural-learning loop (`"success" | "partial" | "failure"`).
 *
 * ONE definition because there were three hand-copied copies of this ternary
 * (telemetry-emit, local-learning x2), and all three were wrong in the same way:
 * written against a `terminatedBy` union that omitted `"abstained"`, they let an
 * honest abstention fall through to `"success"` — teaching the learning loop
 * that declining to answer is a win. See DEBT-REGISTER §3 (2026-07-23).
 */
export function deriveRunOutcome(
  terminatedBy: TerminatedBy,
  hadErrors: boolean,
): "success" | "partial" | "failure" {
  // Incomplete work, no provider fault.
  if (terminatedBy === "max_iterations") return "partial";
  // The agent honestly declined. Nothing was delivered, so it is not a success;
  // it must never be reinforced as one. The honesty of the decline is carried by
  // `AgentResult.abstention` + the trust receipt, not by this coarse enum.
  //
  // This is the ONLY member whose classification changes here — every branch
  // below reproduces the previous ternary exactly, so runs that never abstain
  // are byte-identical.
  if (terminatedBy === "abstained") return "failure";
  if (hadErrors && terminatedBy !== "final_answer_tool" && terminatedBy !== "final_answer") {
    return "failure";
  }
  // NOTE: `llm_error` with an empty `errorsFromLoop` lands on "success" here.
  // That looks wrong, and it is preserved deliberately — it is pre-existing
  // behavior unrelated to the abstention fix, and changing it silently inside
  // this extraction would be an unrequested behavior change riding along.
  // Logged in DEBT-REGISTER §3 instead.
  return "success";
}

/**
 * Did the terminal mint ENFORCE an honest abstention on this result?
 *
 * Review C1 fenced enforcement OFF for auxiliary passes (verification retries,
 * post-think continuations) — those passes cannot ground themselves and were
 * destroying good answers. That fence has a mirror obligation: an auxiliary
 * pass must not be allowed to OVERWRITE an abstention the terminal pass
 * honestly produced. The continuation hooks and the verification retry
 * unconditionally replace `metadata.lastResponse`, so without this predicate
 * the C1 fix would trade a false abstention for a false answer: an ungrounded
 * run under `.withFabricationGuard("block")` + `.withMinIterations(2)` would
 * ship the continuation's ungrounded prose in place of the sentinel.
 *
 * Reads the ONE record the mint writes (`metadata.verdict.enforced`) rather
 * than sniffing the sentinel text.
 */
export function isEnforcedAbstention(
  result: { readonly metadata: { readonly verdict?: { readonly enforced: boolean } } } | undefined,
): boolean {
  return result?.metadata.verdict?.enforced === true;
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
  /** Kernel failure detail (provider 413/400 message) carried through normalization. */
  error?: string;
  steps?: readonly { id: string; type: string; content: string; metadata?: { toolUsed?: string; duration?: number } }[];
  metadata: { cost: number; tokensUsed: number; inputTokens?: number; outputTokens?: number; stepsCount: number; strategyFallback?: boolean; confidence?: number; llmCalls?: number; terminatedBy?: string; rawTerminatedBy?: string; selectedStrategy?: string; awaitingApprovalFor?: { gateId: string; toolName: string; args: unknown }; /** Agentic-UI interaction rail (Task 10): the paused interaction descriptor — present iff terminatedBy === "awaiting-interaction". */ awaitingInteractionFor?: { interactionId: string; kind: string; prompt: string; schemaJson: string }; /** O3 C1: run-level abstention surface — present iff terminatedBy === "abstained". */ abstention?: { reason: string; missing: readonly string[] };
    /** Cross-cutting cascade Task 9: terminal judgment record, preserved through normalization so the engine can forward it onto `TaskResult.metadata.verdict`. */
    verdict?: { enforced: boolean; groundedOnRequired?: boolean; contractSatisfied?: boolean; failed: readonly string[]; auxiliaryPass?: boolean; repairGaps?: readonly string[] };
    /** Cross-cutting cascade Task 9: the typed extension slot (DEBT-REGISTER §3), preserved through normalization so the engine can forward it onto `TaskResult.metadata.extensions` verbatim. */
    extensions?: Readonly<Record<string, unknown>>;
    /**
     * The append-only RunLedger (Wave C1 ledger-convergence), forwarded by every
     * strategy via `extraMetadata.runLedger`. Structurally typed here to mirror
     * the `ctx.metadata.reasoningResult` declaration in `runtime/src/types.ts`.
     *
     * DEBT-REGISTER §3 (2026-07-23): this field was MISSING from the whitelist
     * rebuild below while `types.ts` declared it, so `rr.metadata.runLedger` was
     * `undefined` on every real engine run and both of the engine's readers
     * silently saw nothing. Two types describing one slot, one narrower in fact:
     * no compile error, total data loss.
     *
     * Wave C.2: it is now the REAL `RunLedger` rather than a hand-written
     * structural mirror of it — the mirror was the drift the note above
     * describes, waiting to happen a second time, and the run-scoped merge
     * (`ledger/run-scope.ts`) needs the true entry union to be type-safe.
     */
    runLedger?: import("@reactive-agents/reasoning").RunLedger;
  };
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
    // Preserve the kernel failure detail (provider 413/400 message) through the
    // whitelist rebuild — without this the engine falls back to a generic
    // "Reasoning failed" and the real cause is lost.
    error: typeof candidate.error === "string" ? candidate.error : undefined,
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
      // Durable HITL (Phase D): preserve the paused-gate descriptor through
      // normalization so the engine can surface pendingApproval + persist.
      awaitingApprovalFor:
        typeof md.awaitingApprovalFor === "object" && md.awaitingApprovalFor !== null
          ? (md.awaitingApprovalFor as { gateId: string; toolName: string; args: unknown })
          : undefined,
      // Agentic-UI interaction rail (Task 10): preserve the paused-interaction
      // descriptor through normalization so the engine can surface
      // pendingInteraction + persist. Mirrors awaitingApprovalFor above.
      awaitingInteractionFor:
        typeof md.awaitingInteractionFor === "object" && md.awaitingInteractionFor !== null
          ? (md.awaitingInteractionFor as { interactionId: string; kind: string; prompt: string; schemaJson: string })
          : undefined,
      // O3 C1: preserve the run-level abstention surface through normalization.
      // Without this, the whitelist-style rebuild above strips abstention before
      // the engine can forward it onto AgentResult.
      abstention:
        typeof md.abstention === "object" && md.abstention !== null
          ? (md.abstention as { reason: string; missing: readonly string[] })
          : undefined,
      // Cross-cutting cascade Task 9: preserve the terminal judgment record
      // through normalization so it reaches `TaskResult.metadata.verdict`.
      // Without this the whitelist rebuild silently drops it, same failure
      // mode DEBT-REGISTER §3 tracks at the execution-engine.ts boundary.
      verdict:
        typeof md.verdict === "object" && md.verdict !== null
          ? (md.verdict as {
              enforced: boolean;
              groundedOnRequired?: boolean;
              contractSatisfied?: boolean;
              failed: readonly string[];
              auxiliaryPass?: boolean;
              repairGaps?: readonly string[];
            })
          : undefined,
      // Cross-cutting cascade Task 9: preserve the typed extension slot
      // (DEBT-REGISTER §3) through normalization, verbatim, one level deep.
      // Future strategy-contributed fields ride here with no normalize
      // edit — only this ONE namespaced key crosses the whitelist rebuild.
      extensions:
        typeof md.extensions === "object" && md.extensions !== null
          ? (md.extensions as Readonly<Record<string, unknown>>)
          : undefined,
      // DEBT-REGISTER §3 (2026-07-23): preserve the RunLedger through the
      // whitelist rebuild. `types.ts` declared this field on
      // `ctx.metadata.reasoningResult` and two engine sites read it, but this
      // rebuild never copied it — so the Wave-C1 "receipts read the ledger"
      // guarantee held only for tests calling the receipt helpers directly,
      // never for a strategy run through `ExecutionEngine`.
      runLedger: Array.isArray(md.runLedger)
        ? (md.runLedger as ExecutionReasoningResult["metadata"]["runLedger"])
        : undefined,
    },
  };
}
