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
import { Effect } from "effect";
import { emitErrorSwallowed, errorTag } from "@reactive-agents/core";
import type { ExecutionContext } from "../../../types.js";
import type { ObsLike } from "../../runtime-context.js";
import { MemoryServiceLogEpisodeTag } from "../../service-tags.js";

export interface InlineObserveDeps {
  readonly pendingCallCount: number;
  readonly obs: ObsLike | null;
  readonly isVerbose: boolean;
}

/**
 * Structural view of a tool-result entry. `c.toolResults` is declared
 * `Schema.Array(Schema.Unknown)` on the ExecutionContext schema, so each
 * element is `unknown`; this names the fields the OBSERVE phase reads instead
 * of scattering `as any` accesses.
 */
interface ToolResultLike {
  readonly toolCallId?: string;
  readonly toolName?: string;
  readonly result?: unknown;
  readonly durationMs?: number;
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
      MemoryServiceLogEpisodeTag,
    ).pipe(
      Effect.catchAll(() =>
        Effect.succeed({ _tag: "None" as const }),
      ),
    );

    if (memOpt._tag === "Some") {
      for (const r of recentResults) {
        const tr = r as ToolResultLike;
        const episodeNow = new Date();
        yield* memOpt.value
          .logEpisode({
            id: crypto.randomUUID().replace(/-/g, ""),
            agentId: c.agentId,
            date: episodeNow.toISOString().slice(0, 10),
            content: `Tool ${tr.toolName}: ${String(tr.result).slice(0, 300)}`,
            taskId: c.taskId,
            eventType: "tool-call",
            createdAt: episodeNow,
            metadata: {
              toolName: tr.toolName,
              durationMs: tr.durationMs ?? 0,
            },
          })
          .pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/engine/phases/agent-loop/inline-observe.ts:log-tool-episode", tag: errorTag(err) })));
      }
    }

    // Verbose: log tool results
    if (obs && isVerbose) {
      for (const r of recentResults) {
        const tr = r as ToolResultLike;
        const rToolName = tr.toolName as string;
        const rResult = tr.result;
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

    const toolResultMessages = recentResults.map((r) => {
      const tr = r as ToolResultLike;
      return {
        role: "tool" as const,
        toolCallId: tr.toolCallId,
        content:
          typeof tr.result === "string"
            ? tr.result
            : JSON.stringify(tr.result),
      };
    });

    // Aggregate sub-agent tokens/cost if present in tool results
    let subAgentTokens = 0;
    let subAgentCost = 0;
    for (const r of recentResults) {
      const res = (r as ToolResultLike).result;
      if (typeof res === "object" && res !== null) {
        const usage = res as { tokensUsed?: number; cost?: number; estimatedCost?: number };
        subAgentTokens += usage.tokensUsed ?? 0;
        subAgentCost += usage.cost ?? usage.estimatedCost ?? 0;
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
