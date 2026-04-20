import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { CompetitorRunner, TaskRunResult } from "./types.js"
import type { BenchmarkTask, ModelVariant } from "../types.js"

export const vercelAiRunner: CompetitorRunner = {
  id: "vercel-ai-sdk",
  label: "Vercel AI SDK",
  framework: "vercel-ai",
  pinnedVersion: "4.x",
  async run(task: BenchmarkTask, model: ModelVariant, tmpDir: string, timeoutMs: number): Promise<TaskRunResult> {
    const start = performance.now()
    try {
      const { generateText, tool } = await import("ai")
      const { z } = await import("zod")

      let llmModel: unknown
      if (model.provider === "anthropic") {
        const { anthropic } = await import("@ai-sdk/anthropic")
        llmModel = anthropic(model.model)
      } else if (model.provider === "openai") {
        const { openai } = await import("@ai-sdk/openai")
        llmModel = openai(model.model)
      } else {
        throw new Error(`Vercel AI runner: unsupported provider ${model.provider}`)
      }

      const tools = {
        file_read: tool({
          description: "Read a file from the working directory",
          parameters: z.object({ path: z.string() }),
          execute: async ({ path }: { path: string }) => {
            try { return readFileSync(join(tmpDir, path), "utf8") }
            catch (e) { return `Error: ${e}` }
          },
        }),
        file_write: tool({
          description: "Write content to a file in the working directory",
          parameters: z.object({ path: z.string(), content: z.string() }),
          execute: async ({ path, content }: { path: string; content: string }) => {
            try { writeFileSync(join(tmpDir, path), content, "utf8"); return "ok" }
            catch (e) { return `Error: ${e}` }
          },
        }),
      }

      const result = await Promise.race([
        generateText({ model: llmModel as Parameters<typeof generateText>[0]["model"],
          prompt: task.prompt, tools, maxSteps: task.maxIterations ?? 15, temperature: 0 }),
        new Promise<never>((_, r) => setTimeout(() => r(new Error("timeout")), timeoutMs)),
      ])

      return {
        output: result.text,
        tokensUsed: result.usage?.totalTokens ?? 0,
        durationMs: performance.now() - start,
        iterations: result.steps?.length ?? 0,
        status: "pass",
      }
    } catch (e) {
      return { output: "", tokensUsed: 0, durationMs: performance.now() - start,
        iterations: 0, status: "error", error: e instanceof Error ? e.message : String(e) }
    }
  },
}
