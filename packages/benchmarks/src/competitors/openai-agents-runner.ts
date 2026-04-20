import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { CompetitorRunner, TaskRunResult } from "./types.js"
import type { BenchmarkTask, ModelVariant } from "../types.js"

export const openaiAgentsRunner: CompetitorRunner = {
  id: "openai-agents",
  label: "OpenAI Agents SDK",
  framework: "openai-agents",
  pinnedVersion: "0.x",
  async run(task: BenchmarkTask, model: ModelVariant, tmpDir: string, timeoutMs: number): Promise<TaskRunResult> {
    if (model.provider !== "openai") {
      return { output: "", tokensUsed: 0, durationMs: 0, iterations: 0, status: "error",
        error: `OpenAI Agents SDK requires provider=openai, got ${model.provider} — skipped` }
    }

    const start = performance.now()
    try {
      const { Agent, run, tool } = await import("@openai/agents")
      const { z } = await import("zod")

      const fileReadTool = tool({
        name: "file_read",
        description: "Read a file from the working directory",
        parameters: z.object({ path: z.string() }),
        execute: async ({ path }: { path: string }) => {
          try { return readFileSync(join(tmpDir, path), "utf8") }
          catch (e) { return `Error: ${e}` }
        },
      })

      const fileWriteTool = tool({
        name: "file_write",
        description: "Write content to a file in the working directory",
        parameters: z.object({ path: z.string(), content: z.string() }),
        execute: async ({ path, content }: { path: string; content: string }) => {
          try { writeFileSync(join(tmpDir, path), content, "utf8"); return "ok" }
          catch (e) { return `Error: ${e}` }
        },
      })

      const agent = new Agent({
        name: `bench-${task.id}`,
        instructions: "You are a helpful assistant. Complete the task carefully.",
        model: model.model,
        tools: [fileReadTool, fileWriteTool],
      })

      const result = await Promise.race([
        run(agent, task.prompt),
        new Promise<never>((_, r) => setTimeout(() => r(new Error("timeout")), timeoutMs)),
      ])

      return {
        output: result.finalOutput ?? "",
        tokensUsed: result.rawResponses?.reduce((a: number, r: { usage?: { totalTokens?: number } }) => a + (r.usage?.totalTokens ?? 0), 0) ?? 0,
        durationMs: performance.now() - start,
        iterations: result.rawResponses?.length ?? 0,
        status: "pass",
      }
    } catch (e) {
      return { output: "", tokensUsed: 0, durationMs: performance.now() - start,
        iterations: 0, status: "error", error: e instanceof Error ? e.message : String(e) }
    }
  },
}
