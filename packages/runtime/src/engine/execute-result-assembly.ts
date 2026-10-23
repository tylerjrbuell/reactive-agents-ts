/**
 * TaskResult assembly at the engine boundary.
 *
 * Owns: the full `result` literal — output/success/error channels from the
 * verification outcome, the enumerated metadata forwarding table
 * (duration, cost, tokens, strategyUsed, reasoningSteps, scratchpad,
 * receiptToolCalls, runLedger, confidence, verdict, extensions, honesty
 * markers, boundary verdict, cacheHit, trace linkage, run-budget spend), and
 * the awaitingApprovalFor / awaitingInteractionFor / abstention passthroughs.
 *
 * Pure: reads the locals the engine threaded in, mutates nothing. The
 * `_debriefFiber` defineProperty stays with the engine (it needs the fiber
 * local).
 *
 * Moved verbatim from execution-engine.ts (GH #221 W26 decomposition, former
 * "const result: TaskResult & {...} = {...}" literal lines 1441-1635).
 */
import type { Task, TaskResult, TerminatedBy } from "@reactive-agents/core";
import type { RunBudgetMeter } from "@reactive-agents/reasoning";
import type { ExecutionContext } from "../types.js";
import type { AgentDebrief } from "../debrief.js";
import { readRunLedger } from "./run-ledger-scope.js";
import { classifyComplexity } from "./util.js";
import type { VerificationOutcome } from "./finalize/verification-outcome.js";
import type { ResultVerificationOutcome } from "./finalize/result-verification.js";
import type { TraceLinkage } from "./finalize/trace-linkage.js";
import type { EntropyLogEntry, ToolCallEntry } from "./execute-event-collectors.js";

/** Shape of the reasoning result stored in ctx.metadata.reasoningResult. */
type ReasoningResultLike = ExecutionContext["metadata"]["reasoningResult"];

export interface ResultAssemblyDeps {
  readonly task: Task;
  readonly ctx: ExecutionContext;
  readonly rr: ReasoningResultLike;
  readonly verificationOutcome: VerificationOutcome;
  readonly executionDurationMs: number;
  readonly outputForSuccess: string;
  readonly toolCallLog: readonly ToolCallEntry[];
  readonly entropyLog: readonly EntropyLogEntry[];
  readonly terminatedByRaw: TerminatedBy;
  readonly debrief: AgentDebrief | undefined;
  readonly boundaryVerification: ResultVerificationOutcome | undefined;
  readonly traceLinkage: TraceLinkage | null;
  readonly ambientRunMeter: RunBudgetMeter | null;
}

export function assembleTaskResult(
  deps: ResultAssemblyDeps,
): TaskResult & {
  format?: string;
  terminatedBy?: string;
  debrief?: AgentDebrief;
} {
  const {
    task,
    ctx,
    rr,
    verificationOutcome,
    executionDurationMs,
    outputForSuccess,
    toolCallLog,
    entropyLog,
    terminatedByRaw,
    debrief,
    boundaryVerification,
    traceLinkage,
    ambientRunMeter,
  } = deps;

  const result: TaskResult & {
    format?: string;
    terminatedBy?: string;
    debrief?: AgentDebrief;
  } = {
    taskId: task.id,
    agentId: task.agentId,
    output: verificationOutcome.output,
    success: verificationOutcome.success,
    ...(!verificationOutcome.success
      ? {
          error:
            verificationOutcome.error ??
            (ctx.metadata.emptyOutputFailure
              ? "Run ended with no output and no verified deliverable — nothing to ship."
              : outputForSuccess.length > 0
              ? outputForSuccess
              : rr?.status === "failed"
                // Prefer the real kernel failure detail (provider
                // 413/400 message via explainProviderError) over the
                // generic label — the error was captured in
                // state.error and carried onto rr.error.
                ? (typeof rr?.error === "string" && rr.error.trim().length > 0
                    ? rr.error
                    : "Reasoning failed")
                : "Execution did not complete successfully"),
        }
      : {}),
    metadata: {
      duration: executionDurationMs,
      cost: ctx.cost,
      tokensUsed: ctx.tokensUsed,
      // GH #126 — `totalTokens` alias mirrors `tokensUsed`
      // for consumers expecting the same name used on
      // AgentCompleted / ReasoningResult / traceStats.
      totalTokens: ctx.tokensUsed,
      // Prompt/completion split from the reasoning strategy.
      // Optional — provider/strategy may not always populate
      // (test-provider, sub-agent rollups, retry hooks).
      ...(typeof rr?.metadata?.inputTokens === "number" ? { inputTokens: rr.metadata.inputTokens } : {}),
      ...(typeof rr?.metadata?.outputTokens === "number" ? { outputTokens: rr.metadata.outputTokens } : {}),
      strategyUsed: ctx.selectedStrategy,
      stepsCount: ctx.metadata.stepsCount ?? ctx.iteration,
      iterations: ctx.iteration,
      // Forward reasoning steps so chat() can access tool results and analysis.
      // Cast needed: reasoningSteps is an internal field not in the public TaskResult type.
      ...(ctx.metadata.reasoningSteps ? { reasoningSteps: ctx.metadata.reasoningSteps } as Record<string, unknown> : {}),
      // Forward the uncompressed tool-result store alongside reasoningSteps
      // so external evidence checks (validateCitations) aren't limited to
      // the lossy compressed step-content preview.
      ...(ctx.metadata.scratchpad ? { scratchpad: ctx.metadata.scratchpad } as Record<string, unknown> : {}),
      // Trust receipt (Arc 1 Task 8): forward `{name, ok}` tool-call
      // outcomes collected from ToolCallCompleted events. This is the
      // ONLY grounding source on the minimal/inline loop (which
      // executes tools but produces no reasoningSteps) — without it
      // the receipt falsely grades tool-using minimal runs
      // "ungrounded". Kernel runs carry both; the receipt sites
      // prefer step-derivation and use this as fallback.
      ...(toolCallLog.length > 0
        ? { receiptToolCalls: toolCallLog.map((t) => ({ name: t.toolName, ok: t.success })) } as Record<string, unknown>
        : {}),
      // Wave C1 (task 5): forward the strategy's RunLedger so the
      // trust receipt's deriveReceiptToolCalls can re-base its
      // tool-call evidence onto ledger pairs FIRST, ahead of the
      // reasoningSteps/receiptToolCalls fallbacks above. Read from
      // `rr.metadata.runLedger` (task 4 shipped every strategy
      // forwarding it there via `extraMetadata.runLedger`) — NOT
      // `ctx.metadata.reasoningSteps`, which only ever held
      // `result.steps`, never `result.metadata.runLedger`.
      //
      // Wave C.2: prefer the RUN-scoped ledger. `rr` is whichever
      // pass finished LAST, so on a run with a verification retry
      // or a continuation it is an auxiliary pass and forwarding
      // its ledger alone discarded the terminal pass's facts. The
      // run-scoped ledger holds every pass, seq-rebased and
      // provenance-stamped (engine/run-ledger-scope.ts); it falls
      // back to `rr`'s for any path that never seeded it.
      ...(() => {
        const runScoped = readRunLedger(ctx.metadata) ?? rr?.metadata?.runLedger;
        return runScoped && runScoped.length > 0
          ? ({ runLedger: runScoped } as Record<string, unknown>)
          : {};
      })(),
      ...(rr?.metadata?.confidence !== undefined ? {
        confidence: (rr.metadata.confidence >= 0.7
          ? "high"
          : rr.metadata.confidence >= 0.4
            ? "medium"
            : "low") as "high" | "medium" | "low",
      } : {}),
      // Cross-cutting cascade Task 9: forward the terminal
      // judgment record so trust receipts can read it off
      // TaskResult. Enumerated (consumed by name) like
      // reasoningSteps/receiptToolCalls/runLedger above.
      ...(rr?.metadata?.verdict !== undefined ? { verdict: rr.metadata.verdict } : {}),
      // Cross-cutting cascade Task 9: the typed extension slot.
      // Future strategy-contributed fields ride here — no more
      // per-field enumeration (DEBT-REGISTER §3 row closed).
      // Top-level keys still never pass untyped.
      ...(rr?.metadata?.extensions !== undefined ? { extensions: rr.metadata.extensions } : {}),
      ...(rr?.metadata?.strategyFallback === true ? { strategyFallback: true } : {}),
      ...(ctx.metadata.budgetExceeded ? { budgetExceeded: true } : {}),
      complexity: ctx.metadata.taskComplexity ?? classifyComplexity(
        ctx.iteration,
        entropyLog.length > 0 ? entropyLog[entropyLog.length - 1] : undefined,
        toolCallLog.length,
        terminatedByRaw,
      ),
      llmCalls: rr?.metadata?.llmCalls ?? ctx.metadata.llmCalls ?? 0,
      // #40 honesty channel: a harness-synthesized completion note
      // is not model prose — say so on the result. Two independent
      // producers: this engine's OWN empty-output branch
      // (ctx.metadata.harnessAuthoredOutput, set above when every
      // declared deliverable landed but the model's final turn was
      // empty) and the KERNEL's own onlyHarnessAuthorshipFailed
      // degrade (runner.ts — the model's turn was NON-empty but the
      // verifier caught it as harness-assembled, e.g. a normalized
      // tool observation standing in for a synthesized answer).
      // Before this fix only the former reached the result — the
      // kernel's own, already-correctly-set flag on
      // rr?.metadata.harnessAuthoredOutput was silently dropped at
      // this exact boundary (found via engine-empty-output-
      // invariant.test.ts, Move 1 merge triage 2026-08-13).
      ...(ctx.metadata.harnessAuthoredOutput === true || rr?.metadata?.harnessAuthoredOutput === true
        ? ({ harnessAuthoredOutput: true } as Record<string, unknown>)
        : {}),
      // W5 fold: the envelope honesty markers ride to the user.
      // Before this they were dropped at the normalize boundary
      // (whitelist rebuild), so the cap's evidence never reached
      // AgentResult.metadata on any pass. Envelope-sourced
      // verificationWarning rides FIRST; the engine's own
      // result-boundary warning below keeps authority when both
      // exist (later spread wins).
      ...(rr?.metadata?.outstandingCriteria !== undefined
        ? ({ outstandingCriteria: rr.metadata.outstandingCriteria } as Record<string, unknown>)
        : {}),
      ...(rr?.metadata?.budgetTerminalPartial === true
        ? ({ budgetTerminalPartial: true } as Record<string, unknown>)
        : {}),
      ...(rr?.metadata?.verificationWarning !== undefined
        ? ({ verificationWarning: rr.metadata.verificationWarning } as Record<string, unknown>)
        : {}),
      // Result-boundary verification: the verdict rides to the
      // receipt sites (run() + stream) via metadata, so BOTH
      // paths stamp receipt.verifierVerdict from one source.
      ...(boundaryVerification !== undefined
        ? ({ verifierVerdict: boundaryVerification.verdict } as Record<string, unknown>)
        : {}),
      ...(boundaryVerification?.warning !== undefined
        ? ({ verificationWarning: boundaryVerification.warning } as Record<string, unknown>)
        : {}),
      // A semantic-cache HIT short-circuits the whole loop: no LLM
      // call, no tool dispatch, no steps, no ledger. The flag was
      // set on ctx by the cache check and read only by cost-track,
      // so the RESULT was indistinguishable from a real run — and
      // the receipt read like one. It rides to both receipt sites
      // now, exactly as the boundary verdict above does.
      ...(ctx.metadata.cacheHit === true
        ? ({ cacheHit: true } as Record<string, unknown>)
        : {}),
      // W0.5: run→trace linkage (Lift Protocol plumbing). Enumerated
      // by name like harnessAuthoredOutput above; present ONLY when
      // the trace file was flushed and verified to exist at mint.
      ...(traceLinkage !== null
        ? ({ runId: traceLinkage.runId, tracePath: traceLinkage.tracePath } as Record<string, unknown>)
        : {}),
      // W5.4: the live run-meter total (parent calls + folded
      // delegated-child spend). Present ONLY when a budget was
      // armed for this run; absent on un-budgeted runs
      // (wire-or-delete honesty).
      ...(ambientRunMeter !== null
        ? ({ runBudgetSpend: { tokens: ambientRunMeter.tokens, cost: ambientRunMeter.cost } } as Record<string, unknown>)
        : {}),
    },
    completedAt: new Date(),
    format: "text",
    terminatedBy: terminatedByRaw,
    ...(debrief !== undefined ? { debrief } : {}),
    ...((rr?.metadata as Record<string, unknown> | undefined)?.["awaitingApprovalFor"] !== undefined
      ? { awaitingApprovalFor: (rr!.metadata as Record<string, unknown>)["awaitingApprovalFor"] as { gateId: string; toolName: string; args: unknown } }
      : {}),
    // Agentic-UI interaction rail (Task 10): forward the paused
    // interaction descriptor so ReactiveAgent can surface
    // pendingInteraction + persist. Mirrors awaitingApprovalFor above.
    ...((rr?.metadata as Record<string, unknown> | undefined)?.["awaitingInteractionFor"] !== undefined
      ? { awaitingInteractionFor: (rr!.metadata as Record<string, unknown>)["awaitingInteractionFor"] as { interactionId: string; kind: string; prompt: string; schemaJson: string } }
      : {}),
    // O3 C1: forward the run-level abstention surface from the
    // strategy result so ReactiveAgent.projectAbstention(r) can
    // populate AgentResult.abstention. Mirrors awaitingApprovalFor
    // above. Only present when terminatedBy === "abstained".
    ...((rr?.metadata as Record<string, unknown> | undefined)?.["abstention"] !== undefined
      ? { abstention: (rr!.metadata as Record<string, unknown>)["abstention"] as { reason: string; missing: readonly string[] } }
      : {}),
  };

  return result;
}
