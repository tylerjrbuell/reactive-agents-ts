import type { CompetitorRunner } from "./types.js"
import { langchainRunner }     from "./langchain-runner.js"
import { vercelAiRunner }      from "./vercel-ai-runner.js"
import { openaiAgentsRunner }  from "./openai-agents-runner.js"
import { mastraRunner }        from "./mastra-runner.js"
import { llamaindexRunner }    from "./llamaindex-runner.js"

export type { CompetitorRunner, TaskRunResult } from "./types.js"

export const COMPETITOR_RUNNERS: Record<string, CompetitorRunner> = {
  "langchain":       langchainRunner,
  "vercel-ai":       vercelAiRunner,
  "openai-agents":   openaiAgentsRunner,
  "mastra":          mastraRunner,
  "llamaindex":      llamaindexRunner,
}
