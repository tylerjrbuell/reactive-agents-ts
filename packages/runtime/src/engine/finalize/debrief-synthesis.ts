/**
 * Debrief synthesis block.
 *
 * Owns: FinalAnswerProduced event emission, tool-stat aggregation,
 * errorsFromLoop collection, synthesizeDebrief() call, DebriefCompleted
 * event publication, and DebriefStoreService persistence.
 *
 * Split (2026-06-12, debrief-off-critical-path) into:
 *   - `prepareDebrief`  — CHEAP, synchronous signals: tool stats, errorsFromLoop,
 *     executionDurationMs, the DebriefInput, and the deterministic fallback
 *     debrief. Emits FinalAnswerProduced. Stays on the critical path (the
 *     fallback populates `result.debrief` instantly).
 *   - `finalizeDebriefBackground` — EXPENSIVE: the LLM `synthesizeDebrief` call
 *     (non-trivial + memory + LLM), then DebriefCompleted + DebriefStore.save.
 *     The engine `Effect.forkDaemon`s this so it never blocks `run()`'s return
 *     (measured 4.7s / 48% of a frontier run, ~6s local — GH #143).
 *   - `synthesizeAndStoreDebrief` — the original sequential composition (prepare
 *     then finalize), preserved for callers/tests that want the awaited result.
 *
 * All side-effects are wrapped with Effect.catchAll so errors never propagate.
 *
 * Lifted from execution-engine.ts post-W23-6a-8 (2358-LOC checkpoint).
 */
import { Effect } from "effect";
import type { ExecutionContext, ReactiveAgentsConfig } from "../../types.js";
import type { Task } from "@reactive-agents/core";
import { emitErrorSwallowed, emitLoadBearingFailure, errorTag } from "@reactive-agents/core";
import { LLMService } from "@reactive-agents/llm-provider";
import {
  synthesizeDebrief,
  buildFallbackDebrief,
  type DebriefInput,
  type AgentDebrief,
} from "../../debrief.js";
import { DebriefStoreService } from "@reactive-agents/memory";
import type { AgentDebriefShape } from "@reactive-agents/memory";
import { extractTaskText } from "../util.js";
import type { EbLike } from "../runtime-context.js";

// ─── Types ────────────────────────────────────────────────────────────────────

/** Shape of the reasoning result stored in ctx.metadata.reasoningResult. */
type RrLike =
  | {
      output?: unknown;
      status?: string;
      metadata?: {
        confidence?: number;
        strategyFallback?: boolean;
        terminatedBy?: string;
        finalAnswerCapture?: unknown;
        llmCalls?: number;
      };
    }
  | undefined;

/** Single entry in the tool-call log collected by the ToolCallCompleted listener. */
type ToolCallEntry = {
  readonly toolName: string;
  readonly durationMs: number;
  readonly success: boolean;
  readonly iteration: number;
};

export interface DebriefSynthesisDeps {
  readonly ctx: ExecutionContext;
  readonly task: Task;
  readonly config: ReactiveAgentsConfig;
  readonly eb: EbLike | null;
  readonly rr: RrLike;
  readonly terminatedByRaw: "final_answer_tool" | "final_answer" | "max_iterations" | "end_turn" | "llm_error";
  readonly sanitizedOutput: unknown;
  readonly outputForSuccess: string;
  readonly hasSubstantiveOutput: boolean;
  readonly toolCallLog: readonly ToolCallEntry[];
  readonly rationaleLog?: readonly {
    readonly iteration: number;
    readonly decision: string;
    readonly toolName?: string;
    readonly rationale: { readonly why: string; readonly refs?: readonly string[]; readonly confidence?: number };
  }[];
}

/**
 * Output of `prepareDebrief` — the cheap, synchronous signals plus the
 * deterministic fallback. `fallbackDebrief` is undefined only when no debrief
 * should be produced at all (non-reasoning path or memory disabled).
 */
export interface PreparedDebrief {
  readonly debriefInput: DebriefInput;
  readonly fallbackDebrief: AgentDebrief | undefined;
  readonly errorsFromLoop: readonly string[];
  readonly executionDurationMs: number;
  /** rr present AND memory enabled — a debrief (fallback at minimum) is produced + persisted. */
  readonly shouldFinalize: boolean;
  /** shouldFinalize AND the task is non-trivial — the (forkable) LLM call is warranted. */
  readonly shouldSynthesizeLLM: boolean;
}

export interface DebriefSynthesisResult {
  readonly debrief: AgentDebrief | undefined;
  readonly errorsFromLoop: readonly string[];
  readonly executionDurationMs: number;
  /**
   * Tokens consumed by the debrief LLM call. Zero when the synthetic-fallback
   * path was taken (trivial task, LLM unavailable, or memory disabled). The
   * caller is expected to add this to `ctx.tokensUsed` before TaskResult
   * assembly so bench metrics reflect real LLM consumption (GH #143).
   */
  readonly debriefTokensUsed: number;
}

// ─── prepareDebrief (cheap, critical-path) ──────────────────────────────────────

/**
 * Compute the deterministic debrief signals + fallback. No LLM call. Emits
 * FinalAnswerProduced (needed for streaming consumers). Cheap enough to stay on
 * the critical path; its `fallbackDebrief` populates `result.debrief` instantly.
 */
export const prepareDebrief = (
  deps: DebriefSynthesisDeps,
): Effect.Effect<PreparedDebrief, never> => {
  const { ctx, task, config, eb, rr, terminatedByRaw, sanitizedOutput, outputForSuccess, hasSubstantiveOutput, toolCallLog, rationaleLog } = deps;

  return Effect.gen(function* () {
    // Publish FinalAnswerProduced event when final-answer tool is called
    if (terminatedByRaw === "final_answer_tool" && eb) {
      const capture = rr?.metadata?.finalAnswerCapture as { output?: unknown } | undefined;
      const rawAnswer = capture?.output ?? sanitizedOutput ?? "";
      const answer = typeof rawAnswer === "string" ? rawAnswer : String(rawAnswer);
      yield* eb.publish({
        _tag: "FinalAnswerProduced",
        taskId: ctx.taskId,
        strategy: ctx.selectedStrategy ?? "unknown",
        answer,
        iteration: ctx.iteration,
        totalTokens: ctx.tokensUsed,
      }).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/engine/finalize/debrief-synthesis.ts:final-answer-produced-publish", tag: errorTag(err) })));
    }

    // Collect tool stats from ToolCallCompleted events (deterministic,
    // works across all strategies including plan-execute composite steps)
    const toolStatsMap = new Map<string, { calls: number; errors: number; totalDurationMs: number }>();
    for (const tc of toolCallLog) {
      const existing = toolStatsMap.get(tc.toolName) ?? { calls: 0, errors: 0, totalDurationMs: 0 };
      toolStatsMap.set(tc.toolName, {
        calls: existing.calls + 1,
        errors: existing.errors + (tc.success ? 0 : 1),
        totalDurationMs: existing.totalDurationMs + tc.durationMs,
      });
    }
    const toolCallHistory: DebriefInput["toolCallHistory"] = Array.from(toolStatsMap.entries()).map(
      ([name, stat]) => ({
        name,
        calls: stat.calls,
        errors: stat.errors,
        avgDurationMs: stat.calls > 0 ? Math.round(stat.totalDurationMs / stat.calls) : 0,
      }),
    );

    // Collect errors from tool call log + reasoning step observations
    const errorsFromLoop: string[] = [];
    for (const tc of toolCallLog) {
      if (!tc.success) errorsFromLoop.push(`Tool ${tc.toolName} failed`);
    }
    const rrSteps = ctx.metadata.reasoningSteps ?? [];
    for (const step of rrSteps) {
      if (step.type === "observation") {
        const content = step.content ?? "";
        const match = content.match(/\[Tool error: ([^\]]+)\]/);
        if (match?.[1]) errorsFromLoop.push(match[1]);
      }
    }

    const executionDurationMs = Date.now() - ctx.startedAt.getTime();

    const debriefInput: DebriefInput = {
      taskPrompt: extractTaskText(task.input),
      agentId: ctx.agentId,
      taskId: ctx.taskId,
      terminatedBy: terminatedByRaw,
      finalAnswerCapture: rr?.metadata?.finalAnswerCapture as DebriefInput["finalAnswerCapture"],
      finalOutputText: hasSubstantiveOutput ? outputForSuccess : undefined,
      toolCallHistory,
      errorsFromLoop,
      metrics: {
        tokens: ctx.tokensUsed,
        duration: executionDurationMs,
        iterations: ctx.iteration,
        cost: ctx.cost,
      },
      rationale: rationaleLog,
    };

    // GH #143 / Lever 7 trivial-task gate — skip the LLM debrief call when
    // the captured signals are simple enough that the fallback synthesizer
    // can reconstruct an equivalent record. On local tier (qwen3.5:latest)
    // the LLM debrief failed 52% of the time anyway (hit max_tokens, returned
    // empty content), and bench evidence showed it burned ~825 tok and ~6 s
    // per task uncounted.
    //
    // Conditions:
    //  - outputForSuccess.length < 100  — short answer, fallback handles it
    //  - errorsFromLoop.length === 0    — no error narrative for the LLM
    const isTrivialForDebrief =
      outputForSuccess.length < 100 &&
      errorsFromLoop.length === 0;

    // Cost honesty (v0.12) — tier-aware debrief skip. The rich LLM synthesis is
    // the single largest per-run overhead; on the local tier it failed ~52% of
    // the time (max_tokens / empty content) while burning ~825 tok + ~6s per
    // task (GH #143). Local runs keep the deterministic fallback record but skip
    // the LLM call entirely. Mid/large tiers retain full synthesis.
    const isLocalTier = config.contextProfile?.tier === "local";

    // Gated on BOTH: rr !== undefined (reasoning path was used) AND
    // config.enableMemory (user opted in with .withMemory()). Skipped otherwise
    // to avoid injecting extra LLM calls in direct-LLM path tests and non-memory
    // configurations.
    const shouldFinalize = rr !== undefined && config.enableMemory === true;
    const shouldSynthesizeLLM = shouldFinalize && !isTrivialForDebrief && !isLocalTier;

    const fallbackDebrief = shouldFinalize ? buildFallbackDebrief(debriefInput) : undefined;

    return {
      debriefInput,
      fallbackDebrief,
      errorsFromLoop,
      executionDurationMs,
      shouldFinalize,
      shouldSynthesizeLLM,
    } satisfies PreparedDebrief;
  });
};

// ─── finalizeDebriefBackground (expensive, forkable) ────────────────────────────

/**
 * Produce the FINAL debrief — the LLM-synthesized rich version when warranted,
 * else the deterministic fallback — then emit DebriefCompleted and persist to
 * DebriefStore. The engine `Effect.forkDaemon`s this so it never blocks the
 * answer's return. Returns the rich debrief + the LLM tokens it consumed.
 *
 * No-ops to `{ debrief: undefined, tokensUsed: 0 }` when `prepared.shouldFinalize`
 * is false (non-reasoning path / memory off), matching pre-split behavior.
 */
export const finalizeDebriefBackground = (
  deps: DebriefSynthesisDeps,
  prepared: PreparedDebrief,
): Effect.Effect<{ debrief: AgentDebrief | undefined; tokensUsed: number }, never> => {
  const { ctx, task, eb, terminatedByRaw, sanitizedOutput } = deps;
  const { debriefInput, fallbackDebrief, shouldFinalize, shouldSynthesizeLLM } = prepared;

  return Effect.gen(function* () {
    if (!shouldFinalize) {
      return { debrief: undefined as AgentDebrief | undefined, tokensUsed: 0 };
    }

    // Resolve the final debrief: rich LLM synthesis when non-trivial + LLM
    // available, else the deterministic fallback (always available).
    const debriefAndTokens: { debrief: AgentDebrief | undefined; tokensUsed: number } =
      yield* (shouldSynthesizeLLM
        ? Effect.serviceOption(LLMService).pipe(
            Effect.flatMap((llmOpt) => {
              if (llmOpt._tag !== "Some") {
                return Effect.succeed({ debrief: fallbackDebrief, tokensUsed: 0 });
              }
              return synthesizeDebrief(debriefInput).pipe(
                Effect.provideService(LLMService, llmOpt.value),
                Effect.map((result) => ({ debrief: (result.debrief as AgentDebrief | undefined) ?? fallbackDebrief, tokensUsed: result.tokensUsed })),
                // On LLM failure fall back to the deterministic debrief so the
                // store + event always see a record (was `undefined` pre-split).
                Effect.catchAll(() => Effect.succeed({ debrief: fallbackDebrief, tokensUsed: 0 })),
              );
            }),
            Effect.catchAll(() => Effect.succeed({ debrief: fallbackDebrief, tokensUsed: 0 })),
          )
        : Effect.succeed({ debrief: fallbackDebrief, tokensUsed: 0 }));

    const { debrief, tokensUsed } = debriefAndTokens;

    // Publish DebriefCompleted from a single site so all paths emit consistently.
    if (debrief !== undefined && eb) {
      yield* eb
        .publish({
          _tag: "DebriefCompleted",
          taskId: debriefInput.taskId,
          agentId: debriefInput.agentId,
          debrief,
        })
        .pipe(
          Effect.catchAll((err) =>
            emitErrorSwallowed({
              site: "runtime/src/engine/finalize/debrief-synthesis.ts:debrief-completed-publish",
              tag: errorTag(err),
            }),
          ),
        );
    }

    // Persist debrief if DebriefStoreService is available
    if (debrief !== undefined) {
      yield* Effect.serviceOption(DebriefStoreService).pipe(
        Effect.flatMap((storeOpt) => {
          if (storeOpt._tag !== "Some") return Effect.void;
          return storeOpt.value.save({
            taskId: ctx.taskId,
            agentId: ctx.agentId,
            taskPrompt: extractTaskText(task.input),
            terminatedBy: terminatedByRaw,
            output: String(sanitizedOutput ?? ""),
            outputFormat: "text",
            debrief: debrief as unknown as AgentDebriefShape,
          }).pipe(
            Effect.catchAll((err) =>
              emitLoadBearingFailure({
                capability: "debrief-persistence",
                site: "runtime/src/engine/finalize/debrief-synthesis.ts:debrief-store-save",
                tag: errorTag(err),
                entityId: ctx.taskId,
                message: err instanceof Error ? err.message : String(err),
              }),
            ),
          );
        }),
        Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/engine/finalize/debrief-synthesis.ts:debrief-store-resolve", tag: errorTag(err) })),
      );
    }

    return { debrief, tokensUsed };
  });
};

// ─── synthesizeAndStoreDebrief (sequential composition — awaited) ────────────────

/**
 * Original awaited composition: prepare then finalize, in sequence. Preserved
 * for callers/tests that want the debrief computed + persisted before the Effect
 * completes. The execution engine no longer uses this on the hot path — it calls
 * `prepareDebrief` inline and `forkDaemon`s `finalizeDebriefBackground`.
 */
export const synthesizeAndStoreDebrief = (
  deps: DebriefSynthesisDeps,
): Effect.Effect<DebriefSynthesisResult, never> =>
  Effect.gen(function* () {
    const prepared = yield* prepareDebrief(deps);
    const { debrief, tokensUsed } = yield* finalizeDebriefBackground(deps, prepared);
    return {
      debrief,
      errorsFromLoop: prepared.errorsFromLoop,
      executionDurationMs: prepared.executionDurationMs,
      debriefTokensUsed: tokensUsed,
    } satisfies DebriefSynthesisResult;
  });
