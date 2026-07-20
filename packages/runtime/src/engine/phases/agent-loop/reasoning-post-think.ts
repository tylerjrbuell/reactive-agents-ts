/**
 * Reasoning-path post-think bookkeeping.
 *
 * Runs after the reasoning THINK and the post-think harness hooks. Owns:
 *   - Log think summary (steps / tokens / duration / strategy at normal verbosity)
 *   - Bridge reasoning path → episodic memory (logEpisode for the task+result
 *     and any reflexion critiques, since ReasoningService.execute handles
 *     tools internally and the inline path's logEpisode never fires)
 *   - Record experience for cross-agent learning
 *   - Fire synthetic "act" + "observe" lifecycle hooks if reasoning used tools
 *   - Update iteration count from reasoning steps
 *   - Semantic cache store (cache the final response keyed by task text)
 *
 * Extracted from `execution-engine.ts:1170-1353` (W23 step 6a-5) to shrink
 * the engine module without changing behavior.
 *
 * The synthetic act/observe lifecycle hooks need access to the engine's
 * `guardedPhase` wrapper (kill-switch + before/after hooks). Rather than
 * duplicate that logic, callers pass a `fireActObserveHooks` callback that
 * runs both phases through the engine's guardedPhase wrapper.
 */
import { Context, Effect } from "effect";
import { emitErrorSwallowed, errorTag } from "@reactive-agents/core";
import type { Task } from "@reactive-agents/core";
import { CostService } from "@reactive-agents/cost";
import type { ExecutionContext, ReactiveAgentsConfig } from "../../../types.js";
import type { ObsLike } from "../../runtime-context.js";
import { extractTaskText } from "../../util.js";
import { MemoryServiceLogEpisodeTag } from "../../service-tags.js";

export interface ReasoningPostThinkDeps {
  readonly config: ReactiveAgentsConfig;
  readonly task: Task;
  readonly obs: ObsLike | null;
  readonly isNormal: boolean;
  /**
   * Fire synthetic act + observe lifecycle hooks via the engine's guardedPhase
   * wrapper. The body of each phase passes ctx through unchanged — the goal is
   * to trigger user-supplied lifecycle hooks (e.g. .withHook({ phase: "act" }))
   * with visibility into the synthesized tool calls. Caller is responsible for
   * routing through the lifecycle-checked guardedPhase wrapper.
   */
  readonly fireActObserveHooks: (ctx: ExecutionContext) => Effect.Effect<ExecutionContext, never>;
}

export const runReasoningPostThink = (
  initialCtx: ExecutionContext,
  deps: ReasoningPostThinkDeps,
): Effect.Effect<ExecutionContext, never> => {
  const { config, task, obs, isNormal, fireActObserveHooks } = deps;
  return Effect.gen(function* () {
    let ctx = initialCtx;

    // ── Log think summary ──
    if (obs && isNormal) {
      const thinkResult = ctx.metadata.reasoningResult;
      const stepsCount = ctx.metadata.stepsCount ?? 0;
      const tokTot = ctx.tokensUsed;
      const thinkMs = thinkResult?.metadata?.duration ?? 0;
      // Show adaptive sub-strategy: thinkResult.strategy stays "adaptive",
      // ctx.selectedStrategy is what actually ran (e.g. "reactive").
      const entryStrat = thinkResult?.strategy;
      const activeStrat = ctx.selectedStrategy ?? entryStrat ?? "";
      const stratSuffix = (entryStrat === "adaptive" && activeStrat !== "adaptive")
        ? ` (adaptive→${activeStrat})`
        : "";
      yield* obs.info(`◉ [think]      ${stepsCount} steps | ${tokTot.toLocaleString()} tok | ${(thinkMs / 1000).toFixed(1)}s${stratSuffix}`)
        .pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/engine/phases/agent-loop/reasoning-post-think.ts:log-think-summary", tag: errorTag(err) })));
    }

    // ── Bridge reasoning path → episodic memory ──
    // The direct-LLM path logs via logEpisode() inline, but the reasoning
    // path (ReasoningService.execute) handles tools internally and never
    // reaches those code paths. Log the task+result here so bootstrap()
    // can surface prior runs on the next invocation.
    {
      const thinkRes = ctx.metadata.reasoningResult;
      if (thinkRes?.output) {
        const memBridge = yield* Effect.serviceOption(
          MemoryServiceLogEpisodeTag,
        ).pipe(Effect.catchAll(() => Effect.succeed({ _tag: "None" as const })));
        if (memBridge._tag === "Some") {
          const epNow = new Date();
          const durationMs = Date.now() - ctx.startedAt.getTime();
          const success = thinkRes.status === "completed";
          const strategyUsed = thinkRes.strategy ?? ctx.selectedStrategy ?? "unknown";

          yield* memBridge.value.logEpisode({
            id: crypto.randomUUID().replace(/-/g, ""),
            agentId: ctx.agentId,
            date: epNow.toISOString().slice(0, 10),
            content: `Task: ${String(task.input).slice(0, 200)} → ${String(thinkRes.output).slice(0, 300)}`,
            taskId: ctx.taskId,
            eventType: config.enableSelfImprovement ? "strategy-outcome" : "task-completed",
            createdAt: epNow,
            metadata: {
              steps: ctx.metadata.stepsCount ?? 0,
              tokensUsed: ctx.tokensUsed,
              strategy: strategyUsed,
              success,
              durationMs,
              ...(config.enableSelfImprovement ? {
                selfImprovement: true,
                taskDescription: String(task.input).slice(0, 500),
                taskType: task.type,
              } : {}),
            },
          }).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/engine/phases/agent-loop/reasoning-post-think.ts:log-task-episode", tag: errorTag(err) })));

          // ── Persist reflexion critiques for cross-run learning ──
          const reflexionCritiques = thinkRes.metadata?.reflexionCritiques;
          if (Array.isArray(reflexionCritiques) && reflexionCritiques.length > 0) {
            yield* memBridge.value.logEpisode({
              id: crypto.randomUUID().replace(/-/g, ""),
              agentId: ctx.agentId,
              date: epNow.toISOString().slice(0, 10),
              content: `Reflexion critiques for ${task.type}: ${reflexionCritiques.join(" | ")}`,
              taskId: ctx.taskId,
              eventType: "reflexion-critique",
              createdAt: epNow,
              tags: ["reflexion", "critique", task.type],
              metadata: {
                strategy: strategyUsed,
                critiqueCount: reflexionCritiques.length,
                taskDescription: String(task.input).slice(0, 500),
              },
            }).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/engine/phases/agent-loop/reasoning-post-think.ts:log-reflexion-critique", tag: errorTag(err) })));
          }
        }
      }
    }

    // ── Record experience for cross-agent learning ──
    if (config.enableExperienceLearning) {
      const expRecOpt = yield* Effect.serviceOption(
        Context.GenericTag<{
          record: (entry: unknown) => Effect.Effect<void>;
        }>("ExperienceStore"),
      ).pipe(Effect.catchAll(() => Effect.succeed({ _tag: "None" as const })));

      if (expRecOpt._tag === "Some") {
        const reasoningStepsForExp = ctx.metadata.reasoningSteps ?? [];
        const toolsFromSteps = reasoningStepsForExp
          .filter(s => s.type === "action")
          .map(s => s.metadata?.toolUsed ?? "unknown")
          .filter((t, i, arr) => arr.indexOf(t) === i && t !== "unknown"); // unique, drop unknowns

        yield* expRecOpt.value.record({
          agentId: ctx.agentId,
          taskDescription: extractTaskText(task.input),
          taskType: task.type ?? "general",
          toolsUsed: toolsFromSteps,
          success: ctx.metadata.reasoningResult?.status === "completed",
          totalSteps: ctx.metadata.stepsCount ?? 0,
          totalTokens: ctx.tokensUsed,
          errors: [],
          modelTier: config.contextProfile?.tier ?? "mid",
        }).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/engine/phases/agent-loop/reasoning-post-think.ts:record-experience", tag: errorTag(err) })));
      }
    }

    // ── Fire "act" + "observe" phases if reasoning used tools ──
    // Extract action steps from the reasoning result so hooks
    // (e.g. .withHook({ phase: "act" })) have visibility into tool calls.
    const reasoningSteps = ctx.metadata.reasoningSteps ?? [];
    const actionSteps = reasoningSteps.filter((s) => s.type === "action");

    if (actionSteps.length > 0) {
      // Log act phase summary at normal verbosity
      if (obs && isNormal) {
        const toolsUsed = actionSteps
          .map((s) => s.metadata?.toolUsed ?? s.content.split("(")[0]?.trim() ?? "?")
          .join(", ");
        yield* obs.info(`◉ [act]        ${toolsUsed} (${actionSteps.length} tools)`)
          .pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/engine/phases/agent-loop/reasoning-post-think.ts:log-act-summary", tag: errorTag(err) })));
      }

      const syntheticToolResults = actionSteps.map((s) => {
        const actionIdx = reasoningSteps.indexOf(s);
        const nextStep = actionIdx >= 0 ? reasoningSteps[actionIdx + 1] : undefined;
        const isObservation = nextStep?.type === "observation";
        const success = isObservation
          ? (nextStep!.metadata?.observationResult?.success ?? true)
          : true;
        // #44 (2026-07-20): the kernel path emits tool calls as an `action`
        // step FOLLOWED BY the tool result as an `observation` step. The
        // synthetic tool-result must carry the OBSERVATION content (the actual
        // tool output) — not `s.content` (the `toolName(args)` CALL text) —
        // so the engine's memory-flush extractor sees the kernel path's real
        // tool results (`memory-flush.ts:184` reads `tr.result`). Falls back to
        // the action content only when no paired observation step exists.
        return {
          toolName: s.metadata?.toolUsed ?? s.content.split("(")[0]?.trim() ?? "unknown",
          toolCallId: s.id,
          result: isObservation ? nextStep!.content : s.content,
          durationMs: s.metadata?.duration ?? 0,
          success,
        };
      });

      ctx = { ...ctx, toolResults: syntheticToolResults };

      // Tool metrics are now recorded via KernelHooks.onObservation → ToolCallCompleted
      // EventBus events. MetricsCollector auto-subscribes to these events.
      // (Previously duplicated here via obs.recordHistogram — removed to fix double counting.)

      ctx = yield* fireActObserveHooks(ctx);
    }

    // Update iteration to reflect actual reasoning steps
    ctx = {
      ...ctx,
      iteration: ctx.metadata.stepsCount ?? 1,
    };

    // ── Semantic cache store (after successful reasoning) ──
    if (config.enableCostTracking && ctx.metadata.lastResponse) {
      const costOpt2 = yield* Effect.serviceOption(CostService).pipe(
        Effect.catchAll(() => Effect.succeed({ _tag: "None" as const })),
      );
      if (costOpt2._tag === "Some") {
        yield* costOpt2.value
          .cacheResponse(
            extractTaskText(task.input),
            String(ctx.metadata.lastResponse),
            String(ctx.selectedModel ?? "unknown"),
          )
          .pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/engine/phases/agent-loop/reasoning-post-think.ts:cache-response", tag: errorTag(err) })));
      }
    }

    return ctx;
  }) as unknown as Effect.Effect<ExecutionContext, never>;
};
