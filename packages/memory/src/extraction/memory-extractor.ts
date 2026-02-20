import { Effect, Context, Layer } from "effect";
import type { SemanticEntry, MemoryId, DailyLogEntry } from "../types.js";
import { ExtractionError } from "../errors.js";

// ─── Service Tag ───

export class MemoryExtractor extends Context.Tag("MemoryExtractor")<
  MemoryExtractor,
  {
    /**
     * Extract semantic memories from a conversation.
     * In Tier 1, this uses simple heuristic extraction (no LLM).
     * In Tier 2, this uses LLMService for intelligent extraction.
     */
    readonly extractFromConversation: (
      agentId: string,
      messages: readonly { role: string; content: string }[],
    ) => Effect.Effect<SemanticEntry[], ExtractionError>;

    /**
     * Extract episodic events from a conversation.
     */
    readonly extractEpisodic: (
      agentId: string,
      messages: readonly { role: string; content: string }[],
    ) => Effect.Effect<DailyLogEntry[], ExtractionError>;
  }
>() {}

// ─── Tier 1 Heuristic Implementation (no LLM required) ───

let idCounter = 0;
const nextId = (): MemoryId =>
  `mem-extract-${Date.now()}-${++idCounter}` as MemoryId;

export const MemoryExtractorLive = Layer.succeed(MemoryExtractor, {
  extractFromConversation: (agentId, messages) =>
    Effect.try({
      try: () => {
        const entries: SemanticEntry[] = [];
        const now = new Date();

        for (const msg of messages) {
          if (msg.role !== "assistant") continue;
          // Heuristic: extract sentences that look like facts/knowledge
          const sentences = msg.content
            .split(/[.!?]\s+/)
            .filter((s) => s.length > 30);

          for (const sentence of sentences.slice(0, 3)) {
            entries.push({
              id: nextId(),
              agentId,
              content: sentence.trim(),
              summary: sentence.trim().slice(0, 100),
              importance: 0.5,
              verified: false,
              tags: [],
              createdAt: now,
              updatedAt: now,
              accessCount: 0,
              lastAccessedAt: now,
            });
          }
        }

        return entries;
      },
      catch: (e) =>
        new ExtractionError({
          message: `Extraction failed: ${e}`,
          cause: e,
        }),
    }),

  extractEpisodic: (agentId, messages) =>
    Effect.try({
      try: () => {
        const entries: DailyLogEntry[] = [];
        const now = new Date();
        const today = now.toISOString().slice(0, 10);

        for (const msg of messages) {
          if (msg.content.length < 10) continue;
          entries.push({
            id: nextId(),
            agentId,
            date: today,
            content: msg.content.slice(0, 500),
            eventType: "observation",
            createdAt: now,
            metadata: { role: msg.role },
          });
        }

        return entries.slice(0, 10);
      },
      catch: (e) =>
        new ExtractionError({
          message: `Episodic extraction failed: ${e}`,
          cause: e,
        }),
    }),
});
