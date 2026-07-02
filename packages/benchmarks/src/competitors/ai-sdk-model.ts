import type { ModelVariant } from "../types.js"

/**
 * Ollama's OpenAI-compatible endpoint. Competitor frameworks have no native
 * Ollama adapter in our pinned versions, so local models are driven through
 * this compatibility surface — the same chat-completions API the frameworks
 * already speak. Overridable for non-default Ollama hosts.
 */
export const OLLAMA_OPENAI_BASE_URL =
  process.env["OLLAMA_OPENAI_BASE_URL"] ?? "http://localhost:11434/v1"

/**
 * Build an AI SDK LanguageModel for a benchmark ModelVariant.
 * Shared by the Vercel AI and Mastra runners (Mastra consumes AI SDK models).
 * `ollama` routes through the OpenAI-compatible endpoint with an explicit
 * `.chat()` model so we stay on chat-completions (Ollama does not implement
 * the Responses API).
 */
export async function buildAiSdkModel(
  model: ModelVariant,
): Promise<import("ai").LanguageModelV1> {
  if (model.provider === "anthropic") {
    const { anthropic } = await import("@ai-sdk/anthropic")
    return anthropic(model.model)
  }
  if (model.provider === "openai") {
    const { openai } = await import("@ai-sdk/openai")
    return openai(model.model)
  }
  if (model.provider === "ollama") {
    const { createOpenAI } = await import("@ai-sdk/openai")
    const ollama = createOpenAI({
      baseURL: OLLAMA_OPENAI_BASE_URL,
      apiKey: "ollama", // required by the client, ignored by the server
    })
    return ollama.chat(model.model)
  }
  throw new Error(`AI SDK model builder: unsupported provider ${model.provider}`)
}
