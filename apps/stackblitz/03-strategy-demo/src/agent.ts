/**
 * Strategy Demo -- side-by-side reasoning comparison
 *
 * Runs the same task with two strategies and compares:
 *   reactive:             ReAct loop (think -> act -> observe)
 *   plan-execute-reflect: Plan all steps first, execute, then reflect
 *
 * Try the other available strategies via STRATEGY_B env var:
 *   tree-of-thought | reflexion | adaptive
 *
 * Secrets to add in Stackblitz (Settings icon, left sidebar):
 *   GOOGLE_API_KEY     -> ai.google.dev  (recommended, free tier)
 *   ANTHROPIC_API_KEY  -> console.anthropic.com
 *   OPENAI_API_KEY     -> platform.openai.com
 *
 *   Or use local Ollama:
 *   PROVIDER=ollama
 *   OLLAMA_ENDPOINT=http://localhost:11434
 */

import { ReactiveAgents } from "reactive-agents";

type PN = "gemini" | "anthropic" | "openai" | "ollama";
type Strategy = "reactive" | "plan-execute-reflect" | "tree-of-thought" | "reflexion" | "adaptive";

const provider = (process.env.PROVIDER ?? "gemini") as PN;

// Treat empty / unedited placeholder values as "no key" so the user gets
// the friendly setup message instead of a provider 400.
const realKey = (v?: string) =>
  !!v && v.trim().length > 0 && !/^your_|_here$|^<.*>$/i.test(v.trim());

const hasKey =
  realKey(process.env.GOOGLE_API_KEY) ||
  realKey(process.env.ANTHROPIC_API_KEY) ||
  realKey(process.env.OPENAI_API_KEY) ||
  provider === "ollama";

if (!hasKey) {
  console.log(`
================================================
  No API key found. Add one in Stackblitz Secrets:

  GOOGLE_API_KEY     -> ai.google.dev   (free tier, recommended)
  ANTHROPIC_API_KEY  -> console.anthropic.com
  OPENAI_API_KEY     -> platform.openai.com

  For local Ollama (Chrome only):
    PROVIDER          = ollama
    OLLAMA_ENDPOINT   = http://localhost:11434
    (run: OLLAMA_ORIGINS=* ollama serve)
================================================
`);
  process.exit(0);
}

const model =
  process.env.MODEL ??
  (provider === "gemini"
    ? "gemini-1.5-flash"
    : provider === "ollama"
      ? "llama3.2"
      : undefined);

const strategyA = (process.env.STRATEGY_A ?? "reactive") as Strategy;
const strategyB = (process.env.STRATEGY_B ?? "plan-execute-reflect") as Strategy;

const task =
  process.env.TASK ??
  "Explain in 2-3 sentences why distributed systems are harder to debug than single-process applications.";

console.log(`\nProvider: ${provider}${model ? ` (${model})` : ""}`);
console.log(`Task: ${task}`);
console.log(`Comparing: ${strategyA} vs ${strategyB}\n`);
console.log("Running both strategies in parallel...\n");

type RunResult = { strategy: Strategy; output: string; steps: number; tokens: number; durationMs: number };

async function runWithStrategy(strategy: Strategy): Promise<RunResult> {
  const start = Date.now();
  console.log(`-- Starting: ${strategy} --`);

  const agent = await ReactiveAgents.create()
    .withName(`strategy-${strategy}`)
    .withProvider(provider)
    .withModel(model ?? "")
    .withReasoning({ defaultStrategy: strategy })
    .withMaxIterations(6)
    .build();

  const result = await agent.run(task);

  console.log(`[done] ${strategy} in ${Date.now() - start}ms (${result.metadata.stepsCount} steps)\n`);

  return {
    strategy,
    output: result.output,
    steps: result.metadata.stepsCount,
    tokens: result.metadata.tokensUsed,
    durationMs: Date.now() - start,
  };
}

const [resultA, resultB] = await Promise.all([
  runWithStrategy(strategyA),
  runWithStrategy(strategyB),
]);

console.log("===============================================");
console.log("                  COMPARISON                  ");
console.log("===============================================");

for (const r of [resultA, resultB]) {
  console.log(`\n[${r.strategy}]`);
  console.log(`  Steps:    ${r.steps}`);
  console.log(`  Tokens:   ${r.tokens}`);
  console.log(`  Duration: ${r.durationMs}ms`);
  console.log(`  Output:   ${r.output.slice(0, 120)}${r.output.length > 120 ? "..." : ""}`);
}

console.log("\n-----------------------------------------------");
const winner = resultA.tokens <= resultB.tokens ? resultA : resultB;
console.log(`More token-efficient: ${winner.strategy} (${winner.tokens} tokens)`);
console.log(`\nTry changing STRATEGY_B to: tree-of-thought | reflexion | adaptive`);
