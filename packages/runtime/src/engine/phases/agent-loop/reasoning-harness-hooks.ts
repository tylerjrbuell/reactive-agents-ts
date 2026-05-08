/**
 * Reasoning-path post-think harness hooks.
 *
 * Mirror of the inline-path harness hooks (inline-harness-hooks.ts) but routes
 * through ReasoningService.execute(). Implements:
 *   - withCustomTermination
 *   - withMinIterations
 *   - withVerificationStep ("reflect" mode)
 *   - withOutputValidator
 *
 * Extracted from `execution-engine.ts:1352-1600` (W23 step 6a-3) to shrink the
 * engine module without changing behavior.
 *
 * Behavior preserved verbatim — error sites
 * (`runtime/src/execution-engine.ts:NNNN`) are intentionally retained for
 * log/diagnostic compatibility with reasoning-path test files.
 */
import { Effect } from "effect";
import { emitErrorSwallowed, errorTag } from "@reactive-agents/core";
import type { Task } from "@reactive-agents/core";
import type { ModelCalibration } from "@reactive-agents/llm-provider";
import { resolveSynthesisConfigForStrategy } from "../../../synthesis-resolve.js";
import type { ExecutionContext, ReactiveAgentsConfig } from "../../../types.js";
import type { ObsLike } from "../../runtime-context.js";
import {
  briefResolvedSkillsFromMetadata,
  extractTaskText,
  normalizeReasoningResult,
} from "../../util.js";

type ReasoningServiceLike = {
  execute: (req: Record<string, unknown>) => Effect.Effect<unknown, unknown>;
};

export interface ReasoningHarnessHooksDeps {
  readonly config: ReactiveAgentsConfig;
  readonly task: Task;
  readonly cacheHit: boolean;
  readonly reasoningOpt:
    | { readonly _tag: "Some"; readonly value: ReasoningServiceLike }
    | { readonly _tag: "None" };
  readonly availableToolNames: readonly string[];
  readonly availableToolSchemas: readonly unknown[];
  readonly allToolSchemas: readonly unknown[];
  readonly effectiveRequiredTools: unknown;
  readonly effectiveRequiredToolQuantities: unknown;
  readonly classifiedRelevantTools: unknown;
  readonly autoMaxCallsPerTool: Record<string, number>;
  readonly taskCategory: string;
  readonly resolvedCalibration: ModelCalibration | undefined;
  readonly obs: ObsLike | null;
}

export const runReasoningHarnessHooks = (
  initialCtx: ExecutionContext,
  deps: ReasoningHarnessHooksDeps,
): Effect.Effect<ExecutionContext, never> => {
  const {
    config,
    task,
    cacheHit,
    reasoningOpt,
    availableToolNames,
    availableToolSchemas,
    allToolSchemas,
    effectiveRequiredTools,
    effectiveRequiredToolQuantities,
    classifiedRelevantTools,
    autoMaxCallsPerTool,
    taskCategory,
    resolvedCalibration,
    obs,
  } = deps;

  return Effect.gen(function* () {
    let ctx = initialCtx;

    // Common request builder for the three "continue working" style hooks.
    const buildExecuteRequest = (
      initialMessages: readonly { readonly role: "user" | "assistant"; readonly content: string }[],
    ): Record<string, unknown> => ({
      taskDescription: extractTaskText(task.input),
      taskType: task.type,
      memoryContext: String((ctx.metadata as any)?.semanticContext ?? ""),
      availableTools: availableToolNames,
      availableToolSchemas,
      allToolSchemas,
      strategy: ctx.selectedStrategy ?? "reactive",
      contextProfile: config.contextProfile,
      providerName: String(config.provider ?? ""),
      systemPrompt: config.systemPrompt,
      taskId: ctx.taskId,
      resultCompression: config.resultCompression,
      agentId: config.agentId,
      sessionId: ctx.taskId,
      requiredTools: effectiveRequiredTools,
      requiredToolQuantities: effectiveRequiredToolQuantities,
      relevantTools: classifiedRelevantTools,
      maxCallsPerTool: Object.keys(autoMaxCallsPerTool).length > 0 ? autoMaxCallsPerTool : undefined,
      maxRequiredToolRetries: config.requiredTools?.maxRetries,
      modelId: String(config.defaultModel ?? ""),
      taskCategory,
      metaTools: config.metaTools,
      briefResolvedSkills: briefResolvedSkillsFromMetadata(
        ctx.metadata as Record<string, unknown>,
      ),
      initialMessages,
      synthesisConfig: resolveSynthesisConfigForStrategy(
        config.reasoningOptions,
        ctx.selectedStrategy ?? "reactive",
        config.synthesisConfig,
      ),
      observationSummary: config.reasoningOptions?.observationSummary,
      calibration: resolvedCalibration,
    });

    // withCustomTermination: re-run reasoning if predicate not satisfied
    if (config.customTermination && !cacheHit && reasoningOpt._tag === "Some") {
      const MAX_CUSTOM_RETRIES = 3;
      let customRetries = 0;
      while (customRetries < MAX_CUSTOM_RETRIES) {
        const currentOutput = String(ctx.metadata.lastResponse ?? "");
        if ((config.customTermination as (s: { output: string }) => boolean)({ output: currentOutput })) break;
        customRetries++;
        const retryOutcome = yield* Effect.exit(
          reasoningOpt.value.execute(buildExecuteRequest([
            { role: "user" as const, content: extractTaskText(task.input) },
            { role: "assistant" as const, content: currentOutput },
            { role: "user" as const, content: "Continue working towards the goal." },
          ])),
        );
        if (retryOutcome._tag === "Success") {
          const retryResult = normalizeReasoningResult(retryOutcome.value);
          if (!retryResult) break;
          ctx = {
            ...ctx,
            cost: ctx.cost + (retryResult.metadata.cost ?? 0),
            tokensUsed: ctx.tokensUsed + (retryResult.metadata.tokensUsed ?? 0),
            metadata: {
              ...ctx.metadata,
              lastResponse: String(retryResult.output ?? ""),
              reasoningResult: retryResult,
            },
          };
        } else {
          break;
        }
      }
    }

    // withMinIterations: re-run if fewer iterations than required
    if (config.minIterations && !cacheHit && reasoningOpt._tag === "Some") {
      const iterationsDone = ctx.iteration - 1;
      if (iterationsDone < config.minIterations) {
        const continuationOutcome = yield* Effect.exit(
          reasoningOpt.value.execute(buildExecuteRequest([
            { role: "user" as const, content: extractTaskText(task.input) },
            { role: "assistant" as const, content: String(ctx.metadata.lastResponse ?? "") },
            { role: "user" as const, content: "Continue — ensure thoroughness before finalizing." },
          ])),
        );
        if (continuationOutcome._tag === "Success") {
          const contResult = normalizeReasoningResult(continuationOutcome.value);
          if (contResult) {
            ctx = {
              ...ctx,
              cost: ctx.cost + (contResult.metadata.cost ?? 0),
              tokensUsed: ctx.tokensUsed + (contResult.metadata.tokensUsed ?? 0),
              metadata: {
                ...ctx.metadata,
                lastResponse: String(contResult.output ?? ""),
                reasoningResult: contResult,
              },
            };
          }
        }
      }
    }

    // withVerificationStep (reflect mode): one extra LLM call to confirm completeness
    // Note: "loop" mode is not yet implemented — configured but silently ignored with a warning.
    if (config.verificationStep && config.verificationStep.mode !== "reflect" && obs) {
      yield* obs.info(`⚠ withVerificationStep: mode "${config.verificationStep.mode}" is not yet implemented — only "reflect" is supported. Skipping verification.`)
        .pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/execution-engine.ts:1832", tag: errorTag(err) })));
    }
    if (config.verificationStep?.mode === "reflect" && !cacheHit && reasoningOpt._tag === "Some") {
      const outputToVerify = String(ctx.metadata.lastResponse ?? "");
      if (outputToVerify) {
        const verifyPrompt = config.verificationStep.prompt ??
          `Review this output against the task: "${extractTaskText(task.input).slice(0, 300)}"\n\nOutput:\n${outputToVerify.slice(0, 1500)}\n\nRespond PASS if the output fully addresses the task, or REVISE: [specific gap] if not.`;
        const verifyOutcome = yield* Effect.exit(
          reasoningOpt.value.execute({
            taskDescription: verifyPrompt,
            taskType: "analysis",
            memoryContext: "",
            availableTools: [],
            strategy: "reactive",
            contextProfile: config.contextProfile,
            providerName: String(config.provider ?? ""),
            systemPrompt: undefined,
            taskId: ctx.taskId,
            agentId: config.agentId,
            sessionId: ctx.taskId,
            modelId: String(config.defaultModel ?? ""),
            taskCategory,
            initialMessages: [{ role: "user" as const, content: verifyPrompt }],
            synthesisConfig: undefined,
          }),
        );
        if (verifyOutcome._tag === "Success") {
          const v = verifyOutcome.value as { output?: unknown; metadata: { cost?: number; tokensUsed?: number } };
          const verifyContent = String(v.output ?? "");
          const metaUpdate = verifyContent.startsWith("REVISE")
            ? { verificationFeedback: verifyContent }
            : {};
          ctx = {
            ...ctx,
            cost: ctx.cost + (v.metadata.cost ?? 0),
            tokensUsed: ctx.tokensUsed + (v.metadata.tokensUsed ?? 0),
            metadata: { ...ctx.metadata, ...metaUpdate },
          };
        }
      }
    }

    // withOutputValidator: validate output, retry with injected feedback on failure
    if (config.outputValidator && !cacheHit && reasoningOpt._tag === "Some") {
      const maxRetries = (config.outputValidatorOptions?.maxRetries ?? 2);
      let validatorRetries = 0;
      while (validatorRetries < maxRetries) {
        const currentOutput = String(ctx.metadata.lastResponse ?? "");
        const validation = (config.outputValidator as (o: string) => { valid: boolean; feedback?: string })(currentOutput);
        if (validation.valid) break;
        validatorRetries++;
        const feedback = validation.feedback ?? "The previous response did not meet requirements. Please revise.";
        const req = buildExecuteRequest([
          { role: "user" as const, content: extractTaskText(task.input) },
          { role: "assistant" as const, content: currentOutput },
          { role: "user" as const, content: feedback },
        ]);
        // Output-validator path historically omits `calibration` from the request.
        delete (req as Record<string, unknown>).calibration;
        const retryOutcome = yield* Effect.exit(reasoningOpt.value.execute(req));
        if (retryOutcome._tag === "Success") {
          const retryResult = normalizeReasoningResult(retryOutcome.value);
          if (!retryResult) break;
          ctx = {
            ...ctx,
            cost: ctx.cost + (retryResult.metadata.cost ?? 0),
            tokensUsed: ctx.tokensUsed + (retryResult.metadata.tokensUsed ?? 0),
            metadata: {
              ...ctx.metadata,
              lastResponse: String(retryResult.output ?? ""),
              reasoningResult: retryResult,
            },
          };
        } else {
          break;
        }
      }
    }

    return ctx;
  }) as unknown as Effect.Effect<ExecutionContext, never>;
};
