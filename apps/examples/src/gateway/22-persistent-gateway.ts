/**
 * Example 22: Persistent Autonomous Gateway
 *
 * Demonstrates the Gateway — a persistent harness that keeps an agent running
 * 24/7 without a dedicated server. Key features shown:
 *
 * - Heartbeat: periodic "check in" calls on an adaptive schedule
 * - Crons: cron-scheduled instructions (e.g. "Review PRs every Monday 9am")
 * - Policies: daily token budget, max actions per hour
 * - agent.start() / handle.stop(): launch and cleanly shut down the loop
 * - GatewaySummary: heartbeatsFired, totalRuns, cronChecks
 *
 * In production, you would call agent.start() and never call stop() —
 * the process stays alive and the agent responds to heartbeats, crons,
 * and (optionally) inbound webhooks. In this example we start it, let
 * a few heartbeats fire, then stop it cleanly.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... bun run apps/examples/src/gateway/22-persistent-gateway.ts
 *   bun run apps/examples/src/gateway/22-persistent-gateway.ts   # test mode
 */

import { ReactiveAgents } from "reactive-agents";

export interface ExampleResult {
  passed: boolean;
  output: string;
  steps: number;
  tokens: number;
  durationMs: number;
}

export async function run(opts?: { provider?: string; model?: string }): Promise<ExampleResult> {
  const start = Date.now();

  type PN = "anthropic" | "openai" | "ollama" | "gemini" | "litellm" | "test";
  const provider = (opts?.provider ?? (process.env.ANTHROPIC_API_KEY ? "anthropic" : "test")) as PN;

  console.log("\n=== Persistent Gateway Example ===");
  console.log(`Mode: ${provider !== "test" ? `LIVE (${provider})` : "TEST (deterministic)"}\n`);

  // ─── Build the gateway agent ─────────────────────────────────────────────────
  //
  // .withGateway() turns a normal agent into a persistent autonomous agent.
  // The gateway loop fires on heartbeat, checks cron schedules, enforces policies,
  // and optionally handles inbound webhooks — all without a custom server.

  let b = ReactiveAgents.create()
    .withName("ops-agent")
    .withProvider(provider);
  if (opts?.model) b = b.withModel(opts.model);

  const agent = await b
    .withReasoning()
    .withTools()
    .withGateway({
      // Heartbeat: check in every 30 min in production; fast in test mode
      heartbeat: {
        intervalMs: provider === "test" ? 80 : 1_800_000,
        policy: "adaptive",          // skip if nothing useful to do
        instruction: "Check for any pending tasks or anomalies and report status.",
      },
      // Crons: scheduled instructions (standard cron syntax)
      crons: [
        {
          schedule: "0 9 * * MON",   // every Monday at 9am
          instruction: "Review open GitHub issues and draft a weekly summary.",
          priority: "normal",
        },
        {
          schedule: "0 18 * * FRI",  // every Friday at 6pm
          instruction: "Compile the week's completed work into a brief report.",
          priority: "low",
        },
      ],
      // Policies: guard rails for the autonomous loop
      policies: {
        dailyTokenBudget: 50_000,    // hard stop at 50K tokens/day
        maxActionsPerHour: 20,       // rate-limit autonomous actions
      },
    })
    .withTestScenario([
      // Deterministic responses for test mode
      { match: "Check for", text: "FINAL ANSWER: Status OK. No pending tasks or anomalies detected." },
      { match: "pending", text: "FINAL ANSWER: No pending items found. All systems nominal." },
      { text: "FINAL ANSWER: Heartbeat acknowledged. No action required." },
    ])
    .withMaxIterations(3)
    .build();

  console.log(`Agent ID: ${agent.agentId}`);
  console.log("Starting gateway loop...\n");

  // ─── Start the persistent loop ────────────────────────────────────────────────
  //
  // agent.start() is non-blocking — it kicks off the gateway loop in the
  // background and returns a GatewayHandle immediately.
  //
  // In production: call start() and await handle.done (never resolves unless
  // you call stop() or an unrecoverable error occurs).
  //
  // In this example: let a few heartbeats fire, then stop cleanly.

  const handle = agent.start();

  // Let a couple of heartbeats fire (only in test mode with fast interval)
  const waitMs = provider === "test" ? 250 : 5_000;
  console.log(`  Waiting ${waitMs}ms for heartbeats to fire...`);
  await new Promise((r) => setTimeout(r, waitMs));

  // ─── Stop the gateway ─────────────────────────────────────────────────────────

  console.log("\nStopping gateway...");
  const summary = await handle.stop();

  console.log("\n─── Gateway Summary ───");
  console.log(`  Heartbeats fired : ${summary.heartbeatsFired}`);
  console.log(`  Total agent runs : ${summary.totalRuns}`);
  console.log(`  Cron checks      : ${summary.cronChecks}`);
  if (summary.error) {
    console.log(`  Error            : ${summary.error}`);
  }

  await agent.dispose();
  console.log("\nDone.");

  const passed =
    summary.heartbeatsFired >= 1 &&
    typeof summary.totalRuns === "number" &&
    !summary.error;

  return {
    passed,
    output: `heartbeats=${summary.heartbeatsFired} runs=${summary.totalRuns} cronChecks=${summary.cronChecks}`,
    steps: summary.totalRuns,
    tokens: 0,
    durationMs: Date.now() - start,
  };
}

if (import.meta.main) {
  const r = await run();
  console.log(r.passed ? "\n✅ PASS" : "\n❌ FAIL", r.output);
  process.exit(r.passed ? 0 : 1);
}
