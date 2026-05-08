/**
 * Inline-path OBSERVE phase: appends tool-result messages to context, logs
 * episodic memories (H5), aggregates sub-agent token/cost usage, and emits
 * verbose tool-result diagnostics.
 *
 * Body of the `guardedPhase(ctx, "observe", ...)` invocation inside the inline
 * agent loop. Extracted from `execution-engine.ts:2159-2257` (W23 step 6a-1b)
 * to shrink the engine module without changing behavior.
 *
 * Behavior preserved verbatim — error sites (`runtime/src/execution-engine.ts:NNNN`)
 * are intentionally retained for log/diagnostic compatibility with the inline-path
 * test files.
 */
import { Context, Effect } from "effect";
import { emitErrorSwallowed, errorTag } from "@reactive-agents/core";
import type { ExecutionContext } from "../../../types.js";
import type { ObsLike } from "../../runtime-context.js";

export interface InlineObserveDeps {
  readonly pendingCallCount: number;
  readonly obs: ObsLike | null;
  readonly isVerbose: boolean;
}

export const runInlineObserve = (
  c: ExecutionContext,
  deps: InlineObserveDeps,
): Effect.Effect<ExecutionContext, never> => {
  const { pendingCallCount, obs, isVerbose } = deps;
  return Effect.gen(function* () {
    const recentResults = c.toolResults.slice(-pendingCallCount);

    // H5: Log tool results as episodic memory items
    const memOpt = yield* Effect.serviceOption(
      Context.GenericTag<{
        logEpisode: (episode: unknown) => Effect.Effect<void>;
      }>("MemoryService"),
    ).pipe(
      Effect.catchAll(() =>
        Effect.succeed({ _tag: "None" as const }),
      ),
    );

    if (memOpt._tag === "Some") {
      for (const r of recentResults) {
        const episodeNow = new Date();
        yield* memOpt.value
          .logEpisode({
            id: crypto.randomUUID().replace(/-/g, ""),
            agentId: c.agentId,
            date: episodeNow.toISOString().slice(0, 10),
            content: `Tool ${(r as any).toolName}: ${String((r as any).result).slice(0, 300)}`,
            taskId: c.taskId,
            eventType: "tool-call",
            createdAt: episodeNow,
            metadata: {
              toolName: (r as any).toolName,
              durationMs: (r as any).durationMs ?? 0,
            },
          } as any)
          .pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/engine/phases/agent-loop/inline-observe.ts:log-tool-episode", tag: errorTag(err) })));
      }
    }

    // Verbose: log tool results
    if (obs && isVerbose) {
      for (const r of recentResults) {
        const rToolName = (r as any).toolName as string;
        const rResult = (r as any).result;
        const isAgentDelegate =
          rToolName === "spawn-agent" ||
          rToolName.startsWith("agent-");
        if (isAgentDelegate && typeof rResult === "object" && rResult !== null) {
          const sub = rResult as { subAgentName?: string; success?: boolean; summary?: string; tokensUsed?: number };
          const subIcon = sub.success ? "✓" : "✗";
          const subName = sub.subAgentName ?? rToolName;
          const subSummary = String(sub.summary ?? "").slice(0, 150);
          const subTok = sub.tokensUsed ?? 0;
          yield* obs.info(
            `  ◉ [sub-agent: ${subName}] ${subIcon} ${subTok} tok | "${subSummary}"`,
          ).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/engine/phases/agent-loop/inline-observe.ts:log-sub-agent-verbose", tag: errorTag(err) })));
        } else {
          const resultStr = typeof rResult === "string"
            ? rResult
            : JSON.stringify(rResult);
          const preview = resultStr.length > 120 ? resultStr.slice(0, 120) + "..." : resultStr;
          const charCount = resultStr.length;
          yield* obs.debug(
            `  ┄ [obs]    ${rToolName}: ${preview} [${charCount} chars]`,
          ).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/engine/phases/agent-loop/inline-observe.ts:log-tool-result-verbose", tag: errorTag(err) })));
        }
      }
    }

    const toolResultMessages = recentResults.map(
      (r: any) => ({
        role: "tool" as const,
        toolCallId: r.toolCallId,
        content:
          typeof r.result === "string"
            ? r.result
            : JSON.stringify(r.result),
      }),
    );

    // Aggregate sub-agent tokens/cost if present in tool results
    let subAgentTokens = 0;
    let subAgentCost = 0;
    for (const r of recentResults) {
      const res = (r as any).result;
      if (typeof res === "object" && res !== null) {
        subAgentTokens += (res as any).tokensUsed ?? 0;
        subAgentCost += (res as any).cost ?? (res as any).estimatedCost ?? 0;
      }
    }

    return {
      ...c,
      messages: [...c.messages, ...toolResultMessages],
      tokensUsed: c.tokensUsed + subAgentTokens,
      cost: c.cost + subAgentCost,
      iteration: c.iteration + 1,
    };
  }) as unknown as Effect.Effect<ExecutionContext, never>;
};
