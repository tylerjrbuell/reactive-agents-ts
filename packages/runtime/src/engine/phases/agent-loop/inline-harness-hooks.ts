/**
 * Inline-path post-loop harness hooks (direct-LLM path).
 *
 * Mirror of the reasoning-path harness hooks for when no ReasoningService is
 * available. Uses LLMService directly for retries. Implements:
 *   - withCustomTermination
 *   - withMinIterations
 *   - withVerificationStep ("reflect" mode)
 *   - withOutputValidator
 *
 * Extracted from `execution-engine.ts:2072-2186` (W23 step 6a-1c) to shrink
 * the engine module without changing behavior.
 *
 * Behavior preserved verbatim — error sites (`runtime/src/execution-engine.ts:NNNN`)
 * are intentionally retained for log/diagnostic compatibility with inline-path
 * test files.
 */
import { Context, Effect } from "effect";
import { emitErrorSwallowed, errorTag } from "@reactive-agents/core";
import type { Task } from "@reactive-agents/core";
import type { ExecutionContext, ReactiveAgentsConfig } from "../../../types.js";
import type { ObsLike } from "../../runtime-context.js";
import { extractTaskText } from "../../util.js";

export interface InlineHarnessHooksDeps {
  readonly config: ReactiveAgentsConfig;
  readonly task: Task;
  readonly cacheHit: boolean;
  readonly obs: ObsLike | null;
}

export const runInlineHarnessHooks = (
  initialCtx: ExecutionContext,
  deps: InlineHarnessHooksDeps,
): Effect.Effect<ExecutionContext, never> => {
  const { config, task, cacheHit, obs } = deps;
  return Effect.gen(function* () {
    let ctx = initialCtx;

    const llmHookOpt = yield* Effect.serviceOption(
      Context.GenericTag<{
        complete: (req: unknown) => Effect.Effect<{
          content: string;
          stopReason: string;
          usage?: { totalTokens?: number; estimatedCost?: number };
        }>;
      }>("LLMService"),
    ).pipe(Effect.catchAll(() => Effect.succeed({ _tag: "None" as const })));

    const callLLMForRetry = (messages: readonly { role: string; content: string }[]): Effect.Effect<string | null> =>
      llmHookOpt._tag === "Some"
        ? llmHookOpt.value.complete({
            model: config.defaultModel ?? "test-model",
            messages,
            systemPrompt: config.systemPrompt ?? "You are a helpful AI assistant.",
          }).pipe(
            Effect.map((r: { content: string; usage?: { totalTokens?: number; estimatedCost?: number } }) => {
              ctx = {
                ...ctx,
                tokensUsed: ctx.tokensUsed + (r.usage?.totalTokens ?? 0),
                cost: ctx.cost + (r.usage?.estimatedCost ?? 0),
              };
              return r.content;
            }),
            Effect.catchAll(() => Effect.succeed(null as string | null)),
          )
        : Effect.succeed(null as string | null);

    // withCustomTermination (direct-LLM)
    if (config.customTermination && !cacheHit && llmHookOpt._tag === "Some") {
      const MAX_CUSTOM_RETRIES = 3;
      let customRetries = 0;
      while (customRetries < MAX_CUSTOM_RETRIES) {
        const currentOutput = String(ctx.metadata.lastResponse ?? "");
        if ((config.customTermination as (s: { output: string }) => boolean)({ output: currentOutput })) break;
        customRetries++;
        const newContent = yield* callLLMForRetry([
          { role: "user", content: extractTaskText(task.input) },
          { role: "assistant", content: currentOutput },
          { role: "user", content: "Continue working towards the goal." },
        ]);
        if (newContent !== null) {
          ctx = { ...ctx, metadata: { ...ctx.metadata, lastResponse: newContent } };
        } else {
          break;
        }
      }
    }

    // withMinIterations (direct-LLM)
    // Loop (not a lone `if`) until the required floor is reached — a single
    // retry only ever yields 2 total passes regardless of minIterations. Each
    // continuation counts as one more iteration; itersDone strictly increases
    // so the loop terminates, and a null (failed) retry breaks early.
    if (config.minIterations && !cacheHit && llmHookOpt._tag === "Some") {
      let itersDone = (ctx.iteration - 1);
      while (itersDone < config.minIterations) {
        const newContent = yield* callLLMForRetry([
          { role: "user", content: extractTaskText(task.input) },
          { role: "assistant", content: String(ctx.metadata.lastResponse ?? "") },
          { role: "user", content: "Continue — ensure thoroughness before finalizing." },
        ]);
        if (newContent === null) break;
        ctx = { ...ctx, metadata: { ...ctx.metadata, lastResponse: newContent } };
        itersDone++;
      }
    }

    // withVerificationStep reflect mode (direct-LLM)
    // "loop" mode is not yet implemented — warn and skip.
    if (config.verificationStep && config.verificationStep.mode !== "reflect" && obs) {
      yield* obs.info(`⚠ withVerificationStep: mode "${config.verificationStep.mode}" is not yet implemented — only "reflect" is supported. Skipping verification.`)
        .pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/engine/phases/agent-loop/inline-harness-hooks.ts:verification-mode-warning", tag: errorTag(err) })));
    }
    if (config.verificationStep?.mode === "reflect" && !cacheHit && llmHookOpt._tag === "Some") {
      const outputToVerify = String(ctx.metadata.lastResponse ?? "");
      if (outputToVerify) {
        const verifyPrompt = config.verificationStep.prompt ??
          `Review this output against the task: "${extractTaskText(task.input).slice(0, 300)}"\n\nOutput:\n${outputToVerify.slice(0, 1500)}\n\nRespond PASS if the output fully addresses the task, or REVISE: [specific gap] if not.`;
        const verifyContent = yield* callLLMForRetry([
          { role: "user", content: verifyPrompt },
        ]);
        if (verifyContent !== null) {
          const metaUpdate = verifyContent.startsWith("REVISE")
            ? { verificationFeedback: verifyContent }
            : {};
          ctx = { ...ctx, metadata: { ...ctx.metadata, ...metaUpdate } };
        }
      }
    }

    // withOutputValidator (direct-LLM)
    if (config.outputValidator && !cacheHit && llmHookOpt._tag === "Some") {
      const maxRetries = config.outputValidatorOptions?.maxRetries ?? 2;
      let validatorRetries = 0;
      while (validatorRetries < maxRetries) {
        const currentOutput = String(ctx.metadata.lastResponse ?? "");
        const validation = (config.outputValidator as (o: string) => { valid: boolean; feedback?: string })(currentOutput);
        if (validation.valid) break;
        validatorRetries++;
        const feedback = validation.feedback ?? "The previous response did not meet requirements. Please revise.";
        const newContent = yield* callLLMForRetry([
          { role: "user", content: extractTaskText(task.input) },
          { role: "assistant", content: currentOutput },
          { role: "user", content: feedback },
        ]);
        if (newContent !== null) {
          ctx = { ...ctx, metadata: { ...ctx.metadata, lastResponse: newContent } };
        } else {
          break;
        }
      }
    }

    return ctx;
  }) as unknown as Effect.Effect<ExecutionContext, never>;
};
