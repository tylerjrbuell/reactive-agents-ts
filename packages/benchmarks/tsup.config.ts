import { defineConfig } from "tsup"
import baseConfig from "../../tsup.config.base.js"

export default defineConfig({
  ...baseConfig,
  // Competitor framework packages and their transitive deps must be external —
  // they are optional devDependencies resolved at runtime via dynamic import.
  external: [
    ...(Array.isArray(baseConfig.external) ? baseConfig.external : []),
    "@langchain/langgraph",
    "@langchain/core",
    "@langchain/anthropic",
    "@langchain/openai",
    "ai",
    "@ai-sdk/anthropic",
    "@ai-sdk/openai",
    "@openai/agents",
    "@mastra/core",
    "llamaindex",
    "@llamaindex/core",
    "@llamaindex/anthropic",
    "@llamaindex/openai",
    "@llamaindex/postgres",
    "pgvector",
    /^@langchain\//,
    /^@llamaindex\//,
    /^@mastra\//,
    /^@ai-sdk\//,
  ],
})
