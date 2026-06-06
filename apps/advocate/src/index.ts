// apps/advocate/src/index.ts
/**
 * Reactive Agents — Community Growth Agent (the "advocate")
 *
 * A persistent, self-improving autonomous agent built on reactive-agents that
 * monitors developer communities, drafts genuinely useful value-first responses,
 * and produces competitive intelligence — all saved for human review, never
 * auto-posted.
 *
 * This is the flagship dogfood: the framework proving itself by running a real
 * 24/7 agent on its own advanced features. The reusable foundation lives in
 * `agent-base.ts` (createMetaAgentBase) — the template for a future suite of
 * internal meta-agents.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... TAVILY_API_KEY=tvly-... bun run src/index.ts
 *   bun run src/index.ts --dry-run   # validate config without starting loop
 */

import { registerShutdownHandlers } from "reactive-agents";
import { makeHealthService } from "@reactive-agents/health";
import { Effect } from "effect";
import {
  communityMonitorTool,
  communityMonitorHandler,
} from "./tools/community-monitor.js";
import { draftWriterTool, draftWriterHandler } from "./tools/draft-writer.js";
import { competitiveIntelTool, competitiveIntelHandler } from "./tools/competitive-intel.js";
import { growthInvariants, growthObservability } from "./harness/growth-harness.js";
import { createMetaAgentBase } from "./agent-base.js";

const isDryRun = process.argv.includes("--dry-run");
const rawAnthropicKey = process.env.ANTHROPIC_API_KEY?.trim() ?? "";
const hasAnthropicKey = rawAnthropicKey.length > 0;
const isPlaceholderAnthropicKey =
  rawAnthropicKey === "sk-ant-..." ||
  rawAnthropicKey === "YOUR_ANTHROPIC_API_KEY" ||
  rawAnthropicKey.endsWith("...");
const hasOllamaConfigured = (process.env.OLLAMA_ENDPOINT?.trim() ?? "").length > 0;

const provider = hasOllamaConfigured ? "ollama" : hasAnthropicKey && !isPlaceholderAnthropicKey ? "anthropic" : "test";
const model = provider === "anthropic" ? "claude-sonnet-4-6" : provider === "ollama" ? "gemma4:latest" : "test-model";
const runtimeMode = isDryRun ? "DRY RUN" : provider === "anthropic" || provider === "ollama" ? "LIVE" : "TEST";
const gatewayTimezone = process.env.GATEWAY_TIMEZONE ?? "UTC";
const cortexUrl = process.env.CORTEX_URL?.trim();

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

// ─── Drafting standard ─────────────────────────────────────────────────────────
// The single biggest lever on "robust, not toy" output. These rules are aligned
// to the grounding grade-gate (lead with value, mention sparingly + never in the
// opening, no hype words) and to the foolproof draft-writer (full draft text goes
// in `content`). Vague personas produce drafts the gate rejects; concrete
// standards produce drafts a human would actually post.
const DRAFTING_STANDARD = [
  "DRAFTING STANDARD — every draft you save MUST:",
  "1. Open with concrete value — directly answer the person's question or solve their problem in the first 2-3 sentences. Do NOT mention reactive-agents in the opening.",
  "2. Be substantive — several well-developed paragraphs (aim for 150+ words) with specifics: code patterns, trade-offs, concrete examples. No platitudes, no filler.",
  "3. Reference reactive-agents only when it genuinely fits, at most once or twice, framed as 'one approach' with a real technical reason — never as a pitch, never first.",
  "4. Use zero hype words. Banned: 'game-changer', 'revolutionary', 'best framework', 'must-try', 'you should use X'. Write like a peer, not a marketer.",
  "5. Put the COMPLETE draft (full markdown) in draft-writer's `content` field — never a summary or a placeholder.",
  "You NEVER post anything yourself — every draft is saved for human review.",
].join("\n");

// ─── Build the agent on the shared advanced baseline ───────────────────────────

const agentBuilder = createMetaAgentBase({
  name: "community-growth-agent",
  provider,
  model: provider === "ollama" ? { model, numCtx: 12_000 } : model,
  // Same-provider fallback for the local fleet — if gemma4 errors, degrade to
  // models that have proven reliable on this harness rather than dropping the loop.
  fallbackModels: provider === "ollama" ? ["qwen3:14b", "cogito:14b"] : [],
})
  // Persona: a practitioner-advocate who leads with value. The drafting standard
  // is appended so the quality bar travels with the persona.
  .withPersona({
    role: "Senior developer advocate for the reactive-agents TypeScript agent framework",
    background:
      "Years building production AI agents in TypeScript with Effect-TS. Hands-on knowledge of " +
      "LangChain/LangGraph, Mastra, Vercel AI SDK, CrewAI and AutoGen — what each does well and where " +
      "reactive-agents genuinely differs (composable reasoning kernel, native Effect-TS, reactive gateway). " +
      "You write like a practitioner helping a peer, never like marketing.\n\n" +
      DRAFTING_STANDARD,
    instructions:
      "Think like a helpful senior engineer first, advocate second. Lead with genuine value in every " +
      "response and follow the DRAFTING STANDARD in your background exactly. Only mention reactive-agents " +
      "when it truly helps the person asking. Save ALL drafts for human review — never claim to have posted.",
    tone: "friendly, technical, peer-to-peer — a helpful senior engineer, not a marketer",
  })

  // Tools: built-ins (web-search, http-get, file-write, scratchpad) + custom community tools
  .withTools({
    tools: [
      { definition: communityMonitorTool, handler: communityMonitorHandler },
      { definition: draftWriterTool, handler: draftWriterHandler },
      { definition: competitiveIntelTool, handler: competitiveIntelHandler },
    ],
  })
  // Observability: surfaces gateway decision logs (cron execute/skip/queue reasons).
  .withObservability({
    verbosity: "debug",
    live: true,
    logModelIO: false,
  })

  // ─── Compose API: domain guardrails + observability taps ────────────────────
  // Hard invariants injected into the system prompt every iteration (persona-
  // independent) + observability taps at live harness chokepoints.
  .withHarness(growthInvariants)
  .withHarness(growthObservability())

  // Gateway: persistent autonomous loop
  .withGateway({
    timezone: gatewayTimezone,
    heartbeat: {
      intervalMs: isDryRun ? 100 : 3_600_000, // hourly community sweep (100ms in dry-run for fast config validation)
      policy: "adaptive",
      instruction:
        "Find and respond to ONE genuinely valuable community thread this heartbeat. Quality over volume. Steps:\n" +
        "1. Call community-monitor to get fresh candidate threads (title, url, snippet).\n" +
        "2. Pick the SINGLE best opportunity where you can add real, specific value — skip the rest.\n" +
        "3. Use http-get on that thread's url to READ THE ACTUAL DISCUSSION. Never fabricate or assume what the thread says; your response must address what people actually wrote.\n" +
        "4. Write ONE substantive response following the DRAFTING STANDARD, grounded in the real thread content.\n" +
        "5. Save it with a SINGLE draft-writer call: put the complete response markdown in `content` and the thread url in `threadUrl`. Never call draft-writer without `content`.\n" +
        "6. Record the thread url in scratchpad so you don't revisit it.\n" +
        "If no thread is genuinely worth a value-add response, save nothing — that is a valid outcome.",
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
          "Save with draft-writer as type: blog-post, platform: markdown, title prefix 'Hourly Competitive Scorecard', and context 'hourly-competitive-scorecard'. " +
          "Use the competitive-intel tool to fetch cited release evidence; cite ONLY those urls with their confidence levels, and mark any claim without an evidence item as 'unverified'. ",
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
          "Save output with draft-writer as type: blog-post, platform: markdown, and include 'competition-sweep-ts' in context. " +
          "Use the competitive-intel tool to fetch cited release evidence; cite ONLY those urls with their confidence levels, and mark any claim without an evidence item as 'unverified'. ",
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
        // Weekly blog post draft — Mondays at 10:00
        schedule: "0 10 * * 1",
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

const builderWithCortex = cortexUrl ? agentBuilder.withCortex(cortexUrl) : agentBuilder;

// Add test responses only in test mode (no real API key)
const agent = await (provider === "test"
  ? builderWithCortex
      .withTestScenario([
        { match: "Check developer", text: "FINAL ANSWER: Monitored communities. Found 2 relevant threads. Saved drafts." },
        { text: "FINAL ANSWER: Community check complete. No new opportunities found." },
      ])
      .withMaxIterations(10)
      .build()
  : builderWithCortex.build());

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
console.log("Drafts will be saved to: apps/advocate/drafts/\n");

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
