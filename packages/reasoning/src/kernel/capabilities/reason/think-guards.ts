/**
 * think-guards.ts — Redirect guards extracted from think.ts.
 *
 * Each guard is a near-pure function that inspects state + input and either:
 *   - Returns a new `KernelState` redirecting the loop (e.g. back to "thinking"
 *     with a user-message nudge), or
 *   - Returns `undefined` to pass through to the next guard / continue normal flow.
 *
 * Extracted verbatim from think.ts as Phase 2 of the kernel architecture rescue.
 * Pure extraction — behavior and side effects are identical to the original
 * inline blocks. `guardRequiredToolsBlock` still emits a `hooks.onThought` log
 * via `Effect.runSync` to match the yield* behavior in the original code.
 *
 * NOTE: These guards currently inject USER messages into `state.messages`.
 * Task 9 (a later refactor) will convert these to `pendingGuidance` writes
 * so the guidance section renders them inline rather than as raw user turns.
 */
import { Effect } from "effect";
import type { ProviderAdapter } from "@reactive-agents/llm-provider";
import {
  detectCompletionGaps,
  type ToolCallSpec,
} from "@reactive-agents/tools";
import { computeNoveltyRatio } from "../attend/tool-formatting.js";
import {
  buildEvidenceCorpusFromSteps,
  validateOutputGroundedInEvidence,
} from "../verify/evidence-grounding.js";
import { gateNativeToolCallsForRequiredTools } from "../act/tool-gating.js";
import {
  buildSuccessfulToolCallCounts,
  getMissingRequiredToolsFromSteps,
} from "../verify/requirement-state.js";
import { makeStep } from "../sense/step-utils.js";
import { makeObservationResult } from "../act/tool-execution.js";
import type { ContextProfile } from "../../../context/context-profile.js";
import {
  transitionState,
  type KernelState,
  type KernelInput,
  type KernelHooks,
} from "../../../kernel/state/kernel-state.js";
import type { ReasoningStep } from "../../../types/index.js";

// ─────────────────────────────────────────────────────────────────────────────
// 1. guardRequiredToolsBlock
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fires when strict-dependency mode blocks a tool batch that does not include
 * a missing required tool. Emits a `[GATE]` log via `hooks.onThought` and
 * either:
 *   - Fails the run when `requiredToolQuantities` conflicts with `maxCallsPerTool`
 *     (no way to satisfy required minimums within the per-tool budget), or
 *   - Returns `status: "thinking"` with a redirect USER message and records the
 *     blocked tools in `meta.gateBlockedTools` so future batches skip re-gating.
 *
 * Re-invokes `gateNativeToolCallsForRequiredTools` internally so think.ts
 * doesn't need to pass the `blockedOptionalBatch` / `quotaBudgetConflict`
 * details as arguments.
 */
export function guardRequiredToolsBlock(
  rawCalls: readonly ToolCallSpec[],
  input: KernelInput,
  state: KernelState,
  _profile: ContextProfile,
  hooks: KernelHooks,
  newSteps: readonly ReasoningStep[],
  newTokens: number,
  newCost: number,
  thought: string,
  thinking: string | null,
): KernelState | undefined {
  const toolCallCounts = buildSuccessfulToolCallCounts(state.steps);

  const { blockedOptionalBatch, quotaBudgetConflict } =
    gateNativeToolCallsForRequiredTools(
      rawCalls,
      input.requiredTools ?? [],
      state.toolsUsed,
      input.relevantTools,
      toolCallCounts,
      input.maxCallsPerTool,
      input.requiredToolQuantities,
      input.strictToolDependencyChain,
      input.nextMovesPlanning,
    );

  if (!blockedOptionalBatch) return undefined;

  if ((quotaBudgetConflict?.length ?? 0) > 0) {
    const conflictLines = quotaBudgetConflict!.map(
      (entry) =>
        `${entry.toolName}: required minCalls=${entry.requiredMinCalls}, maxCallsPerTool=${entry.maxCalls}, actualCalls=${entry.actualCalls}`,
    );
    const conflictMsg =
      "Configuration conflict — required tool quotas cannot be satisfied within maxCallsPerTool budget:\n" +
      conflictLines.map((line) => `• ${line}`).join("\n") +
      "\nFix either requiredToolQuantities or maxCallsPerTool before retrying this run.";
    const conflictStep = makeStep("observation", conflictMsg, {
      observationResult: makeObservationResult("system", false, conflictMsg),
    });
    return transitionState(state, {
      steps: [...newSteps, conflictStep],
      tokens: newTokens,
      cost: newCost,
      status: "failed",
      error: conflictMsg,
      iteration: state.iteration + 1,
      meta: {
        ...state.meta,
        lastThought: thought,
        lastThinking: thinking,
      },
    });
  }

  const missing = getMissingRequiredToolsFromSteps(
    state.steps,
    input.requiredTools ?? [],
    input.requiredToolQuantities,
  );
  const nextRequired = missing[0] ?? "the missing required tool";
  const attemptedTools = rawCalls.map((tc) => tc.name);
  const writeHint =
    nextRequired.includes("write") || nextRequired.includes("file")
      ? ` Use the ${nextRequired} tool with a path from the task and the full report body as content (markdown).`
      : "";
  const blockMsg =
    `Required tools not yet satisfied: ${missing.join(", ")}. Strict dependency mode blocked this tool batch because it did not include any missing required tool. Call ${nextRequired} now with concrete arguments.${writeHint}`;

  // Emit [GATE] log via runSync — original used `yield* hooks.onThought(...)` inside an Effect.gen.
  // onThought returns Effect<void, never>, so runSync is safe here (no failure path).
  Effect.runSync(
    hooks.onThought(
      state,
      `[GATE] Model tried: ${attemptedTools.join(", ")} — blocked, need: ${missing.join(", ")}`,
    ),
  );

  const blockStep = makeStep("observation", blockMsg, {
    observationResult: makeObservationResult("system", false, blockMsg),
  });

  const prevBlocked =
    (state.meta.gateBlockedTools as readonly string[] | undefined) ?? [];
  const newBlocked = [...new Set([...prevBlocked, ...attemptedTools])];

  return transitionState(state, {
    steps: [...newSteps, blockStep],
    pendingGuidance: { requiredToolsPending: missing },
    tokens: newTokens,
    cost: newCost,
    status: "thinking",
    iteration: state.iteration + 1,
    meta: {
      ...state.meta,
      lastThought: thought,
      lastThinking: thinking,
      gateBlockedTools: newBlocked,
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. guardPrematureFinalAnswer
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fires when the resolver returns `final_answer` but required tools are still
 * missing and iteration budget is not exhausted. Injects a USER redirect
 * message (adapter-specific via `continuationHint` when available, generic
 * fallback otherwise) and loops back for another iteration.
 *
 * Returns `undefined` when no required tools are missing or budget is exhausted
 * (allowing the final answer through).
 */
export function guardPrematureFinalAnswer(
  input: KernelInput,
  state: KernelState,
  _profile: ContextProfile,
  adapter: ProviderAdapter,
  newSteps: readonly ReasoningStep[],
  newTokens: number,
  newCost: number,
): KernelState | undefined {
  const requiredTools = input.requiredTools ?? [];
  const missingRequired = getMissingRequiredToolsFromSteps(
    state.steps,
    requiredTools,
    input.requiredToolQuantities,
  );
  if (missingRequired.length === 0) return undefined;
  if (state.iteration >= ((state.meta.maxIterations as number) ?? 10) - 1) {
    return undefined;
  }

  // Use adapter hint for targeted guidance, fall back to generic redirect
  const lastActStep = state.steps.filter((s) => s.type === "action").pop();
  const lastTool = (lastActStep?.metadata?.toolCall as { name?: string } | undefined)?.name;
  const adapterRedirect = adapter.continuationHint?.({
    toolsUsed: state.toolsUsed,
    requiredTools: requiredTools as string[],
    missingTools: missingRequired,
    iteration: state.iteration,
    maxIterations: (state.meta.maxIterations as number) ?? 10,
    lastToolName: lastTool,
  });
  const redirectMsg =
    adapterRedirect ??
    `Not done yet — you still need to call: ${missingRequired.join(", ")}. Do not give a final answer until all required tools have been used.`;

  const redirectStep = makeStep("observation", redirectMsg, {
    observationResult: makeObservationResult("system", false, redirectMsg),
  });

  // Steps[] keeps the observability record; the LLM sees this redirect via
  // pendingGuidance → the Guidance: section on the next turn, not as a USER turn.
  return transitionState(state, {
    steps: [...newSteps, redirectStep],
    pendingGuidance: { requiredToolsPending: missingRequired },
    tokens: newTokens,
    cost: newCost,
    iteration: state.iteration + 1,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. guardCompletionGaps
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fires when `detectCompletionGaps` identifies tools/actions mentioned in the
 * task description that were never invoked. Injects a USER message listing
 * the gaps and loops back.
 *
 * Returns `undefined` when no gaps detected or iteration budget is exhausted.
 */
export function guardCompletionGaps(
  input: KernelInput,
  state: KernelState,
  newSteps: readonly ReasoningStep[],
  newTokens: number,
  newCost: number,
): KernelState | undefined {
  const gaps = detectCompletionGaps(
    input.task,
    state.toolsUsed,
    input.allToolSchemas ?? input.availableToolSchemas ?? [],
    newSteps as ReasoningStep[],
  );
  if (gaps.length === 0) return undefined;
  if (state.iteration >= ((state.meta.maxIterations as number) ?? 10) - 1) {
    return undefined;
  }

  const gapMsg = `Not done yet — missing steps:\n${gaps.map((g) => `• ${g}`).join("\n")}`;
  const gapStep = makeStep("observation", gapMsg, {
    observationResult: makeObservationResult("system", false, gapMsg),
  });
  return transitionState(state, {
    steps: [...newSteps, gapStep],
    pendingGuidance: { oracleGuidance: gapMsg },
    tokens: newTokens,
    cost: newCost,
    iteration: state.iteration + 1,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. guardQualityCheck
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fires on the final-answer path (iteration > 0) when the adapter defines
 * `qualityCheck` and it returns a non-empty message. Injects the QC hint as
 * a USER message and sets `meta.qualityCheckDone = true` so it never fires twice
 * in the same run.
 *
 * Returns `undefined` on iteration 0, when QC already ran, when the adapter
 * has no `qualityCheck`, or when the check returns nothing.
 */
export function guardQualityCheck(
  input: KernelInput,
  state: KernelState,
  profile: ContextProfile,
  adapter: ProviderAdapter,
  newSteps: readonly ReasoningStep[],
  newTokens: number,
  newCost: number,
): KernelState | undefined {
  if (state.iteration <= 0) return undefined;
  if (state.meta.qualityCheckDone) return undefined;

  const qcMsg = adapter.qualityCheck?.({
    task: input.task,
    requiredTools: input.requiredTools ?? [],
    toolsUsed: state.toolsUsed,
    tier: profile.tier ?? "mid",
  });
  if (!qcMsg) return undefined;

  const qcStep = makeStep("observation", qcMsg, {
    observationResult: makeObservationResult("system", true, qcMsg),
  });
  return transitionState(state, {
    steps: [...newSteps, qcStep],
    pendingGuidance: { qualityGateHint: qcMsg },
    tokens: newTokens,
    cost: newCost,
    iteration: state.iteration + 1,
    // Prevent quality check from firing again next iteration
    meta: { ...state.meta, qualityCheckDone: true },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. guardDiminishingReturns
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Computes a diminishing-returns nudge message for the thinking path. Unlike
 * the other guards, this one does NOT own the full state transition — it
 * returns a replacement "thinking" state that includes:
 *   - The nudge message injected into `state.messages` as a user turn, and
 *   - An observation step containing the nudge, and
 *   - Iteration + token bookkeeping identical to the original inline branch.
 *
 * The caller (think.ts) passes in the `thinkingContent` and `thinkingSteps`
 * it has already assembled; this guard only fires when required tools are
 * missing, at least 3 real tool observations exist, and the last observation
 * adds <20% novelty vs prior observations.
 *
 * Returns `undefined` when any precondition fails — the caller then uses its
 * existing default nudge path.
 */
export function guardDiminishingReturns(
  state: KernelState,
  input: KernelInput,
  _profile: ContextProfile,
  newTokens: number,
  newCost: number,
  opts: {
    readonly thinkingContent: string;
    readonly thinkingSteps: readonly ReasoningStep[];
    readonly missingReq: readonly string[];
    readonly adapterOrDefaultNudge: string;
  },
): KernelState | undefined {
  const { thinkingContent, thinkingSteps, missingReq, adapterOrDefaultNudge } = opts;
  if (missingReq.length === 0) return undefined;

  // Layer 1: Novelty signal — strengthen nudge when recent observations add little new info.
  // If the model has gathered ≥3 real tool observations and the last one is <20% novel,
  // it has enough context. Override the nudge to be explicit about stopping research.
  const realObs = state.steps.filter(
    (s) =>
      s.type === "observation" &&
      (s.metadata?.observationResult as { toolName?: string } | undefined)?.toolName !== "system",
  );
  if (realObs.length < 3) return undefined;

  const lastObsText = realObs[realObs.length - 1].content;
  const priorObsText = realObs.slice(0, -1).map((s) => s.content).join(" ");
  // Safeguard: skip novelty check if either observation is missing or empty
  if (!lastObsText || !priorObsText) return undefined;

  const novelty = computeNoveltyRatio(lastObsText, priorObsText);
  if (novelty >= 0.20) return undefined;

  const pct = Math.round(novelty * 100);
  const nudgeMessage =
    `Research context is sufficient (last search: ${pct}% new information — diminishing returns). ` +
    `Do NOT search again. Call ${missingReq[0]} now to produce the output.`;

  const finalSteps: ReasoningStep[] = [
    ...thinkingSteps,
    makeStep("observation", nudgeMessage, {
      observationResult: makeObservationResult("system", true, nudgeMessage),
    }),
  ];

  // Keep adapterOrDefaultNudge referenced so the caller's fallback path is
  // documented — but the novelty override replaces it when this guard fires.
  void adapterOrDefaultNudge;

  return transitionState(state, {
    steps: finalSteps,
    pendingGuidance: { oracleGuidance: nudgeMessage },
    tokens: newTokens,
    cost: newCost,
    iteration: state.iteration + 1,
    priorThought: thinkingContent || state.priorThought,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. guardEvidenceGrounding
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fires on the final-answer path when the model's output contains dollar amounts
 * that are not present in the tool observation corpus (i.e. potential hallucinations).
 *
 * Evidence corpus is built from `extractedFact` fields on step metadata first
 * (dense, signal-rich values set by extractFactDeterministic in act.ts), then
 * falls back to raw observation content when extracted facts are sparse.
 *
 * Guards:
 *  - Skips when iteration === 0 (no tool results yet)
 *  - Skips when `meta.evidenceGroundingDone` is set (fires at most once per run)
 *  - Skips when the evidence corpus is too thin (< 20 chars)
 *  - Skips when no dollar amounts appear in the output
 *
 * Returns `undefined` when all checks pass — the caller then assembles the final output.
 */
export function guardEvidenceGrounding(
  state: KernelState,
  thought: string,
  newSteps: readonly ReasoningStep[],
  newTokens: number,
  newCost: number,
): KernelState | undefined {
  // Only run once and only when there are prior iterations with real observations.
  if (state.iteration <= 0) return undefined;
  if (state.meta.evidenceGroundingDone) return undefined;

  // Prefer extracted facts (compact, signal-rich) over raw observation bodies.
  const extractedFacts = newSteps
    .filter((s) => s.type === "observation")
    .map((s) => (s.metadata?.extractedFact as string | undefined) ?? "")
    .filter(Boolean)
    .join("\n");

  const evidenceCorpus =
    extractedFacts.length >= 20
      ? extractedFacts
      : buildEvidenceCorpusFromSteps(newSteps);

  const check = validateOutputGroundedInEvidence(thought, evidenceCorpus);
  if (check.ok) return undefined;

  const violationsMsg =
    `Output contains claims not found in tool observations:\n` +
    check.violations.map((v) => `• ${v}`).join("\n") +
    `\nRevise your answer to use only figures from the tool results.`;

  const gapStep = makeStep("observation", violationsMsg, {
    observationResult: makeObservationResult("system", false, violationsMsg),
  });

  return transitionState(state, {
    steps: [...newSteps, gapStep],
    pendingGuidance: { evidenceGap: violationsMsg },
    tokens: newTokens,
    cost: newCost,
    iteration: state.iteration + 1,
    meta: { ...state.meta, evidenceGroundingDone: true },
  });
}
