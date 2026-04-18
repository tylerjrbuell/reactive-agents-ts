import chalk from "chalk";
import { ReactiveAgents } from "reactive-agents";
import {
  banner,
  kv,
  muted,
  divider,
  agentResponse,
  metricsSummary,
} from "../ui.js";
import { demoResponses, DEMO_TASK } from "./demo-responses.js";

const VIOLET = "#8b5cf6";
const CYAN = "#06b6d4";

type ProviderInfo = { provider: string; model: string; label: string };

function detectProvider(): ProviderInfo | null {
  if (process.env.ANTHROPIC_API_KEY) {
    return {
      provider: "anthropic",
      model: "claude-haiku-4-5-20251001",
      label: "Anthropic · claude-haiku-4-5",
    };
  }
  if (process.env.OPENAI_API_KEY) {
    return {
      provider: "openai",
      model: "gpt-4o-mini",
      label: "OpenAI · gpt-4o-mini",
    };
  }
  if (process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY) {
    return {
      provider: "google",
      model: "gemini-2.0-flash",
      label: "Google · gemini-2.0-flash",
    };
  }
  return null;
}

async function runLiveDemo(detected: ProviderInfo): Promise<void> {
  console.log(chalk.hex(VIOLET).bold("🎯 Task"));
  console.log(kv("Prompt", DEMO_TASK));
  console.log(kv("Provider", chalk.hex(CYAN)(detected.label)));
  console.log(kv("Mode", chalk.green("live agent run")));
  console.log();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const agent = await (ReactiveAgents.create() as any)
    .withName("demo-agent")
    .withProvider(detected.provider)
    .withModel(detected.model)
    .withReasoning()
    .withObservability()
    .build();

  const startTime = Date.now();
  const result = await agent.run(DEMO_TASK);
  const duration = Date.now() - startTime;

  console.log();
  agentResponse(result.output ? String(result.output) : "(no output)");
  console.log();

  metricsSummary({
    duration: result.metadata?.duration ?? duration,
    steps: result.metadata?.stepsCount ?? 1,
    tokens: result.metadata?.tokensUsed ?? 0,
    tools: 0,
    success: result.success,
  });
  console.log();
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function runReplayDemo(): Promise<void> {
  console.log(
    chalk.hex(VIOLET)("ℹ") +
      " " +
      chalk.dim("No API key detected — showing recorded example output.") +
      " " +
      chalk.hex(CYAN)("Set ANTHROPIC_API_KEY (or OPENAI_API_KEY) and re-run for a live agent."),
  );
  console.log();

  console.log(chalk.hex(VIOLET).bold("🎯 Task"));
  console.log(kv("Prompt", DEMO_TASK));
  console.log(kv("Mode", muted("example output (recorded)")));
  console.log();

  for (const step of [
    "Planning approach to research testing frameworks",
    "Evaluating Vitest, Jest, Bun test runner",
    "Synthesizing comparison",
  ]) {
    console.log(`  ${chalk.hex(VIOLET)("💭")} ${chalk.dim(step)}`);
    await sleep(420);
  }
  console.log();

  agentResponse(demoResponses["Find the top 3 TypeScript testing frameworks"]);
  console.log();

  metricsSummary({
    duration: 4200,
    steps: 3,
    tokens: 314,
    tools: 0,
    success: true,
  });
  console.log();
}

export async function runDemo(_argv: string[]): Promise<void> {
  banner(
    "Reactive Agents — Live Demo",
    "The open-source agent framework built for control, not magic.",
  );
  console.log();

  const detected = detectProvider();
  if (detected) {
    await runLiveDemo(detected);
  } else {
    await runReplayDemo();
  }

  divider();
  console.log();
  console.log(chalk.hex(VIOLET).bold("🚀 Liked what you saw?"));
  console.log();
  console.log(kv("Install", chalk.hex(CYAN)("bun add reactive-agents")));
  console.log(kv("Scaffold", chalk.hex(CYAN)("rax init my-agent")));
  console.log(kv("Docs", muted("https://docs.reactiveagents.dev/")));
  console.log(kv("GitHub", muted("https://github.com/tylerjrbuell/reactive-agents-ts")));
  console.log();
}
