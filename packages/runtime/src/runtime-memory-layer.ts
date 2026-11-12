import { Layer, Effect } from "effect";
import { LLMService } from "@reactive-agents/llm-provider";
import type { EventBus } from "@reactive-agents/core";
import {
  createMemoryLayer,
  DebriefStoreLive,
  defaultMemoryConfig,
  defaultUserMemoryPath,
  MemoryDatabaseLive,
} from "@reactive-agents/memory";
import type { MemoryDatabase, MemoryLLM } from "@reactive-agents/memory";
import { isDebriefEnabled } from "./debrief.js";
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

/**
 * The debrief store (`DebriefStoreService`) for a run that has a debrief
 * (`isDebriefEnabled`). Nothing else provided it, so a synthesized debrief
 * reached the DebriefCompleted event and `result.debrief` but was never saved.
 *
 * With memory on the store shares the memory layer's database. With memory off
 * it opens only the debrief table in the memory database path, without the rest
 * of the memory stack: the explicit `memoryOptions.dbPath`, else an in-process
 * `:memory:` db for test runs, else the agent's user-scope memory path.
 */
export function buildDebriefStoreLayer(
  options: RuntimeOptions,
  memoryLayer: Layer.Layer<never, unknown, never>,
): Layer.Layer<never, unknown, MemoryDatabase> {
  if (!isDebriefEnabled(options)) return Layer.empty;
  if (options.enableMemory) return DebriefStoreLive.pipe(Layer.provide(memoryLayer));
  const dbPath =
    options.memoryOptions?.dbPath ??
    (options.provider === "test" || process.env.NODE_ENV === "test"
      ? ":memory:"
      : defaultUserMemoryPath(options.agentId));
  return DebriefStoreLive.pipe(
    Layer.provide(MemoryDatabaseLive({ ...defaultMemoryConfig(options.agentId), dbPath })),
  );
}
