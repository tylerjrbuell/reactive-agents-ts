/**
 * Live tool probe — Phase 0 E1 verification with REAL tool execution.
 *
 * This is the exact failure mode that motivated the 0af217c8 fix:
 *   reflexion previously produced markdown reports with `[Insert BTC Price Here]`
 *   placeholders despite crypto-price returning real values. Synthesis was
 *   patching the draft rather than seeing the raw tool data.
 *
 * The Phase 0 extraction lifted that fix into kernel/loop/finalize.ts and
 * routes both reflexion and plan-execute through it. This probe runs both
 * strategies against the live crypto-price tool (hits CoinGecko) and asserts
 * the output contains REAL numeric values, not placeholders.
 *
 * Run:  bun apps/examples/src/reasoning/finalize-probe-tools.ts
 */
import { ReactiveAgents } from "reactive-agents";

const MODEL = process.env.MODEL ?? "qwen3.5:latest";
const TASK =
  "Use the crypto-price tool to fetch the current prices for BTC and ETH in USD. " +
  "Then produce a markdown report titled '# Crypto Snapshot' with a table " +
  "(Coin | Price USD) populated with the real values from the tool. " +
  "Do not leave any placeholder values.";

type Strat = "reflexion" | "plan-execute-reflect";
const STRATEGIES: readonly Strat[] = ["reflexion", "plan-execute-reflect"];

const PLACEHOLDER_RE = /\[(?:insert|placeholder|tbd|fill[\s-]?in|value|number|price)[^\]]*\]/i;
const PRICE_RE = /\$?\s*\d{1,3}(?:,\d{3})+|\$?\s*\d{4,}/; // any 4+ digit number with optional commas

interface ProbeRow {
  strategy: Strat;
  status: string;
  toolCalls: number;
  tokens: number;
  durationMs: number;
  hasTable: boolean;
  hasPlaceholder: boolean;
  hasRealPrice: boolean;
  outputPreview: string;
}

async function runOne(strategy: Strat): Promise<ProbeRow> {
  const start = Date.now();
  const agent = await ReactiveAgents.create()
    .withName(`tool-probe-${strategy}`)
    .withProvider("ollama")
    .withModel(MODEL)
    .withTools({ allowedTools: ["crypto-price"] })
    .withReasoning({ defaultStrategy: strategy, enableStrategySwitching: false })
    .withMaxIterations(6)
    .build();

  const result = await agent.run(TASK);
  await agent.dispose();

  const output = result.output ?? "";
  const steps = result.steps ?? [];
  const toolCalls = steps.filter((s: any) =>
    s.type === "action" || (typeof s.content === "string" && /crypto-price/i.test(s.content)),
  ).length;

  return {
    strategy,
    status: result.status ?? "unknown",
    toolCalls,
    tokens: result.metadata?.tokensUsed ?? 0,
    durationMs: Date.now() - start,
    hasTable: /\|.+\|/.test(output) && /\|\s*-+\s*\|/.test(output),
    hasPlaceholder: PLACEHOLDER_RE.test(output),
    hasRealPrice: PRICE_RE.test(output),
    outputPreview: output.slice(0, 400).replace(/\n/g, "\\n"),
  };
}

const rows: ProbeRow[] = [];
for (const s of STRATEGIES) {
  console.log(`\n=== Running ${s} on ${MODEL} (tool: crypto-price) ===`);
  try {
    const row = await runOne(s);
    rows.push(row);
    console.log(`  status=${row.status} tokens=${row.tokens} duration=${row.durationMs}ms toolCalls~${row.toolCalls}`);
    console.log(`  hasTable=${row.hasTable} hasPlaceholder=${row.hasPlaceholder} hasRealPrice=${row.hasRealPrice}`);
    console.log(`  output: ${row.outputPreview}`);
  } catch (err) {
    console.log(`  CRASH: ${err}`);
    rows.push({
      strategy: s,
      status: "crashed",
      toolCalls: 0,
      tokens: 0,
      durationMs: 0,
      hasTable: false,
      hasPlaceholder: false,
      hasRealPrice: false,
      outputPreview: String(err).slice(0, 200),
    });
  }
}

console.log("\n=== Tool Probe Summary ===");
console.log("strategy             | status     | tools | table | placeholder | realPrice | tokens | ms");
console.log("---------------------+------------+-------+-------+-------------+-----------+--------+------");
for (const r of rows) {
  const pad = (s: string, n: number) => s.padEnd(n);
  console.log(
    `${pad(r.strategy, 20)} | ${pad(r.status, 10)} | ${pad(String(r.toolCalls), 5)} | ${pad(String(r.hasTable), 5)} | ${pad(String(r.hasPlaceholder), 11)} | ${pad(String(r.hasRealPrice), 9)} | ${pad(String(r.tokens), 6)} | ${r.durationMs}`,
  );
}

const verdict = rows.every(
  (r) => r.status !== "crashed" && !r.hasPlaceholder && r.hasRealPrice,
);
console.log(
  verdict
    ? "\n✅ TOOL PROBE PASS — both strategies routed real tool data through synthesis, no placeholders"
    : "\n❌ TOOL PROBE FAIL — placeholder regression or missing real prices",
);
process.exit(verdict ? 0 : 1);
