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

import { ReactiveAgents } from "reactive-agents";
import { communityMonitorTool } from "./tools/community-monitor.js";
import { draftWriterTool } from "./tools/draft-writer.js";

const isDryRun = process.argv.includes("--dry-run");
const provider = process.env.ANTHROPIC_API_KEY ? "anthropic" : "test";

console.log("=== Reactive Agents — Community Growth Agent ===");
console.log(`Mode: ${isDryRun ? "DRY RUN" : provider === "anthropic" ? "LIVE" : "TEST"}\n`);

// ─── Build the agent ──────────────────────────────────────────────────────────

const agentBuilder = ReactiveAgents.create()
  .withName("community-growth-agent")
  .withProvider(provider === "anthropic" ? "anthropic" : "test")
  .withModel("claude-sonnet-4-20250514")

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

  // Tools: search communities, fetch pages, save drafts, scratchpad for state
  .withTools({
    include: ["web-search", "http-get", "file-write", "scratchpad-write", "scratchpad-read"],
    custom: [communityMonitorTool, draftWriterTool],
  })

  // Memory: remember what we've seen to avoid duplicate drafts
  .withMemory("1")

  // Reasoning: adaptive — decides how complex each task needs to be
  .withReasoning({ defaultStrategy: "adaptive" })

  // Gateway: persistent autonomous loop
  .withGateway({
    heartbeat: {
      intervalMs: isDryRun ? 100 : 6 * 60 * 60 * 1000, // 6 hours in production
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
        // Weekly blog post draft — every Monday at 9am
        schedule: "0 9 * * MON",
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
      .withTestResponses({
        "Check developer": "FINAL ANSWER: Monitored communities. Found 2 relevant threads. Saved drafts.",
        "": "FINAL ANSWER: Community check complete. No new opportunities found.",
      })
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

console.log("Starting persistent loop (Ctrl+C to stop)...\n");
console.log("Drafts will be saved to: apps/meta-agent/drafts/\n");

const handle = agent.start();

// Graceful shutdown on Ctrl+C
process.on("SIGINT", async () => {
  console.log("\nShutting down...");
  const summary = await handle.stop();
  console.log("Summary:", summary);
  await agent.dispose();
  process.exit(0);
});

// Wait forever (or until stop() is called)
await handle.done;
await agent.dispose();
