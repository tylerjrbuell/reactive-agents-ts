import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { CompetitorRunner, TaskRunResult } from "./types.js"
import type { BenchmarkTask, ModelVariant } from "../types.js"

async function buildMastraModel(model: ModelVariant) {
  if (model.provider === "anthropic") {
    const { anthropic } = await import("@ai-sdk/anthropic")
    return anthropic(model.model)
  }
  if (model.provider === "openai") {
    const { openai } = await import("@ai-sdk/openai")
    return openai(model.model)
  }
  throw new Error(`Mastra runner: unsupported provider ${model.provider}`)
}

export const mastraRunner: CompetitorRunner = {
  id: "mastra-agent",
  label: "Mastra",
  framework: "mastra",
  pinnedVersion: "0.x",
  async run(task: BenchmarkTask, model: ModelVariant, tmpDir: string, timeoutMs: number): Promise<TaskRunResult> {
    const start = performance.now()
    try {
      const { Agent } = await import("@mastra/core/agent")
      const { createTool } = await import("@mastra/core/tools")
      const { z } = await import("zod")

      const tools = {
        fileRead: createTool({
          id: "file_read",
          description: "Read a file from the working directory",
          inputSchema: z.object({ path: z.string() }),
          execute: async ({ context }: { context: { path: string } }) => {
            try { return readFileSync(join(tmpDir, context.path), "utf8") }
            catch (e) { return `Error: ${e}` }
          },
        }),
        fileWrite: createTool({
          id: "file_write",
          description: "Write content to a file in the working directory",
          inputSchema: z.object({ path: z.string(), content: z.string() }),
          execute: async ({ context }: { context: { path: string; content: string } }) => {
            try { writeFileSync(join(tmpDir, context.path), context.content, "utf8"); return "ok" }
            catch (e) { return `Error: ${e}` }
          },
        }),
      }

      const agent = new Agent({
        name: `bench-${task.id}`,
        instructions: "You are a helpful assistant. Complete the task carefully.",
        model: await buildMastraModel(model),
        tools,
      })

      const response = await Promise.race([
        agent.generate(task.prompt),
        new Promise<never>((_, r) => setTimeout(() => r(new Error("timeout")), timeoutMs)),
      ])

      return {
        output: response.text ?? "",
        tokensUsed: response.usage?.totalTokens ?? 0,
        durationMs: performance.now() - start,
        iterations: response.steps?.length ?? 1,
        status: "pass",
      }
    } catch (e) {
      return { output: "", tokensUsed: 0, durationMs: performance.now() - start,
        iterations: 0, status: "error", error: e instanceof Error ? e.message : String(e) }
    }
  },
}
