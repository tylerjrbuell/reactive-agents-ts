/**
 * MEMORY_FLUSH phase — persist working memory snapshot, decay unused entries,
 * and auto-extract semantic memories from the conversation. Transitions
 * agentState to `flushing`.
 *
 * Optional services (`MemoryService`, `MemoryConsolidator`, `MemoryExtractor`)
 * are acquired lazily; when none are wired the phase is a fast no-op.
 *
 * Skip conditions handled by the phase body:
 * - No memory services wired: returns `agentState: "flushing"` unchanged
 * - Trivial run (≤1 iteration, no tool calls): same fast-path
 *
 * Dispatch mode (trivial/moderate/complex) is decided by the orchestrator —
 * trivial skips this phase entirely, moderate forks it as a daemon, complex
 * runs it blocking.
 *
 * Extracted from `execution-engine.ts:3436-3569` (Phase 7: MEMORY_FLUSH).
 */
import { Effect, Context } from "effect";
import { emitErrorSwallowed, errorTag } from "@reactive-agents/core";
import type { Phase } from "../phase.js";

type MemoryServiceLike = {
  snapshot: (s: unknown) => Effect.Effect<void>;
  flush?: (agentId: string) => Effect.Effect<void>;
  storeSemantic?: (entry: unknown) => Effect.Effect<unknown>;
};
type MemoryConsolidatorLike = {
  decayUnused: (agentId: string, decayFactor: number) => Effect.Effect<number>;
};
type MemoryExtractorLike = {
  extractFromConversation: (
    agentId: string,
    messages: readonly { role: string; content: string }[],
  ) => Effect.Effect<unknown[], unknown>;
};

const MemoryServiceTag = Context.GenericTag<MemoryServiceLike>("MemoryService");
const MemoryConsolidatorTag = Context.GenericTag<MemoryConsolidatorLike>("MemoryConsolidator");
const MemoryExtractorTag = Context.GenericTag<MemoryExtractorLike>("MemoryExtractor");

export const memoryFlush: Phase = {
  name: "memory-flush",

  run: (ctx, deps) =>
    Effect.gen(function* () {
      const memoryServiceOpt = yield* Effect.serviceOption(MemoryServiceTag);
      const memoryConsolidatorOpt = yield* Effect.serviceOption(MemoryConsolidatorTag);
      const memoryExtractorOpt = yield* Effect.serviceOption(MemoryExtractorTag);

      // Skip when no memory services are configured
      if (
        memoryServiceOpt._tag === "None" &&
        memoryConsolidatorOpt._tag === "None" &&
        memoryExtractorOpt._tag === "None"
      ) {
        return { ...ctx, agentState: "flushing" as const };
      }

      // Skip on trivial runs. MOVE-3 Phase 2: prefer the upstream
      // `ctx.metadata.taskComplexity` snapshot populated by
      // `engine/phases/memory-flush-dispatch.ts:42` (the orchestrator that
      // dispatched THIS phase) so memory-flush and debrief-synthesis
      // (commit fa831f44) agree on a SINGLE canonical "trivial" verdict
      // derived from `engine/util.ts:143 classifyComplexity()`. Fall back
      // to local compute when invoked outside the dispatch chain (direct
      // callers, test harnesses) — preserves backward compat. Previously
      // this site used `ctx.iteration <= 1 && !hadToolCalls` directly,
      // which is a SECOND copy of the same trivial heuristic with a
      // subtly different signal (`ctx.toolResults.length` vs the
      // dispatcher's `toolCallLog.length`) — exactly the "5+ scattered
      // gates" deficit master plan §3 names.
      const upstreamComplexity = ctx.metadata.taskComplexity;
      const hadToolCalls = ctx.toolResults.length > 0;
      const isTrivial =
        upstreamComplexity !== undefined
          ? upstreamComplexity === "trivial"
          : ctx.iteration <= 1 && !hadToolCalls;
      if (isTrivial) {
        return { ...ctx, agentState: "flushing" as const };
      }

      // ── MemoryService: snapshot + flush ──
      yield* Effect.succeed(memoryServiceOpt).pipe(
        Effect.flatMap((opt) =>
          opt._tag === "Some"
            ? Effect.gen(function* () {
                yield* opt.value.snapshot({
                  id: ctx.sessionId,
                  agentId: ctx.agentId,
                  messages: ctx.messages,
                  summary: String(ctx.metadata["lastResponse"] ?? ""),
                  keyDecisions: [],
                  taskIds: [ctx.taskId],
                  startedAt: ctx.startedAt,
                  endedAt: new Date(),
                  totalCost: ctx.cost,
                  totalTokens: ctx.tokensUsed,
                });
                if (opt.value.flush) {
                  yield* opt.value
                    .flush(ctx.agentId)
                    .pipe(
                      Effect.catchAll((err) =>
                        emitErrorSwallowed({
                          site: "runtime/src/engine/phases/memory-flush.ts:flush",
                          tag: errorTag(err),
                        }),
                      ),
                    );
                }
              })
            : Effect.void,
        ),
        Effect.catchAll((err) =>
          emitErrorSwallowed({
            site: "runtime/src/engine/phases/memory-flush.ts:snapshot",
            tag: errorTag(err),
          }),
        ),
      );

      // Lightweight consolidation: decay unused memory entries
      yield* Effect.succeed(memoryConsolidatorOpt).pipe(
        Effect.flatMap((opt) =>
          opt._tag === "Some"
            ? opt.value.decayUnused(ctx.agentId, 0.05).pipe(Effect.catchAll(() => Effect.succeed(0)))
            : Effect.succeed(0),
        ),
        Effect.catchAll(() => Effect.succeed(0)),
      );

      // Auto-extract semantic memories — only when there's meaningful content.
      //
      // Lever 7 (2026-05-26) — tightened the gate. Previously fired on
      // `hadToolCalls || substantialResponse`, which meant any tool-using
      // task with a short answer (e.g. t1-calculator-add → "391") paid the
      // ~4 s LLM extraction cost despite having nothing extractable. Profile
      // evidence: t1 local burned 4.2 s on memory extraction alone for a
      // 3-char answer. Now requires `substantialResponse` (output > 200 chars)
      // OR multiple tool calls (≥2 — single tool calls are isolated facts
      // already captured in the agent's task store, not memory-worthy).
      const lastResponse = String(ctx.metadata["lastResponse"] ?? "");
      const substantialResponse = lastResponse.length > 200;
      const multiToolUse = ctx.toolResults.length >= 2;

      if (substantialResponse || multiToolUse) {
        yield* Effect.succeed(memoryExtractorOpt).pipe(
          Effect.flatMap((extractorOpt) => {
            if (extractorOpt._tag !== "Some") return Effect.void;
            const extractor = extractorOpt.value;

            // Build messages from execution context
            const messages: { role: string; content: string }[] = [];
            messages.push({ role: "user", content: String(deps.task.input).slice(0, 1000) });
            for (const tr of ctx.toolResults) {
              const toolResult = tr as { toolName?: string; result?: unknown };
              messages.push({
                role: "assistant",
                content: `Tool ${toolResult.toolName ?? "unknown"}: ${String(toolResult.result ?? "").slice(0, 500)}`,
              });
            }
            if (lastResponse) {
              messages.push({ role: "assistant", content: lastResponse.slice(0, 2000) });
            }

            return Effect.gen(function* () {
              const entries = yield* extractor.extractFromConversation(ctx.agentId, messages);

              if (entries.length > 0) {
                const memStoreOpt = yield* Effect.serviceOption(MemoryServiceTag).pipe(
                  Effect.catchAll(() => Effect.succeed({ _tag: "None" as const })),
                );

                if (memStoreOpt._tag === "Some" && memStoreOpt.value.storeSemantic) {
                  const storeFn = memStoreOpt.value.storeSemantic;
                  for (const entry of entries) {
                    yield* storeFn(entry).pipe(
                      Effect.catchAll((err) =>
                        emitErrorSwallowed({
                          site: "runtime/src/engine/phases/memory-flush.ts:store-semantic",
                          tag: errorTag(err),
                        }),
                      ),
                    );
                  }
                }
              }
            });
          }),
          Effect.catchAll((err) =>
            emitErrorSwallowed({
              site: "runtime/src/engine/phases/memory-flush.ts:extract",
              tag: errorTag(err),
            }),
          ),
        );
      }

      return { ...ctx, agentState: "flushing" as const };
    }),
};
