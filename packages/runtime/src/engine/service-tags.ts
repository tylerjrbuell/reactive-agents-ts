/**
 * Shared Effect Context.GenericTag declarations for engine-internal services.
 *
 * Consolidates tags that were previously inlined in multiple engine/ modules.
 * Each tag must match the string key used by the corresponding ServiceLive
 * implementation — never change the string even when renaming the const.
 *
 * Only tags that appear in 2+ files with *identical* type shapes are hoisted
 * here. Tags that appear only once, or whose shapes diverge across files,
 * stay inline at their call sites.
 */
import { Context, Effect } from "effect";

/**
 * MemoryService (logEpisode shape) — persists per-step episodes to working
 * memory.
 *
 * Consumers:
 *   - engine/phases/agent-loop/reasoning-post-think.ts
 *
 * (The inline direct-LLM arm's `inline-think.ts` / `inline-observe.ts` were
 * also consumers before their deletion, 2026-08-23 — see DEBT-REGISTER
 * D-2026-08-23-A.)
 *
 * NOTE: Other MemoryService shapes exist (bootstrap: { bootstrap }, memory-flush:
 * { snapshot, flush?, storeSemantic? }) and are intentionally NOT hoisted here
 * because their type structures differ.
 */
export const MemoryServiceLogEpisodeTag = Context.GenericTag<{
  logEpisode: (episode: unknown) => Effect.Effect<void>;
}>("MemoryService");
