import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { CompetitorRunner, TaskRunResult } from "./types.js"
import type { BenchmarkTask, ModelVariant } from "../types.js"

export const llamaindexRunner: CompetitorRunner = {
  id: "llamaindex-ts",
  label: "LlamaIndex TS",
  framework: "llamaindex",
  pinnedVersion: "0.x",
  async run(task: BenchmarkTask, model: ModelVariant, tmpDir: string, timeoutMs: number): Promise<TaskRunResult> {
    if (model.provider !== "anthropic" && model.provider !== "openai") {
      return {
        output: "",
        tokensUsed: 0,
        durationMs: 0,
        iterations: 0,
        status: "error",
        error: `LlamaIndex runner: unsupported provider ${model.provider} — skipped`,
      }
    }

    const start = performance.now()
    try {
      const { FunctionTool, ReActAgent } = await import("llamaindex")

      const tools = [
        FunctionTool.from(
          ({ path }: { path: string }) => {
            try { return readFileSync(join(tmpDir, path), "utf8") }
            catch (e) { return `Error: ${e}` }
          },
          { name: "file_read", description: "Read a file from the working directory",
            parameters: { type: "object" as const, properties: { path: { type: "string" as const } }, required: ["path"] } },
        ),
        FunctionTool.from(
          ({ path, content }: { path: string; content: string }) => {
            try { writeFileSync(join(tmpDir, path), content, "utf8"); return "ok" }
            catch (e) { return `Error: ${e}` }
          },
          { name: "file_write", description: "Write content to a file in the working directory",
            parameters: { type: "object" as const, properties: { path: { type: "string" as const }, content: { type: "string" as const } }, required: ["path", "content"] } },
        ),
      ]

      type LlamaLLM = import("@llamaindex/core/llms").LLM
      let llm: LlamaLLM
      if (model.provider === "openai") {
        const { OpenAI } = await import("llamaindex")
        llm = new OpenAI({ model: model.model, temperature: 0 })
      } else {
        const { Anthropic } = await import("llamaindex")
        llm = new Anthropic({ model: model.model, temperature: 0 })
      }

      const agent = new ReActAgent({ tools, llm, verbose: false })
      const response = await Promise.race([
        agent.chat({ message: task.prompt }),
        new Promise<never>((_, r) => setTimeout(() => r(new Error("timeout")), timeoutMs)),
      ])

      return {
        output: response.response ?? "",
        tokensUsed: 0,
        durationMs: performance.now() - start,
        iterations: 0,
        status: "pass",
      }
    } catch (e) {
      return { output: "", tokensUsed: 0, durationMs: performance.now() - start,
        iterations: 0, status: "error", error: e instanceof Error ? e.message : String(e) }
    }
  },
}
