import { Layer, Effect } from "effect";
import { LLMService } from "@reactive-agents/llm-provider";
import type { EventBus } from "@reactive-agents/core";
import { createMemoryLayer } from "@reactive-agents/memory";
import type { MemoryLLM } from "@reactive-agents/memory";
import { withMemoryGuardrails } from "./memory-guardrails.js";
import type { ReactiveAgentsConfig } from "./types.js";
import type { RuntimeOptions } from "./runtime-types.js";

/**
 * Build the ambient memory layer (overrides + LLM.embed bridge). Extracted
 * verbatim from `createRuntime` (GH #267).
 */
export function buildMemoryLayer(
  options: RuntimeOptions,
  config: Pick<ReactiveAgentsConfig, "memoryTier">,
  observableLlmLayer: Layer.Layer<LLMService>,
  eventBusLayer: Layer.Layer<EventBus>,
) {
  const memoryOverrides: Record<string, unknown> = { agentId: options.agentId };
  if (options.memoryOptions) {
    const mo = options.memoryOptions;
    if (mo.dbPath) memoryOverrides.dbPath = mo.dbPath;
    if (mo.capacity || mo.evictionPolicy) {
      memoryOverrides.working = {
        capacity: mo.capacity ?? 7,
        evictionPolicy: mo.evictionPolicy ?? "fifo",
      };
    }
    if (mo.importanceThreshold !== undefined) {
      memoryOverrides.semantic = {
        maxMarkdownLines: 200,
        importanceThreshold: mo.importanceThreshold,
      };
    }
    if (mo.retainDays !== undefined) {
      memoryOverrides.episodic = {
        retainDays: mo.retainDays,
        maxSnapshotsPerSession: 3,
      };
    }
    if (mo.maxEntries !== undefined) {
      memoryOverrides.compaction = {
        strategy: "progressive",
        maxEntries: mo.maxEntries,
        intervalMs: 86_400_000,
        similarityThreshold: 0.92,
        decayFactor: 0.05,
      };
    }
  }
  // Bridge LLMService.embed into MemoryLLM so semantic memory auto-generates embeddings
  const memoryLayer = Layer.unwrapEffect(
    Effect.gen(function* () {
      const llm = yield* LLMService;
      const bridgedLLM: MemoryLLM = {
        complete: (req) =>
          llm.complete({
            messages: req.messages.map((m) => ({
              role: m.role as "user" | "assistant" | "system",
              content: m.content,
            })),
            temperature: req.temperature,
            maxTokens: req.maxTokens,
          }).pipe(
            Effect.map((r) => ({
              content: r.content,
              usage: r.usage ? { totalTokens: r.usage.totalTokens } : undefined,
            })),
          ),
        embed: (texts, model) => llm.embed(texts, model),
      };
      return withMemoryGuardrails(
        createMemoryLayer(
          config.memoryTier,
          memoryOverrides as Parameters<typeof createMemoryLayer>[1],
          bridgedLLM,
        ),
      );
    }),
  ).pipe(Layer.provide(Layer.merge(observableLlmLayer, eventBusLayer)));
  return memoryLayer;
}
