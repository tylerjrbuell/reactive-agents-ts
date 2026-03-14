import chalk from "chalk";
import { ReactiveAgents } from "@reactive-agents/runtime";
import {
  banner,
  spinner,
  agentResponse,
  thinking,
  metricsSummary,
  divider,
  kv,
  muted,
} from "../ui.js";
import { formatMetricsDashboard, type DashboardData } from "@reactive-agents/observability";
import { demoResponses, DEMO_TASK } from "./demo-responses.js";

const VIOLET = "#8b5cf6";
const CYAN = "#06b6d4";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runDemo(_argv: string[]): Promise<void> {
  // Banner
  banner(
    "Reactive Agents — Live Demo",
    "The open-source agent framework built for control, not magic.",
  );
  console.log();

  // Task + config (stagger each line slightly)
  console.log(chalk.hex(VIOLET).bold("🎯 Task"));
  console.log(kv("Prompt", DEMO_TASK));
  await sleep(150);
  console.log(kv("Provider", "test (deterministic, no API key needed)"));
  console.log(kv("Mode", "direct LLM (scripted response)"));
  console.log();
  await sleep(300);

  // Build agent
  const buildSpin = spinner("Building agent...");
  const agent = await ReactiveAgents.create()
    .withName("demo-agent")
    .withTestScenario([
      { match: "Find the top 3 TypeScript testing frameworks", text: demoResponses["Find the top 3 TypeScript testing frameworks"] },
      { text: demoResponses[""] },
    ])
    .build();
  await sleep(600);
  buildSpin.succeed("Agent ready");
  console.log();
  await sleep(400);

  // Simulate step-by-step execution
  const execSpin = spinner("Running agent...");
  await sleep(500);
  execSpin.text = "Analyzing task...";
  await sleep(700);
  execSpin.stop();

  thinking(1, 3);
  console.log(`   ${muted("Planning approach to research testing frameworks")}`);
  console.log();
  await sleep(600);

  thinking(2, 3);
  console.log(`   ${muted("Evaluating Vitest, Jest, Bun test runner...")}`);
  console.log();
  await sleep(600);

  thinking(3, 3);
  console.log(`   ${muted("Synthesizing comparison")}`);
  console.log();
  await sleep(400);

  // Actually run the agent (fast — test provider)
  const startTime = Date.now();
  const result = await agent.run(DEMO_TASK);
  const realDuration = Date.now() - startTime;

  // Use a presentable duration (~3s total including delays)
  const presentedDuration = 2800 + realDuration;

  const completeSpin = spinner("Formatting response...");
  await sleep(500);
  completeSpin.succeed(`Completed in ${(presentedDuration / 1000).toFixed(1)}s`);
  console.log();

  // Agent response
  agentResponse(result.output || "(no output)");
  console.log();
  await sleep(300);

  // Dashboard
  const tokenCount = result.metadata.tokensUsed ?? 314;
  const dashboardData: DashboardData = {
    status: result.success ? "success" : "error",
    totalDuration: presentedDuration,
    stepCount: 3,
    tokenCount,
    estimatedCost: tokenCount * 0.000003,
    modelName: "test",
    provider: "test",
    phases: [
      { name: "bootstrap", duration: 45, status: "ok" },
      { name: "strategy", duration: 30, status: "ok" },
      { name: "think", duration: Math.round(presentedDuration * 0.65), status: "ok", details: "3 iterations" },
      { name: "complete", duration: 15, status: "ok" },
    ],
    tools: [],
    alerts: [],
  };

  console.log(formatMetricsDashboard(dashboardData));
  console.log();

  metricsSummary({
    duration: presentedDuration,
    steps: 3,
    tokens: tokenCount,
    tools: 0,
    success: result.success,
  });
  console.log();

  // CTA
  divider();
  console.log();
  console.log(chalk.hex(VIOLET).bold("🚀 Liked what you saw?"));
  console.log();
  console.log(kv("Install", chalk.hex(CYAN)("bun add reactive-agents")));
  console.log(kv("Scaffold", chalk.hex(CYAN)("rax init my-agent --template standard")));
  console.log(
    kv("Docs", muted("https://docs.reactiveagents.dev/")),
  );
  console.log(
    kv("GitHub", muted("https://github.com/tylerjrbuell/reactive-agents-ts")),
  );
  console.log();
}
