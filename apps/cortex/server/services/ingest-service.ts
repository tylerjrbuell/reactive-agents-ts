import { Context, Effect, Layer } from "effect";
import type { Database } from "bun:sqlite";
import type { AgentEvent } from "@reactive-agents/core";
import {
  insertEvent,
  getRunAgentId,
  upsertRun,
  updateRunStats,
  getNextSeq,
} from "../db/queries.js";
import { enforceRetention } from "../db/schema.js";
import { CortexEventBridge } from "./event-bridge.js";
import type { CortexIngestMessage, CortexLiveMessage } from "../types.js";
import { CORTEX_DESK_LIVE_AGENT_ID } from "../types.js";
import { CortexError } from "../errors.js";

export class CortexIngestService extends Context.Tag("CortexIngestService")<
  CortexIngestService,
  {
    readonly handleEvent: (
      agentId: string,
      runId: string,
      msg: CortexIngestMessage,
    ) => Effect.Effect<void, CortexError>;
    readonly getSubscriberCount: (agentId: string) => Effect.Effect<number, never>;
  }
>() {}

const deriveRunStats = (
  event: AgentEvent,
): Partial<{
  iterationCount: number;
  tokensUsed: number;
  tokensUsedTotal: number;
  cost: number;
  status: string;
  completedAt: number;
  debrief: string;
}> => {
  if (event._tag === "LLMRequestCompleted") {
    const e = event as { tokensUsed?: number; estimatedCost?: number };
    return { tokensUsed: e.tokensUsed ?? 0, cost: e.estimatedCost ?? 0 };
  }
  if (event._tag === "ReasoningStepCompleted") {
    const e = event as { totalSteps?: number; step?: number };
    return { iterationCount: e.totalSteps ?? e.step ?? 0 };
  }
  if (event._tag === "ReasoningIterationProgress") {
    const e = event as { iteration?: number };
    return { iterationCount: e.iteration ?? 0 };
  }
  if (event._tag === "AgentCompleted") {
    const e = event as { success?: boolean; totalTokens?: number; durationMs?: number };
    return {
      status: e.success ? "completed" : "failed",
      completedAt: Date.now(),
      // totalTokens is the authoritative count — persisted via MAX so it doesn't
      // overcount when added to per-call accumulated values.
      ...(typeof e.totalTokens === "number" && e.totalTokens > 0
        ? { tokensUsedTotal: e.totalTokens }
        : {}),
    };
  }
  if (event._tag === "TaskFailed") {
    return { status: "failed", completedAt: Date.now() };
  }
  if (event._tag === "DebriefCompleted") {
    const e = event as { debrief: unknown };
    return { debrief: JSON.stringify(e.debrief ?? null) };
  }
  return {};
};

const IGNORED_INTERNAL_RUN_IDS = new Set([
  "unknown",
  "structured-output",
  "classify-tool-relevance",
]);

function shouldIgnoreRunId(runId: string): boolean {
  return IGNORED_INTERNAL_RUN_IDS.has(runId);
}

export const CortexIngestServiceLive = (db: Database) =>
  Layer.effect(
    CortexIngestService,
    Effect.gen(function* () {
      const bridge = yield* CortexEventBridge;

      return {
        handleEvent: (agentId, runId, msg) =>
          Effect.gen(function* () {
            // Ignore known internal pseudo-task streams that pollute Stage.
            if (shouldIgnoreRunId(runId)) return;

            yield* Effect.sync(() => {
              const existingAgentId = getRunAgentId(db, runId);
              const eventAgentId =
                "agentId" in msg.event && typeof msg.event.agentId === "string"
                  ? msg.event.agentId
                  : undefined;

              // Canonicalize all events for the same run to one stable agent id.
              const normalizedAgentId =
                existingAgentId ??
                eventAgentId ??
                (agentId === "unknown" || agentId === runId ? undefined : agentId) ??
                runId;

              upsertRun(db, normalizedAgentId, runId);
              const seq = getNextSeq(db, runId);
              const normalizedMsg: CortexIngestMessage = {
                ...msg,
                agentId: normalizedAgentId,
              };
              insertEvent(db, normalizedMsg, seq);
              const patch = deriveRunStats(msg.event);
              if (Object.keys(patch).length > 0) updateRunStats(db, runId, patch);
              return normalizedAgentId;
            }).pipe(
              Effect.flatMap((normalizedAgentId) => {
                const liveMsg: CortexLiveMessage = {
                  v: 1,
                  ts: Date.now(),
                  agentId: normalizedAgentId,
                  runId,
                  source: "eventbus",
                  type: msg.event._tag,
                  payload: msg.event as unknown as Record<string, unknown>,
                };
                return Effect.all([
                  bridge.broadcast(normalizedAgentId, liveMsg),
                  bridge.broadcast(CORTEX_DESK_LIVE_AGENT_ID, liveMsg),
                ]).pipe(Effect.asVoid);
              }),
            );

            yield* Effect.sync(() => {
              const canonicalAgentId = getRunAgentId(db, runId) ?? agentId;
              const count = db
                .prepare("SELECT COUNT(*) as c FROM cortex_events WHERE agent_id = ?")
                .get(canonicalAgentId) as { c: number } | null;
              if ((count?.c ?? 0) % 100 === 0) enforceRetention(db, canonicalAgentId);
            });
          }).pipe(
            Effect.catchAll((e) => Effect.fail(new CortexError({ message: String(e), cause: e }))),
          ),

        getSubscriberCount: (agentId) => bridge.subscriberCount(agentId),
      };
    }),
  );
