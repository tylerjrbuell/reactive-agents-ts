/**
 * Debrief synthesis block.
 *
 * Owns: FinalAnswerProduced event emission, tool-stat aggregation,
 * errorsFromLoop collection, synthesizeDebrief() call, DebriefCompleted
 * event publication, and DebriefStoreService persistence.
 *
 * Returns the produced debrief (or undefined), the errorsFromLoop array
 * (consumed by T4 telemetry), and executionDurationMs (consumed by result
 * assembly). All side-effects are wrapped with Effect.catchAll so errors
 * never propagate to the caller.
 *
 * Lifted from execution-engine.ts post-W23-6a-8 (2358-LOC checkpoint).
 */
import { Effect } from "effect";
import type { ExecutionContext, ReactiveAgentsConfig } from "../../types.js";
import type { Task } from "@reactive-agents/core";
import { emitErrorSwallowed, emitLoadBearingFailure, errorTag } from "@reactive-agents/core";
import { LLMService } from "@reactive-agents/llm-provider";
import { synthesizeDebrief, type DebriefInput, type AgentDebrief } from "../../debrief.js";
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

export interface DebriefSynthesisResult {
  readonly debrief: AgentDebrief | undefined;
  readonly errorsFromLoop: readonly string[];
  readonly executionDurationMs: number;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export const synthesizeAndStoreDebrief = (
  deps: DebriefSynthesisDeps,
): Effect.Effect<DebriefSynthesisResult, never> => {
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

    // Synthesize debrief (best-effort, only on the reasoning path with memory enabled).
    // Gated on:
    //   1. rr !== undefined (reasoning path was used)
    //   2. config.enableMemory (user opted in with .withMemory())
    //   3. ctx.metadata.taskComplexity !== "trivial" (HONEST GATE — MOVE-3
    //      Phase 1, GH #143). memory-flush-dispatch sets taskComplexity at
    //      `runtime/engine/phases/memory-flush-dispatch.ts:42` BEFORE this
    //      phase runs (`execution-engine.ts:976 → :1070`). Trivial tasks
    //      (iter≤1 + zero tool calls + no max-iter termination) burn ~825
    //      tok/call on local tier with 47% hitting max_tokens (#143 evidence);
    //      synthesizeDebrief fallback at `debrief.ts:222` already constructs
    //      a deterministic debrief from captured signals — the LLM call adds
    //      no information. Pre-existing comment on this gate had aspired to
    //      "skip trivial AND moderate" but the actual code had no complexity
    //      check at all. This commit makes the code match a conservative
    //      version of the aspiration (trivial-only) and leaves moderate
    //      reachable for users who want richer post-mortems on tool runs.
    const isTrivialTask = ctx.metadata.taskComplexity === "trivial";
    const debrief: AgentDebrief | undefined = yield* (rr !== undefined && config.enableMemory && !isTrivialTask
      ? Effect.serviceOption(LLMService).pipe(
          Effect.flatMap((llmOpt) => {
            if (llmOpt._tag !== "Some") return Effect.succeed(undefined as AgentDebrief | undefined);
            // Provide the resolved LLMService back so synthesizeDebrief's R is discharged here.
            return synthesizeDebrief(debriefInput).pipe(
              Effect.provideService(LLMService, llmOpt.value),
              Effect.flatMap((d) => {
                const debrief = d as AgentDebrief;
                if (!eb) {
                  return Effect.succeed(debrief);
                }
                return eb.publish({
                  _tag: "DebriefCompleted",
                  taskId: debriefInput.taskId,
                  agentId: debriefInput.agentId,
                  debrief,
                }).pipe(
                  Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/engine/finalize/debrief-synthesis.ts:debrief-completed-publish", tag: errorTag(err) })),
                  Effect.as(debrief),
                );
              }),
              Effect.catchAll(() => Effect.succeed(undefined as AgentDebrief | undefined)),
            );
          }),
          Effect.catchAll(() => Effect.succeed(undefined as AgentDebrief | undefined)),
        )
      : Effect.succeed(undefined as AgentDebrief | undefined));

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

    return { debrief, errorsFromLoop, executionDurationMs } satisfies DebriefSynthesisResult;
  });
};
