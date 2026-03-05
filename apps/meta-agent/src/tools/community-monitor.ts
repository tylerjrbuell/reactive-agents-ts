// apps/meta-agent/src/tools/community-monitor.ts
import type { ToolDefinition } from "reactive-agents/tools";

/**
 * Custom tool: search developer communities for TypeScript AI agent discussions.
 * Returns threads that are likely opportunities to add value and mention reactive-agents.
 */
export const communityMonitorTool: ToolDefinition = {
  name: "community-monitor",
  description:
    "Configure the search scope for TypeScript AI agent framework discussions on Hacker News, " +
    "Reddit, and dev.to. Returns search terms, target platforms, and instructions for the " +
    "web-search tool to follow. Use this during heartbeat to find new opportunities.",
  inputSchema: {
    type: "object",
    properties: {
      topics: {
        type: "array",
        items: { type: "string" },
        description: "Topics to search for. Default covers TypeScript agent frameworks.",
      },
    },
    required: [],
  },
  handler: async (input: { topics?: string[] }) => {
    const topics = input.topics ?? [
      "TypeScript AI agent framework",
      "LangChain TypeScript alternative",
      "Mastra framework",
      "Effect-TS agents",
      "autonomous agents TypeScript",
      "AI agent observability TypeScript",
    ];

    // Return structured results for the agent to reason about
    return {
      searchTerms: topics,
      platforms: ["Hacker News", "Reddit r/typescript", "Reddit r/MachineLearning", "Reddit r/LocalLLaMA", "dev.to"],
      instruction:
        "Use the web-search tool with each term to find recent discussions. " +
        "For each relevant thread found, evaluate: Is this a genuine opportunity to add value? " +
        "Would mentioning reactive-agents be helpful (not spammy)? " +
        "Draft a response only if you can lead with value, not with promotion.",
    };
  },
};
