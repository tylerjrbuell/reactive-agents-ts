import { Effect, Context, Layer } from "effect";
import type { SemanticEntry, MemoryId, DailyLogEntry, MemoryLLM } from "../types.js";
import { ExtractionError } from "../errors.js";

// ─── Utilities ───

/**
 * Replace common relative date expressions with absolute ISO dates so that
 * extracted memories remain interpretable across sessions.
 */
function normalizeRelativeDates(content: string, now: Date): string {
  const ms = now.getTime();
  const d = (offsetDays: number) =>
    new Date(ms + offsetDays * 86_400_000).toISOString().slice(0, 10);
  const today     = d(0);
  const yesterday = d(-1);
  const tomorrow  = d(1);
  const lastWeek  = d(-7);
  const nextWeek  = d(7);
  const lastMonth = d(-30);

  return content
    .replace(/\beach\s+morning\b/gi, `each morning (around ${today})`)
    .replace(/\bearlier\s+today\b/gi, today)
    .replace(/\bthis\s+morning\b/gi, today)
    .replace(/\blast\s+night\b/gi, yesterday)
    .replace(/\byesterday\b/gi, yesterday)
    .replace(/\btoday\b/gi, today)
    .replace(/\btomorrow\b/gi, tomorrow)
    .replace(/\bthis\s+week\b/gi, `week of ${today}`)
    .replace(/\blast\s+week\b/gi, `week of ${lastWeek}`)
    .replace(/\bnext\s+week\b/gi, `week of ${nextWeek}`)
    .replace(/\blast\s+month\b/gi, `month of ${lastMonth}`)
    .replace(/\bthis\s+month\b/gi, `month of ${today}`);
}

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
            const normalized = normalizeRelativeDates(sentence.trim(), now);
            entries.push({
              id: nextId(),
              agentId,
              content: normalized,
              summary: normalized.slice(0, 100),
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

// ─── Tier 2 LLM-Enhanced Implementation ───

const EXTRACTION_PROMPT = `You are a memory extraction assistant. Analyze the conversation and extract important facts, decisions, and knowledge worth remembering long-term.

For each extracted memory, provide:
- "content": the fact or knowledge (1-2 sentences)
- "importance": a score from 0.0 to 1.0 where:
  - 0.0-0.3: trivial/ephemeral (greetings, filler)
  - 0.3-0.6: moderately useful context
  - 0.6-0.8: important facts, decisions, or preferences
  - 0.8-1.0: critical knowledge, corrections, or key learnings
- "tags": 1-3 short topic tags (lowercase, no spaces)

Respond with a JSON array. Extract at most 5 memories. Only extract genuinely useful knowledge — skip pleasantries, acknowledgments, and filler.

Example output:
[{"content":"User prefers TypeScript over JavaScript for new projects","importance":0.7,"tags":["preference","typescript"]},{"content":"The API rate limit is 100 requests per minute","importance":0.8,"tags":["api","rate-limit"]}]`;

/**
 * Create a Tier 2 LLM-enhanced memory extractor.
 *
 * Uses the LLM to score importance and extract tags from conversation.
 * Falls back to Tier 1 heuristics if the LLM call fails.
 */
export const MemoryExtractorTier2Live = (llm: MemoryLLM) =>
  Layer.succeed(MemoryExtractor, {
    extractFromConversation: (agentId, messages) =>
      Effect.gen(function* () {
        // Build a compact conversation summary for the LLM
        const conversationText = messages
          .slice(-20) // limit to last 20 messages to control token usage
          .map((m) => `${m.role}: ${m.content.slice(0, 500)}`)
          .join("\n");

        const result = yield* llm
          .complete({
            messages: [
              { role: "system", content: EXTRACTION_PROMPT },
              { role: "user", content: conversationText },
            ],
            temperature: 0.1,
            maxTokens: 1024,
          })
          .pipe(
            Effect.catchAll(() =>
              // Fall back to Tier 1 heuristic if LLM call fails
              Effect.succeed(null),
            ),
          );

        if (result === null) {
          return yield* heuristicExtract(agentId, messages);
        }

        // Parse JSON response
        const raw = result.content.trim();
        // Find the JSON array in the response (handle markdown fences)
        const jsonMatch = raw.match(/\[[\s\S]*\]/);
        if (!jsonMatch) {
          // Fall back to Tier 1 heuristic if LLM response is unparseable
          return yield* heuristicExtract(agentId, messages);
        }

        let parsed: unknown[];
        try {
          parsed = JSON.parse(jsonMatch[0]) as unknown[];
        } catch {
          return yield* heuristicExtract(agentId, messages);
        }

        if (!Array.isArray(parsed)) {
          return yield* heuristicExtract(agentId, messages);
        }

        const now = new Date();
        const entries: SemanticEntry[] = [];

        for (const item of parsed.slice(0, 5)) {
          if (
            typeof item !== "object" ||
            item === null ||
            !("content" in item)
          )
            continue;
          const obj = item as Record<string, unknown>;
          const content = String(obj.content ?? "").trim();
          if (content.length < 10) continue;

          const importance = Math.max(
            0,
            Math.min(1, Number(obj.importance) || 0.5),
          );
          const tags = Array.isArray(obj.tags)
            ? obj.tags.filter((t): t is string => typeof t === "string")
            : [];

          const normalized = normalizeRelativeDates(content, now);
          entries.push({
            id: nextId(),
            agentId,
            content: normalized,
            summary: normalized.slice(0, 100),
            importance,
            verified: false,
            tags,
            createdAt: now,
            updatedAt: now,
            accessCount: 0,
            lastAccessedAt: now,
          });
        }

        return entries.length > 0
          ? entries
          : yield* heuristicExtract(agentId, messages);
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

/** Tier 1 heuristic fallback used by Tier 2 when LLM parsing fails. */
const heuristicExtract = (
  agentId: string,
  messages: readonly { role: string; content: string }[],
): Effect.Effect<SemanticEntry[], ExtractionError> =>
  Effect.try({
    try: () => {
      const entries: SemanticEntry[] = [];
      const now = new Date();

      for (const msg of messages) {
        if (msg.role !== "assistant") continue;
        const sentences = msg.content
          .split(/[.!?]\s+/)
          .filter((s) => s.length > 30);

        for (const sentence of sentences.slice(0, 3)) {
          const normalized = normalizeRelativeDates(sentence.trim(), now);
          entries.push({
            id: nextId(),
            agentId,
            content: normalized,
            summary: normalized.slice(0, 100),
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
        message: `Heuristic extraction fallback failed: ${e}`,
        cause: e,
      }),
  });
