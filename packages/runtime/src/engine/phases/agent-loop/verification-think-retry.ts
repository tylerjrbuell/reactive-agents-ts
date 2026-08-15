/**
 * Verification-quality-gate THINK retry callback.
 *
 * When the verifier rejects a response, the orchestrator re-runs the THINK
 * phase with verification feedback already appended to `c.messages`. This
 * helper is the body of that retry's `guardedPhase(ctx, "think", ...)`
 * callback: it routes through ReasoningService when wired, or falls back to
 * a single inline LLM call (the byte-for-byte path verification-quality-gate
 * tests pin: llmCallCount === 2 / verifyCallCount === 2).
 *
 * Extracted from `execution-engine.ts:2148-2308` (W23 step 6a-2) to shrink the
 * engine module without changing behavior. Error sites
 * (`runtime/src/execution-engine.ts:NNNN` / `:invalid-shape` / `:reasoning-failed`)
 * are intentionally retained for diagnostic compatibility with the inline-path
 * test files.
 */
import { Context, Effect } from "effect";
import { emitErrorSwallowed, errorTag } from "@reactive-agents/core";
import type { Task } from "@reactive-agents/core";
import type { ModelCalibration } from "@reactive-agents/llm-provider";
import { absorbedLedgerMetadata } from "../../run-ledger-scope.js";
import type { ExecutionContext, ReactiveAgentsConfig } from "../../../types.js";
import type { ObsLike, EbLike } from "../../runtime-context.js";
import { extractTaskText, isEnforcedAbstention, normalizeReasoningResult } from "../../util.js";
import type { ReasoningServiceLike } from "../../types-reasoning.js";
import { buildRunEnvelopeFromConfig } from "../../run-envelope-config.js";
import { asExecutionContextEffect } from "./as-execution-context-effect.js";

type ReasoningExecuteRequest = Parameters<ReasoningServiceLike["execute"]>[0];

export interface VerificationThinkRetryDeps {
  readonly config: ReactiveAgentsConfig;
  readonly task: Task;
  readonly reasoningOpt:
    | { readonly _tag: "Some"; readonly value: ReasoningServiceLike }
    | { readonly _tag: "None" };
  readonly taskCategory: string;
  readonly resolvedCalibration: ModelCalibration | undefined;
  readonly obs: ObsLike | null;
  readonly eb: EbLike | null;
}

export const runVerificationThinkRetry = (
  c: ExecutionContext,
  deps: VerificationThinkRetryDeps,
): Effect.Effect<ExecutionContext, never> => {
  const { config, task, reasoningOpt, taskCategory, resolvedCalibration, obs, eb } = deps;
  return asExecutionContextEffect(Effect.gen(function* () {
    // Review C1 mirror: the retry pass is fenced from enforcement (it cannot
    // call a tool), so re-running it against an ENFORCED honest abstention
    // would replace the sentinel with ungrounded prose. A run that honestly
    // declined is not a run to "revise".
    if (isEnforcedAbstention(c.metadata.reasoningResult)) return c;
    if (reasoningOpt._tag === "Some") {
      // ── Kernel-routed retry ──
      // availableTools: [] + maxIterations: 1 makes this
      // single-shot (no tool execution, no loop re-entry).
      // The verifier feedback message is already in
      // c.messages (appended above) and flows in via
      // initialMessages.
      const retryEffect = reasoningOpt.value.execute({
        taskDescription: extractTaskText(task.input),
        taskType: task.type,
        memoryContext: "",
        availableTools: [],
        availableToolSchemas: [],
        allToolSchemas: [],
        strategy:
          (c.selectedStrategy ?? "reactive") as ReasoningExecuteRequest["strategy"],
        contextProfile: {
          ...config.contextProfile,
          maxIterations: 1,
        },
        providerName: String(config.provider ?? ""),
        systemPrompt: config.systemPrompt,
        taskId: c.taskId,
        agentId: config.agentId,
        sessionId: c.taskId,
        modelId: String(config.defaultModel ?? ""),
        taskCategory,
        temperature: config.contextProfile?.temperature as number | undefined,
        environmentContext: config.environmentContext as Record<string, string> | undefined,
        initialMessages: c.messages as readonly { readonly role: "user" | "assistant"; readonly content: string }[],
        calibration: resolvedCalibration,
        // Cross-cutting cascade (2026-07-22) — this retry re-runs the REAL task
        // (`taskDescription` is the task, the verifier feedback rides
        // `initialMessages`) and its output becomes the user-visible answer, so
        // it must be judged under the same harness as the first pass. Built
        // through the ONE config→envelope mapper (review I3).
        //
        // The two resume rails (`approvalDecision` / `interactionResponse`) are
        // deliberately absent — see `RunEnvelopeExtras`. `availableTools: []`
        // also makes the approval gate moot here; the policy is carried anyway
        // so it never depends on the tool list happening to be empty.
        //
        // `auxiliaryPass: true` (review C1) — this pass is a FRAGMENT: with
        // `availableTools: []` and `maxIterations: 1` it cannot call a tool at
        // all, so its `steps` can never contain the required-tool evidence.
        // Judged as a terminal it looked like a fabrication, and
        // `.withFabricationGuard("block")` replaced a correct, tool-grounded
        // answer with the abstention sentinel. The evidence is in the FIRST
        // pass, which was judged as the terminal it is.
        envelope: buildRunEnvelopeFromConfig(config, { auxiliaryPass: true }),
      });
      const retryOutcome = yield* Effect.exit(retryEffect);
      if (retryOutcome._tag === "Success") {
        const norm = normalizeReasoningResult(retryOutcome.value);
        if (norm) {
          const retryOutput = String(norm.output ?? "");
          return {
            ...c,
            messages: [
              ...c.messages,
              { role: "assistant", content: retryOutput },
            ],
            tokensUsed:
              c.tokensUsed + (norm.metadata.tokensUsed ?? 0),
            cost: c.cost + (norm.metadata.cost ?? 0),
            iteration: c.iteration + 1,
            metadata: {
              ...c.metadata,
              lastResponse: retryOutput,
              isComplete: norm.status === "completed",
              reasoningResult: norm,
              stepsCount: norm.metadata.stepsCount,
              reasoningSteps: norm.steps ?? [],
              // Wave C.2 — this retry is a separate kernel execution whose
              // ledger starts at seq 0, and it overwrites `reasoningResult`
              // above. Absorbing it re-bases the seqs onto the run's ledger and
              // stamps the provenance, so the first pass's facts survive and
              // this pass's are attributable rather than anonymous.
              ...absorbedLedgerMetadata(c.metadata, norm, "verification-retry"),
            },
          };
        }
        // Reasoning returned an unrecognized shape — surface a
        // soft error and let the loop terminate (mirrors the
        // strategyFallback pattern at lines ~1707-1712).
        if (obs) {
          yield* obs.info(
            "[engine] WARN: verification retry — reasoning returned invalid shape; terminating with error",
          ).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/engine/phases/agent-loop/verification-think-retry.ts:invalid-shape", tag: errorTag(err) })));
        }
        return {
          ...c,
          metadata: {
            ...c.metadata,
            lastResponse: "Verification retry failed — reasoning returned an invalid result shape",
            isComplete: true,
          },
        };
      }
      // Reasoning effect failed — log + terminate.
      if (obs) {
        yield* obs.info(
          `[engine] WARN: verification retry — reasoning failed: ${String(retryOutcome.cause)}`,
        ).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/engine/phases/agent-loop/verification-think-retry.ts:reasoning-failed", tag: errorTag(err) })));
      }
      return {
        ...c,
        metadata: {
          ...c.metadata,
          lastResponse: `Verification retry failed: ${String(retryOutcome.cause)}`,
          isComplete: true,
        },
      };
    }

    // ── Fallback: inline LLM call (preserves the no-reasoning
    // contract asserted by verification-quality-gate.test.ts) ──
    const llm = yield* Context.GenericTag<{
      complete: (req: unknown) => Effect.Effect<{
        content: string;
        toolCalls?: unknown[];
        stopReason: string;
        usage?: {
          totalTokens?: number;
          estimatedCost?: number;
        };
      }>;
    }>("LLMService");

    const defaultPrompt =
      config.systemPrompt ?? "You are a helpful AI assistant.";
    const messagesToSend = [
      { role: "system", content: defaultPrompt },
      ...c.messages,
    ];

    const llmRequest = {
      messages: messagesToSend,
      model: c.selectedModel,
      taskId: c.taskId,
    } as Parameters<typeof llm.complete>[0] & { taskId: string };

    const response = yield* llm.complete(llmRequest);

    const fallbackTransitions = (response as { fallbackTransitions?: Array<{
      fromProvider: string;
      toProvider: string;
      reason: string;
      attemptNumber: number;
    }> }).fallbackTransitions;
    if (eb && fallbackTransitions && fallbackTransitions.length > 0) {
      for (const transition of fallbackTransitions) {
        yield* eb.publish({
          _tag: "ProviderFallbackActivated",
          taskId: c.taskId,
          fromProvider: transition.fromProvider,
          toProvider: transition.toProvider,
          reason: transition.reason,
          attemptNumber: transition.attemptNumber,
        }).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/engine/phases/agent-loop/verification-think-retry.ts:emit-provider-fallback", tag: errorTag(err) })));
      }
    }

    const retryDone =
      response.stopReason === "end_turn" &&
      !response.toolCalls?.length;

    return {
      ...c,
      messages: [
        ...c.messages,
        { role: "assistant", content: response.content },
      ],
      tokensUsed:
        c.tokensUsed + (response.usage?.totalTokens ?? 0),
      cost: c.cost + (response.usage?.estimatedCost ?? 0),
      iteration: c.iteration + 1,
      metadata: {
        ...c.metadata,
        lastResponse: response.content,
        isComplete: retryDone,
      },
    };
  }));
};
