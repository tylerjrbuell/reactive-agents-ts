// apps/advocate/src/tools/competitive-intel.ts
import { Effect } from "effect";
import type { ToolDefinition } from "reactive-agents/tools";
import { gatherCompetitiveEvidence } from "../analysis/intel.js";

export const competitiveIntelTool: ToolDefinition = {
  name: "competitive-intel",
  description:
    "Harvest recent competitor activity (GitHub releases) as cited evidence with confidence " +
    "levels. Returns real source URLs you MUST cite in scorecards — never invent evidence links.",
  parameters: [
    { name: "repos", type: "array", description: "owner/repo list to check. Defaults to known competitors.", required: false },
  ],
  returnType: "{ evidence: Array<{ id, competitor, source, summary, url, capturedAt, confidence }>, instruction: string }",
  category: "search",
  riskLevel: "low",
  timeoutMs: 20_000,
  requiresApproval: false,
  source: "function",
};

const DEFAULT_REPOS = [
  "langchain-ai/langchainjs",
  "langchain-ai/langgraphjs",
  "mastra-ai/mastra",
  "VoltAgent/voltagent",
  "crewAIInc/crewAI",
];

export const competitiveIntelHandler = (
  args: Record<string, unknown>,
): Effect.Effect<unknown> => {
  const repos = (args.repos as string[] | undefined) ?? DEFAULT_REPOS;
  return gatherCompetitiveEvidence(
    { repos, perRepo: 5 },
    { fetchImpl: globalThis.fetch },
  ).pipe(
    Effect.map((evidence) => ({
      evidence,
      instruction:
        "Cite ONLY these urls as evidence in the scorecard, with the given confidence level. " +
        "If a claim has no evidence item here, mark it 'unverified' rather than inventing a link.",
    })),
  );
};
