import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { CompetitorRunner, TaskRunResult } from "./types.js"
import type { BenchmarkTask, ModelVariant } from "../types.js"

export const langchainRunner: CompetitorRunner = {
  id: "langchain-react",
  label: "LangChain JS",
  framework: "langchain",
  pinnedVersion: "0.3.x / langgraph 0.2.x",
  async run(task: BenchmarkTask, model: ModelVariant, tmpDir: string, timeoutMs: number): Promise<TaskRunResult> {
    const start = performance.now()
    try {
      const { createReactAgent } = await import("@langchain/langgraph/prebuilt")
      const { HumanMessage } = await import("@langchain/core/messages")
      const { DynamicStructuredTool } = await import("@langchain/core/tools")
      const { z } = await import("zod")

      type LangChainLLM = import("@langchain/core/language_models/base").LanguageModelLike
      let llm: LangChainLLM
      if (model.provider === "anthropic") {
        const { ChatAnthropic } = await import("@langchain/anthropic")
        llm = new ChatAnthropic({ model: model.model, temperature: 0 })
      } else if (model.provider === "openai") {
        const { ChatOpenAI } = await import("@langchain/openai")
        llm = new ChatOpenAI({ model: model.model, temperature: 0 })
      } else {
        throw new Error(`LangChain runner: unsupported provider ${model.provider}`)
      }

      const tools = [
        new DynamicStructuredTool({
          name: "file_read",
          description: "Read a file from the working directory",
          schema: z.object({ path: z.string() }),
          func: async ({ path }: { path: string }) => {
            try { return readFileSync(join(tmpDir, path), "utf8") }
            catch (e) { return `Error: ${e}` }
          },
        }),
        new DynamicStructuredTool({
          name: "file_write",
          description: "Write content to a file in the working directory",
          schema: z.object({ path: z.string(), content: z.string() }),
          func: async ({ path, content }: { path: string; content: string }) => {
            try { writeFileSync(join(tmpDir, path), content, "utf8"); return "ok" }
            catch (e) { return `Error: ${e}` }
          },
        }),
      ]

      const agent = createReactAgent({ llm, tools })
      const response = await Promise.race([
        agent.invoke({ messages: [new HumanMessage(task.prompt)] }),
        new Promise<never>((_, r) => setTimeout(() => r(new Error("timeout")), timeoutMs)),
      ])

      const lastMsg = response.messages[response.messages.length - 1]
      const output = typeof lastMsg?.content === "string"
        ? lastMsg.content
        : JSON.stringify(lastMsg?.content ?? "")

      return {
        output,
        tokensUsed: 0,
        durationMs: performance.now() - start,
        iterations: response.messages.filter((m: { _getType?: () => string }) => m._getType?.() === "tool").length,
        status: "pass",
      }
    } catch (e) {
      return { output: "", tokensUsed: 0, durationMs: performance.now() - start,
        iterations: 0, status: "error", error: e instanceof Error ? e.message : String(e) }
    }
  },
}
