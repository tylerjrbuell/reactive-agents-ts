/**
 * Multi-call probe — measures the "N items → N calls" axis (repeated/parallel
 * tool emission), the next surface after single-tool calling was solved
 * cross-tier (2026-06-04). Deterministic, local-or-cloud, no docker.
 *
 * Task names 3 distinct targets and requires one tool call per target. A model
 * that emits all 3 distinct calls (parallel in one turn OR sequentially) and
 * reports all 3 results = SUCCESS. This isolates repeated-call emission from
 * single-call (already 5/5) — the `requiredToolQuantities`/`maxCallsPerTool`
 * machinery exists precisely because weak models tend to fire one call and stop.
 *
 *   SUCCESS   — all 3 distinct (to=EUR,GBP,JPY) calls made AND run succeeded
 *   PARTIAL   — 1-2 of the 3 distinct calls (under-emission)
 *   OVERCALL  — correct 3 distinct but with extra/dup calls (>3 convert calls)
 *   NONE      — zero convert calls
 *   ERROR     — build/run hard failure
 *
 * Env: MODELS (comma-list), N (default 5), PROVIDER (default ollama).
 * Run: PROVIDER=ollama MODELS=qwen3:14b,cogito:14b bun scripts/probes/multicall-probe.ts
 */
import { ReactiveAgents } from "reactive-agents";
import { Effect } from "effect";

const MODELS = (process.env.MODELS ?? process.env.MODEL ?? "qwen3:14b").split(",").map((m) => m.trim()).filter(Boolean);
const N = Number(process.env.N ?? "5");
const PROVIDER = (process.env.PROVIDER ?? "ollama") as "ollama" | "anthropic" | "openai" | "gemini" | "litellm";

const TARGETS = ["EUR", "GBP", "JPY"] as const;
// Deterministic fixed rates — no network, no variance. Only the model's
// emission pattern (how many distinct calls) varies.
const RATES: Record<string, number> = { EUR: 0.92, GBP: 0.79, JPY: 156.3 };

const convertTool = {
  definition: {
    name: "convert_currency",
    description: "Convert an amount from one currency to another. Call once per target currency.",
    parameters: [
      { name: "amount", type: "number", description: "amount to convert", required: true },
      { name: "from", type: "string", description: "source currency code", required: true },
      { name: "to", type: "string", description: "target currency code", required: true },
    ],
  },
  handler: (args: Record<string, unknown>) => {
    const to = String(args.to ?? "").toUpperCase();
    const amount = Number(args.amount ?? 0);
    const rate = RATES[to] ?? 1;
    return Effect.succeed({ from: args.from, to, amount, converted: amount * rate, rate });
  },
};

const TASK = "Convert 100 USD to EUR, GBP, and JPY. Report all three converted amounts.";

type Outcome = "SUCCESS" | "PARTIAL" | "OVERCALL" | "NONE" | "ERROR";

function classify(success: boolean, calls: { name: string; input?: unknown }[]): Outcome {
  const convertCalls = calls.filter((c) => c.name === "convert_currency");
  if (convertCalls.length === 0) return "NONE";
  // distinct target currencies hit (parse the `to` arg from the recorded input)
  const tos = new Set<string>();
  for (const c of convertCalls) {
    let to = "";
    try {
      const inp = typeof c.input === "string" ? JSON.parse(c.input) : (c.input as Record<string, unknown> | undefined);
      to = String(inp?.to ?? "").toUpperCase();
    } catch { /* unparseable arg — skip */ }
    if (TARGETS.includes(to as (typeof TARGETS)[number])) tos.add(to);
  }
  const distinct = tos.size;
  if (distinct < 3) return "PARTIAL";
  // all 3 distinct present
  if (convertCalls.length > 3 || !success) return success ? "OVERCALL" : "PARTIAL";
  return "SUCCESS";
}

async function runCell(model: string): Promise<Record<Outcome, number>> {
  const tally: Record<Outcome, number> = { SUCCESS: 0, PARTIAL: 0, OVERCALL: 0, NONE: 0, ERROR: 0 };
  for (let i = 0; i < N; i++) {
    const modelCfg = PROVIDER === "ollama" ? { model, numCtx: 12000 } : { model };
    const b = ReactiveAgents.create()
      .withPersona({ role: "Agent", background: "", instructions: "Use the provided tools to solve your task.", tone: "concise" })
      .withProvider(PROVIDER)
      .withModel(modelCfg)
      .withReasoning({ defaultStrategy: "reactive", enableStrategySwitching: false })
      .withTools({ tools: [convertTool], allowedTools: ["convert_currency"], metaTools: false });
    try {
      const agent = await b.withObservability({ verbosity: "warn", live: false }).build();
      try {
        const r = await agent.run(TASK);
        const calls = (r.metadata.toolCalls ?? []).map((t) => ({ name: t.name, input: t.arguments }));
        tally[classify(r.success, calls)]++;
      } finally {
        await agent.dispose();
      }
    } catch {
      tally.ERROR++;
    }
    process.stderr.write(".");
  }
  return tally;
}

const results: Record<string, Record<Outcome, number>> = {};
for (const model of MODELS) {
  process.stderr.write(`\n[${model}] N=${N} provider=${PROVIDER} `);
  const tally = await runCell(model);
  results[model] = tally;
  process.stderr.write(`\n  ${model}: ${JSON.stringify(tally)}\n`);
  console.log("MULTICALL_PARTIAL=" + JSON.stringify({ model, tally }));
}
console.log("MULTICALL_MATRIX=" + JSON.stringify({ models: MODELS, n: N, provider: PROVIDER, results }, null, 2));
