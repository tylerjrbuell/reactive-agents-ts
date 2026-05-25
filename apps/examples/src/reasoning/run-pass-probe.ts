/**
 * Live probe — primitive #3 (runPass) verification.
 *
 * Runs reflexion + reactive against ollama + crypto-price.
 * Validates that the shared runPass primitive preserves behavior on both
 * a multi-pass strategy (reflexion: gen + N improves) and a single-pass
 * strategy (reactive: 1 kernel invocation).
 *
 * Asserts:
 *   - No crash
 *   - Real price in output (proves the resolvePassOutput fallback chain
 *     surfaced the kernel-produced final answer to the strategy)
 *   - No placeholder leakage (covered by primitives #1+#2 but re-asserted
 *     to catch any regression introduced by the #3 migration)
 *
 * Run:  bun apps/examples/src/reasoning/run-pass-probe.ts
 */
import { ReactiveAgents } from "reactive-agents";

const MODEL = process.env.MODEL ?? "qwen3.5:latest";
const TASK =
  "Use the crypto-price tool to fetch the current price of ETH in USD. " +
  "Then write a single sentence with the exact numeric price. No placeholders.";

type Strat = "reflexion" | "reactive";
const STRATEGIES: readonly Strat[] = ["reflexion", "reactive"];

const PRICE_RE = /\$?\s*\d{1,3}(?:,\d{3})+|\$?\s*\d{2,}\.\d{2,}|\$?\s*\d{3,}/;
const PLACEHOLDER_RE = /\[(?:insert|placeholder|tbd|fill[\s-]?in|value|number|price)[^\]]*\]/i;

interface ProbeRow {
  strategy: Strat;
  status: string;
  tokens: number;
  durationMs: number;
  steps: number;
  hasOutput: boolean;
  hasRealPrice: boolean;
  hasPlaceholder: boolean;
  outputPreview: string;
}

async function runOne(strategy: Strat): Promise<ProbeRow> {
  const start = Date.now();
  const agent = await ReactiveAgents.create()
    .withName(`run-pass-probe-${strategy}`)
    .withProvider("ollama")
    .withModel(MODEL)
    .withTools({ allowedTools: ["crypto-price"] })
    .withReasoning({ defaultStrategy: strategy, enableStrategySwitching: false })
    .withMaxIterations(4)
    .build();

  const result = await agent.run(TASK);
  await agent.dispose();

  const output = result.output ?? "";
  const steps = result.steps ?? [];
  return {
    strategy,
    status: result.status ?? "unknown",
    tokens: result.metadata?.tokensUsed ?? 0,
    durationMs: Date.now() - start,
    steps: steps.length,
    hasOutput: output.trim().length > 0,
    hasRealPrice: PRICE_RE.test(output),
    hasPlaceholder: PLACEHOLDER_RE.test(output),
    outputPreview: output.slice(0, 250).replace(/\n/g, "\\n"),
  };
}

const rows: ProbeRow[] = [];
for (const s of STRATEGIES) {
  console.log(`\n=== Running ${s} on ${MODEL} (primitive #3 runPass probe) ===`);
  try {
    const row = await runOne(s);
    rows.push(row);
    console.log(`  status=${row.status} tokens=${row.tokens} steps=${row.steps} duration=${row.durationMs}ms`);
    console.log(`  hasOutput=${row.hasOutput} hasRealPrice=${row.hasRealPrice} hasPlaceholder=${row.hasPlaceholder}`);
    console.log(`  output: ${row.outputPreview}`);
  } catch (err) {
    console.log(`  CRASH: ${err}`);
    rows.push({
      strategy: s,
      status: "crashed",
      tokens: 0,
      durationMs: 0,
      steps: 0,
      hasOutput: false,
      hasRealPrice: false,
      hasPlaceholder: false,
      outputPreview: String(err).slice(0, 200),
    });
  }
}

console.log("\n=== runPass Probe Summary ===");
console.log("strategy   | status     | steps | output | realPrice | placeholder | tokens | ms");
console.log("-----------+------------+-------+--------+-----------+-------------+--------+------");
for (const r of rows) {
  const pad = (s: string, n: number) => s.padEnd(n);
  console.log(
    `${pad(r.strategy, 10)} | ${pad(r.status, 10)} | ${pad(String(r.steps), 5)} | ${pad(String(r.hasOutput), 6)} | ${pad(String(r.hasRealPrice), 9)} | ${pad(String(r.hasPlaceholder), 11)} | ${pad(String(r.tokens), 6)} | ${r.durationMs}`,
  );
}

const verdict = rows.every(
  (r) => r.status !== "crashed" && r.hasOutput && r.hasRealPrice && !r.hasPlaceholder,
);
console.log(
  verdict
    ? "\n✅ runPass PROBE PASS — multi-pass (reflexion) + single-pass (reactive) both clean via shared runPass"
    : "\n❌ runPass PROBE FAIL — see per-row diagnostics",
);
process.exit(verdict ? 0 : 1);
