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
import type { ExecutionContext, ReactiveAgentsConfig } from "../../../types.js";
import type { ObsLike, EbLike } from "../../runtime-context.js";
import { extractTaskText, normalizeReasoningResult } from "../../util.js";

type ReasoningServiceLike = {
  execute: (req: {
    taskDescription: string;
    taskType?: string;
    memoryContext: string;
    availableTools: readonly unknown[];
    availableToolSchemas: readonly unknown[];
    allToolSchemas: readonly unknown[];
    strategy: string;
    contextProfile: Record<string, unknown>;
    providerName: string;
    systemPrompt?: string;
    taskId: string;
    agentId?: string;
    sessionId: string;
    modelId: string;
    taskCategory: string;
    temperature?: number;
    environmentContext?: Record<string, string>;
    initialMessages: readonly { readonly role: "user" | "assistant"; readonly content: string }[];
    calibration?: ModelCalibration;
  }) => Effect.Effect<unknown, unknown>;
};

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
  return Effect.gen(function* () {
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
        strategy: c.selectedStrategy ?? "reactive",
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
            },
          };
        }
        // Reasoning returned an unrecognized shape — surface a
        // soft error and let the loop terminate (mirrors the
        // strategyFallback pattern at lines ~1707-1712).
        if (obs) {
          yield* obs.info(
            "[engine] WARN: verification retry — reasoning returned invalid shape; terminating with error",
          ).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/execution-engine.ts:invalid-shape", tag: errorTag(err) })));
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
        ).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/execution-engine.ts:reasoning-failed", tag: errorTag(err) })));
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
        }).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/execution-engine.ts:3176", tag: errorTag(err) })));
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
  }) as unknown as Effect.Effect<ExecutionContext, never>;
};
