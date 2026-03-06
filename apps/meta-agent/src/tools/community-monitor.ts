// apps/meta-agent/src/tools/community-monitor.ts
import { Effect } from "effect";
import type { ToolDefinition } from "reactive-agents/tools";

/**
 * Custom tool: configure search scope for TypeScript AI agent community monitoring.
 * Returns search terms, target platforms, and instructions for the web-search tool.
 */
export const communityMonitorTool: ToolDefinition = {
  name: "community-monitor",
  description:
    "Configure the search scope for TypeScript AI agent framework discussions on Hacker News, " +
    "Reddit, and dev.to. Returns search terms, target platforms, and instructions for the " +
    "web-search tool to follow. Use this during heartbeat to find new opportunities.",
  parameters: [
    {
      name: "topics",
      type: "array",
      description:
        "Topics to search for. Default covers TypeScript agent frameworks, competitors, and related discussions.",
      required: false,
    },
  ],
  returnType: "{ searchTerms: string[], platforms: string[], instruction: string }",
  category: "search",
  riskLevel: "low",
  timeoutMs: 5_000,
  requiresApproval: false,
  source: "function",
};

export const communityMonitorHandler = (
  args: Record<string, unknown>,
): Effect.Effect<unknown> => {
  const topics = (args.topics as string[] | undefined) ?? [
    "TypeScript AI agent framework",
    "LangChain TypeScript alternative",
    "LangChain.js vs LangChain Python",
    "LangGraph.js updates",
    "OpenAI agents SDK TypeScript",
    "Microsoft AutoGen Python",
    "CrewAI framework",
    "SuperAGI framework",
    "Mastra framework",
    "Portkey AI gateway",
    "VoltAgent framework",
    "Agentic.js tools",
    "Effect-TS agents",
    "autonomous agents TypeScript",
    "AI agent observability TypeScript",
  ];

  return Effect.succeed({
    searchTerms: topics,
    platforms: [
      "Hacker News",
      "Reddit r/typescript",
      "Reddit r/MachineLearning",
      "Reddit r/LocalLLaMA",
      "dev.to",
    ],
    instruction:
      "Use the web-search tool with each term to find recent discussions. " +
      "For each relevant thread found, evaluate: Is this a genuine opportunity to add value? " +
      "Would mentioning reactive-agents be helpful (not spammy)? " +
      "Track recurring competitor names and summarize notable releases or positioning shifts. " +
      "Draft a response only if you can lead with value, not with promotion.",
  });
};
