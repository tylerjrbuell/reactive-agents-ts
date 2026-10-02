/**
 * Strategy Demo -- three reasoning strategies, one task, real budgets.
 *
 *   reactive:              the think -> act -> observe loop
 *   plan-execute-reflect:  plans every step first, executes, then reflects
 *   adaptive:              the framework ANALYZES the task and picks for you
 *
 * The adaptive row is the one to watch: you never choose its strategy;
 * the framework analyzes the task and routes it, and every run reports
 * its strategy metadata (`strategyUsed`). Each run declares a
 * .withBudget({ tokenLimit }) cap - enforced by the reactive kernel's
 * pre-intent guard, and reported per run below - so the comparison
 * shows what each approach costs, not just what it says.
 *
 * Setup: add a key in StackBlitz Secrets (GOOGLE_API_KEY recommended -
 * free tier at ai.google.dev). See .env.example for all options.
 */

import { ReactiveAgents } from "reactive-agents";
import {
  createFinisher,
  hasKeyFor,
  printSetupGuide,
  resolveProvider,
} from "./env-setup";

type Strategy =
  | "reactive"
  | "plan-execute-reflect"
  | "tree-of-thought"
  | "reflexion"
  | "adaptive";

const provider = resolveProvider("gemini");

if (!hasKeyFor(provider)) {
  printSetupGuide();
  process.exit(0);
}

const model = process.env.MODEL?.trim() || undefined;

const STRATEGIES: Strategy[] = ["reactive", "plan-execute-reflect", "adaptive"];
const strategies: Strategy[] = process.env.STRATEGIES?.trim()
  ? (process.env.STRATEGIES
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0) as Strategy[])
  : STRATEGIES;

const budgetLimit = Number(process.env.BUDGET_TOKENS ?? 20_000);

const task =
  process.env.TASK ??
  "A checkout API started timing out right after a deploy. Propose a 3-step " +
  "debugging plan ordered by which step eliminates the most uncertainty first, " +
  "and justify the order in one sentence per step.";

console.log(
  `\nProvider: ${provider}${model ? ` (${model})` : " (provider default)"}`
);
console.log(`Task: ${task}`);
console.log(`Comparing: ${strategies.join(" vs ")}`);
console.log(`Per-run budget: ${budgetLimit.toLocaleString()} tokens\n`);
console.log("Running all strategies in parallel...\n");

interface RunResult {
  readonly strategy: string;
  readonly strategyUsed: string;
  readonly ok: boolean;
  readonly verdict: string;
  readonly output: string;
  readonly steps: number;
  readonly tokens: number;
  readonly durationMs: number;
}

async function runWithStrategy(strategy: Strategy): Promise<RunResult> {
  const start = Date.now();
  console.log(`-- Starting: ${strategy} --`);

  let builder = ReactiveAgents.create()
    .withName(`strategy-${strategy}`)
    .withProvider(provider);

  if (model) builder = builder.withModel(model);

  const agent = await builder
    .withObservability({ verbosity: "minimal" }) // three parallel runs - keep the shared terminal readable
    .withReasoning({ defaultStrategy: strategy })
    .withBudget({ tokenLimit: budgetLimit }) // declared cap; the reactive kernel's arbitrator halts past it
    .withMaxIterations(6)
    .build();

  let ok = false;
  let strategyUsed: string = strategy;
  let verdict = "(none)";
  let output = "";
  let steps = 0;
  let tokens = 0;

  try {
    const result = await agent.run(task);
    ok = result.success && result.output.trim().length > 0;
    output = result.output;
    steps = result.metadata.stepsCount;
    tokens = result.metadata.tokensUsed;
    // What the framework ACTUALLY ran - for adaptive this is the router's
    // pick, which may differ from any fixed strategy.
    strategyUsed = result.metadata.strategyUsed ?? strategy;
    verdict = result.receipt?.verdict ?? "(none)";
  } catch (error) {
    output = error instanceof Error ? error.message : String(error);
  } finally {
    await agent.dispose();
  }

  console.log(
    `[done] ${strategy} in ${Date.now() - start}ms ` +
      `(${steps} steps, used: ${strategyUsed})\n`
  );

  return { strategy, strategyUsed, ok, verdict, output, steps, tokens, durationMs: Date.now() - start };
}

const results = await Promise.all(strategies.map(runWithStrategy));

console.log("===============================================");
console.log("                  COMPARISON                  ");
console.log("===============================================");

for (const r of results) {
  console.log(`\n[${r.strategy}] -> reported strategy: ${r.strategyUsed}`);
  console.log(`  ok:       ${r.ok ? "yes" : "no"}`);
  console.log(`  verdict:  ${r.verdict}`);
  console.log(`  steps:    ${r.steps}`);
  console.log(`  tokens:   ${r.tokens.toLocaleString()} / ${budgetLimit.toLocaleString()} budget`);
  console.log(`  duration: ${r.durationMs}ms`);
  console.log(
    `  output:   ${r.output.slice(0, 120)}${r.output.length > 120 ? "..." : ""}`
  );
}

const finisher = createFinisher();
for (const r of results) {
  finisher.add({
    label: `${r.strategy} run`,
    ok: r.ok,
    detail: r.ok ? `${r.tokens} tokens` : r.output.slice(0, 100),
  });
}
finisher.report();

console.log("\n-----------------------------------------------");
const cheapest = [...results].sort((a, b) => a.tokens - b.tokens)[0];
console.log(
  `Most token-efficient: ${cheapest.strategy} (${cheapest.tokens.toLocaleString()} tokens)`
);
console.log(
  "\nTry STRATEGIES=reactive,tree-of-thought or BUDGET_TOKENS=10000 in Secrets."
);
