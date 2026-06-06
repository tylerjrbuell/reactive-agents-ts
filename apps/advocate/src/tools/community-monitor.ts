// apps/advocate/src/tools/community-monitor.ts
import { Effect } from "effect";
import { join } from "node:path";
import type { ToolDefinition } from "reactive-agents/tools";
import { gatherThreads } from "../ingest/gather.js";
import { makeFileSeenStore } from "../ingest/seen-store.js";

/**
 * Custom tool: actively fetch recent TypeScript-AI-agent discussions from
 * Hacker News (Algolia), Reddit, and dev.to — normalized, deduped against
 * previously-seen threads, and ranked by relevance. Replaces the old static
 * search-term stub: the agent now receives real candidate threads to evaluate.
 */
export const communityMonitorTool: ToolDefinition = {
  name: "community-monitor",
  description:
    "Fetch recent TypeScript AI agent framework discussions from Hacker News, Reddit, and dev.to. " +
    "Returns real candidate threads (title, url, source, engagement, snippet), already deduped " +
    "against threads handled in previous runs and ranked by relevance. Use this during heartbeat " +
    "to find new opportunities, then evaluate each for genuine value-add before drafting.",
  parameters: [
    {
      name: "topics",
      type: "array",
      description:
        "Search terms to monitor. Defaults to TypeScript agent frameworks, competitors, and related topics.",
      required: false,
    },
    {
      name: "limit",
      type: "number",
      description: "Max threads to return (default 12).",
      required: false,
    },
  ],
  returnType:
    "{ found: number, threads: Array<{ id, source, title, url, author?, points?, numComments?, createdAt, snippet? }>, instruction: string }",
  category: "search",
  riskLevel: "low",
  timeoutMs: 20_000,
  requiresApproval: false,
  source: "function",
};

const DEFAULT_TERMS = [
  "TypeScript AI agent framework",
  "LangChain TypeScript alternative",
  "LangChain.js vs LangChain Python",
  "LangGraph.js",
  "OpenAI agents SDK TypeScript",
  "CrewAI framework",
  "Mastra framework",
  "VoltAgent framework",
  "Effect-TS agents",
  "autonomous agents TypeScript",
  "local LLM agent TypeScript",
  "AI agent observability TypeScript",
];
const DEFAULT_SUBREDDITS = ["typescript", "MachineLearning", "LocalLLaMA", "node"];
const DEFAULT_DEVTO_TAGS = ["typescript", "ai", "node", "llm"];

// File-backed dedup so the agent never re-surfaces the same thread across restarts.
const SEEN_PATH = join(import.meta.dirname, "../../data/seen-threads.json");
const seenStore = makeFileSeenStore(SEEN_PATH);

export const communityMonitorHandler = (
  args: Record<string, unknown>,
): Effect.Effect<unknown> => {
  const topics = (args.topics as string[] | undefined) ?? DEFAULT_TERMS;
  const limit = (args.limit as number | undefined) ?? 12;

  return gatherThreads(
    {
      searchTerms: topics,
      subreddits: DEFAULT_SUBREDDITS,
      devtoTags: DEFAULT_DEVTO_TAGS,
      sinceHours: 168, // last week
      limit,
    },
    { fetchImpl: globalThis.fetch, isSeen: seenStore.isSeen, markSeen: seenStore.markSeen },
  ).pipe(
    Effect.map((threads) => ({
      found: threads.length,
      threads,
      instruction:
        "These threads are fresh, deduped (already-handled ones excluded), and relevance-ranked. " +
        "For each: decide if reactive-agents genuinely helps the person. Draft a response ONLY if " +
        "you can lead with real value, not promotion. Save worthwhile drafts with draft-writer, " +
        "including the thread url. Skip anything where mentioning the framework would be spammy.",
    })),
  );
};
