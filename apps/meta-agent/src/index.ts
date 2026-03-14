// apps/meta-agent/src/index.ts
/**
 * Reactive Agents — Community Growth Agent
 *
 * A persistent autonomous agent built on reactive-agents that monitors
 * developer communities and drafts value-add responses for human review.
 *
 * This is the meta demo: the framework proving itself.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... TAVILY_API_KEY=tvly-... bun run src/index.ts
 *   bun run src/index.ts --dry-run   # validate config without starting loop
 */

import { ReactiveAgents, registerShutdownHandlers } from "reactive-agents";
import { makeHealthService } from "@reactive-agents/health";
import { Effect } from "effect";
import {
  communityMonitorTool,
  communityMonitorHandler,
} from "./tools/community-monitor.js";
import { draftWriterTool, draftWriterHandler } from "./tools/draft-writer.js";

const isDryRun = process.argv.includes("--dry-run");
const rawAnthropicKey = process.env.ANTHROPIC_API_KEY?.trim() ?? "";
const hasAnthropicKey = rawAnthropicKey.length > 0;
const isPlaceholderAnthropicKey =
  rawAnthropicKey === "sk-ant-..." ||
  rawAnthropicKey === "YOUR_ANTHROPIC_API_KEY" ||
  rawAnthropicKey.endsWith("...");
const hasOllamaConfigured = (process.env.OLLAMA_ENDPOINT?.trim() ?? "").length > 0;

const provider = hasOllamaConfigured ? "ollama" : hasAnthropicKey && !isPlaceholderAnthropicKey ? "anthropic" : "test";
const model = provider === "anthropic" ? "claude-sonnet-4-20250514" : provider === "ollama" ? "qwen3.5" : "test-model";
const runtimeMode = isDryRun ? "DRY RUN" : provider === "anthropic" || provider === "ollama" ? "LIVE" : "TEST";
const gatewayTimezone = process.env.GATEWAY_TIMEZONE ?? "UTC";

if (!isDryRun && hasAnthropicKey && isPlaceholderAnthropicKey) {
  console.warn(
    "⚠️  ANTHROPIC_API_KEY looks like a placeholder (e.g. 'sk-ant-...'). " +
      `Falling back to ${provider} provider for local testing.`,
  );
}

console.log("=== Reactive Agents — Community Growth Agent ===");
console.log(`Mode: ${runtimeMode}`);
console.log(`Provider: ${provider}`);
console.log(`Model: ${model}`);
console.log(`Gateway Timezone: ${gatewayTimezone}\n`);

// ─── Build the agent ──────────────────────────────────────────────────────────

const agentBuilder = ReactiveAgents.create()
  .withName("community-growth-agent")
  .withProvider(provider)
  .withModel(model)
  // Persona: developer advocate, adds value first
  .withPersona({
    role: "Developer Advocate for reactive-agents",
    background:
      "Deep expertise in TypeScript AI agent frameworks, Effect-TS, and developer tooling. " +
      "Knowledgeable about LangChain, Mastra, Vercel AI SDK, and where reactive-agents differs.",
    instructions:
      "ALWAYS lead with genuine value in responses. Only mention reactive-agents when it is " +
      "directly relevant and would genuinely help the person asking. Never spam or self-promote. " +
      "Think like a helpful developer first, advocate second. " +
      "Save ALL drafts for human review — never claim to have posted anything.",
    tone: "friendly, technical, developer-to-developer",
  })

  // Tools: built-ins (web-search, http-get, file-write, scratchpad) + custom community tools
  .withTools({
    tools: [
      { definition: communityMonitorTool, handler: communityMonitorHandler },
      { definition: draftWriterTool, handler: draftWriterHandler },
    ],
  })
  .withObservability({
    verbosity: "debug",
    live: true,
    logModelIO: false, // set to true to see full prompts and responses in logs (can be very verbose)
  })
  // Memory: remember what we've seen to avoid duplicate drafts
  .withMemory("1")

  // Reasoning: adaptive — decides how complex each task needs to be
  .withReasoning({ defaultStrategy: "adaptive" })

  // Observability: required to surface gateway decision logs (cron execute/skip/queue reasons)
  .withObservability({ verbosity: "debug", live: true })

  // Gateway: persistent autonomous loop
  .withGateway({
    timezone: gatewayTimezone,
    heartbeat: {
      intervalMs: isDryRun ? 100 : 60000, // 1 minute for testing, but should be 1 hour in production
      policy: "adaptive",
      instruction:
        "Check developer communities for TypeScript AI agent framework discussions. " +
        "Use the community-monitor tool to find relevant threads on Hacker News, Reddit " +
        "(r/typescript, r/MachineLearning, r/LocalLLaMA, r/node), and dev.to. " +
        "For each genuinely relevant thread where reactive-agents could help: " +
        "draft a value-first response and save it with draft-writer. " +
        "Record thread URLs in scratchpad to avoid revisiting the same threads.",
    },
    crons: [
      {
        // Hourly competitive scorecard — where reactive-agents is winning vs behind
        schedule: "0 * * * *",
        instruction:
          "Create an hourly competitive scorecard for reactive-agents across current AI agent frameworks. " +
          "Use community-monitor plus web-search/http-get to collect fresh signals from docs, release notes, and community discussions. " +
          "Compare against: LangChain/LangGraph (JS + Python), OpenAI Agents, AutoGen, CrewAI, SuperAGI, Mastra, Portkey, VoltAgent, and Agentic.js. " +
          "Output two sections: (1) Where reactive-agents is excelling now, (2) Where reactive-agents is behind now. " +
          "For each point, include concrete evidence links and a confidence level (high/medium/low). " +
          "End with a short 'next 24h actions' list for product/docs/devrel. " +
          "Save with draft-writer as type: blog-post, platform: markdown, title prefix 'Hourly Competitive Scorecard', and context 'hourly-competitive-scorecard'.",
        priority: "high",
      },
      {
        // TypeScript-first competitive sweep — every 12 hours at minute 0
        schedule: "0 */12 * * *",
        instruction:
          "Run a competitive intelligence sweep focused on TypeScript-first agent frameworks. " +
          "Use community-monitor to generate search terms, then use web-search/http-get to gather current updates. " +
          "Prioritize competitors cited in the article https://visiononedge.com/typescript-replacing-python-in-multiagent-systems/: " +
          "Mastra, Portkey, VoltAgent, Agentic.js, LangChain.js, and LangGraph.js. " +
          "Produce a concise comparison draft with: (1) what shipped recently, (2) positioning claims, " +
          "(3) where reactive-agents is meaningfully differentiated, and (4) evidence links. " +
          "Save output with draft-writer as type: blog-post, platform: markdown, and include 'competition-sweep-ts' in context.",
        priority: "high",
      },
      {
        // Python-first competitive sweep — every 12 hours at minute 30 (staggered)
        schedule: "30 */12 * * *",
        instruction:
          "Run a competitive intelligence sweep focused on Python-first agent frameworks that overlap with our buyer journey. " +
          "Use web-search/http-get to gather current updates and benchmark claims against TypeScript production needs. " +
          "Prioritize: Microsoft AutoGen, CrewAI, SuperAGI, LangChain Python, LangGraph Python, and OpenAI Agents (Python track). " +
          "Produce a concise comparison draft with: (1) what shipped recently, (2) workflow strengths, " +
          "(3) production tradeoffs vs TypeScript orchestration, and (4) evidence links. " +
          "Save output with draft-writer as type: blog-post, platform: markdown, and include 'competition-sweep-python' in context.",
        priority: "high",
      },
      {
        // Weekly blog post draft — every 5 minutes for testing, but should be every Monday at 10am in production
        schedule: "*/5 * * * *",
        instruction:
          "Generate a draft blog post for dev.to or Hashnode based on recent reactive-agents " +
          "activity. Topics to consider: new features shipped, interesting usage patterns, " +
          "comparison with other frameworks, TypeScript AI agent patterns. " +
          "Titles that rank well: 'Building X with TypeScript (no Python)', " +
          "'Why I built...', 'TypeScript vs Python for AI agents'. " +
          "Save the draft with draft-writer (type: blog-post, platform: dev.to).",
        priority: "normal",
      },
      {
        // Monthly competitive landscape check — 1st of each month
        schedule: "0 10 1 * *",
        instruction:
          "Research the current TypeScript AI agent framework landscape. Search for: " +
          "Mastra updates, LangChain JS updates, new TS agent frameworks. " +
          "Identify 2-3 concrete differentiators reactive-agents has vs current alternatives. " +
          "Save findings as a draft comparison post.",
        priority: "low",
      },
    ],
    policies: {
      dailyTokenBudget: 100_000,
      maxActionsPerHour: 10,
    },
  });

// Add test responses only in test mode (no real API key)
const agent = await (provider === "test"
  ? agentBuilder
      .withTestScenario([
        { match: "Check developer", text: "FINAL ANSWER: Monitored communities. Found 2 relevant threads. Saved drafts." },
        { text: "FINAL ANSWER: Community check complete. No new opportunities found." },
      ])
      .withMaxIterations(10)
      .build()
  : agentBuilder.build());

console.log(`Agent ID: ${agent.agentId}`);

if (isDryRun) {
  console.log("\nDry run — validating config (1 heartbeat, then stop)...\n");
  const handle = agent.start();
  await new Promise((r) => setTimeout(r, 500));
  const summary = await handle.stop();
  console.log("Summary:", summary);
  await agent.dispose();
  console.log("\n✅ Config valid. Ready to run with: bun run start");
  process.exit(0);
}

// ─── Start the persistent loop ─────────────────────────────────────────────

console.log(`Runtime Mode: ${runtimeMode} (provider: ${provider}, timezone: ${gatewayTimezone})`);
console.log("Starting persistent loop (Ctrl+C to stop)...\n");
console.log("Drafts will be saved to: apps/meta-agent/drafts/\n");

const handle = agent.start();

// ─── Health server (for container deployments) ─────────────────────────────

const healthPort = parseInt(process.env.HEALTH_PORT ?? "3000");

if (!isDryRun) {
  const health = await Effect.runPromise(
    makeHealthService({
      port: healthPort,
      agentName: "community-growth-agent",
    }),
  );
  await Effect.runPromise(health.start());
  console.log(`Health server: http://localhost:${healthPort}/health\n`);
}

// ─── Graceful shutdown (SIGTERM from docker stop, SIGINT from Ctrl+C) ──────

registerShutdownHandlers(handle, () => agent.dispose(), { log: true });

// Wait forever (or until shutdown signal)
await handle.done;
await agent.dispose();
