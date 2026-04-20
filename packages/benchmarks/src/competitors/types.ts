import type { BenchmarkTask, ModelVariant } from "../types.js"

// TaskRunResult is defined in types.ts — re-export here so callers can import from one place
export type { TaskRunResult } from "../types.js"
import type { TaskRunResult } from "../types.js"

/** Shared interface implemented by all 5 competitor runners. */
export interface CompetitorRunner {
  readonly id: string
  readonly label: string
  readonly framework: "langchain" | "vercel-ai" | "openai-agents" | "mastra" | "llamaindex"
  readonly pinnedVersion: string
  run(
    task: BenchmarkTask,
    model: ModelVariant,
    tmpDir: string,
    timeoutMs: number,
  ): Promise<TaskRunResult>
}
