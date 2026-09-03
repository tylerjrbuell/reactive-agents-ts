/**
 * Guardrail screening for the memory write path (F-6, 2026-08-24
 * external-research-convergence amendment, W6).
 *
 * `packages/memory` ships `storeSemantic`/`logEpisode` with nothing
 * screening what gets persisted — the 2026 literature names memory
 * poisoning (a prompt-injection payload, or exfiltrated PII, landing in
 * durable storage and being replayed into a future prompt) a primary
 * agentic vulnerability, and RA already has the detectors
 * (`packages/guardrails`) — they were just never pointed at this path.
 *
 * The check can't live in `packages/memory` itself: `packages/guardrails`
 * depends on `packages/llm-provider`, which depends on `packages/memory` —
 * importing guardrails from memory would close that cycle. `packages/runtime`
 * already depends on both, so it decorates the built layer instead of the
 * package.
 *
 * Only `critical`-severity findings block a write. Anything lower is
 * best-effort and must not reject a legitimate memory entry.
 */
import { Context, Effect, Layer } from "effect";
import { MemoryService, MemoryError, type SemanticEntry, type DailyLogEntry } from "@reactive-agents/memory";
import { AgentMemory, type AgentMemoryEntry } from "@reactive-agents/core";
import { detectInjection, detectPii } from "@reactive-agents/guardrails";

const screenForPoisoning = (content: string): Effect.Effect<void, MemoryError> =>
  Effect.gen(function* () {
    const injection = yield* detectInjection(content);
    if (injection.detected && injection.severity === "critical") {
      return yield* Effect.fail(
        new MemoryError({ message: `Memory write blocked: ${injection.message}` }),
      );
    }
    const pii = yield* detectPii(content);
    if (pii.detected && pii.severity === "critical") {
      return yield* Effect.fail(
        new MemoryError({ message: `Memory write blocked: ${pii.message}` }),
      );
    }
  });

/**
 * Wraps a layer providing `MemoryService` and/or `AgentMemory` so every
 * `storeSemantic`/`logEpisode` call is screened first. Safe to apply to any
 * layer built by `createMemoryLayer` — both ports it provides are covered
 * independently, since the `AgentMemory` adapter closes over its own
 * `MemoryService` reference at layer-build time and would otherwise bypass
 * a decoration applied only to the `MemoryService` entry.
 */
export const withMemoryGuardrails = <E, R>(
  layer: Layer.Layer<MemoryService | AgentMemory, E, R>,
): Layer.Layer<MemoryService | AgentMemory, E, R> =>
  Layer.map(layer, (context) => {
    const memory = Context.get(context, MemoryService);
    const agentMemory = Context.get(context, AgentMemory);

    return context.pipe(
      Context.add(MemoryService, {
        ...memory,
        storeSemantic: (entry: SemanticEntry) =>
          screenForPoisoning(entry.content).pipe(Effect.andThen(memory.storeSemantic(entry))),
        logEpisode: (entry: DailyLogEntry) =>
          screenForPoisoning(entry.content).pipe(Effect.andThen(memory.logEpisode(entry))),
      }),
      Context.add(AgentMemory, {
        ...agentMemory,
        storeSemantic: (entry: AgentMemoryEntry) =>
          screenForPoisoning(entry.content).pipe(Effect.andThen(agentMemory.storeSemantic(entry))),
      }),
    );
  });
