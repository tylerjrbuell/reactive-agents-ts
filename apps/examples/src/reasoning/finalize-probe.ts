/**
 * Live probe — Phase 0 finalize.ts extraction E1 verification.
 *
 * Runs reflexion + plan-execute-reflect against Ollama on a format-driven
 * task. Synthesis quality gate should fire (or no-op) identically under the
 * new shared module. Probe checks:
 *   - Both strategies complete (no crash)
 *   - Both produce markdown output (synthesis gate format detection works)
 *   - No `[Insert ...]` / `[placeholder]` survives (regression net for the
 *     0af217c8 fix that motivated finalize.ts extraction)
 *
 * Run:  bun apps/examples/src/reasoning/finalize-probe.ts
 */
import { ReactiveAgents } from "reactive-agents";

const MODEL = process.env.MODEL ?? "qwen3.5:latest";
const TASK =
  "Write a brief markdown report titled '# Solar System Quick Facts' " +
  "with a table of the 4 inner planets (Mercury, Venus, Earth, Mars) " +
  "and their approximate diameters in km. Use a real markdown table with " +
  "header row and divider. Do not leave any placeholders.";

type Strat = "reflexion" | "plan-execute-reflect";
const STRATEGIES: readonly Strat[] = ["reflexion", "plan-execute-reflect"];

const PLACEHOLDER_RE = /\[(?:insert|placeholder|tbd|fill[\s-]?in|value|number)[^\]]*\]/i;

interface ProbeRow {
  strategy: Strat;
  status: string;
  tokens: number;
  durationMs: number;
  hasTable: boolean;
  hasPlaceholder: boolean;
  outputPreview: string;
}

async function runOne(strategy: Strat): Promise<ProbeRow> {
  const start = Date.now();
  const agent = await ReactiveAgents.create()
    .withName(`probe-${strategy}`)
    .withProvider("ollama")
    .withModel(MODEL)
    .withReasoning({ defaultStrategy: strategy, enableStrategySwitching: false })
    .withMaxIterations(4)
    .build();

  const result = await agent.run(TASK);
  await agent.dispose();

  const output = result.output ?? "";
  return {
    strategy,
    status: result.status ?? "unknown",
    tokens: result.metadata?.tokensUsed ?? 0,
    durationMs: Date.now() - start,
    hasTable: /\|.+\|/.test(output) && /\|\s*-+\s*\|/.test(output),
    hasPlaceholder: PLACEHOLDER_RE.test(output),
    outputPreview: output.slice(0, 320).replace(/\n/g, "\\n"),
  };
}

const rows: ProbeRow[] = [];
for (const s of STRATEGIES) {
  console.log(`\n=== Running ${s} on ${MODEL} ===`);
  try {
    const row = await runOne(s);
    rows.push(row);
    console.log(`  status=${row.status} tokens=${row.tokens} duration=${row.durationMs}ms`);
    console.log(`  hasTable=${row.hasTable} hasPlaceholder=${row.hasPlaceholder}`);
    console.log(`  output: ${row.outputPreview}`);
  } catch (err) {
    console.log(`  CRASH: ${err}`);
    rows.push({
      strategy: s,
      status: "crashed",
      tokens: 0,
      durationMs: 0,
      hasTable: false,
      hasPlaceholder: false,
      outputPreview: String(err).slice(0, 200),
    });
  }
}

console.log("\n=== Probe Summary ===");
console.log("strategy                | status     | hasTable | hasPlaceholder | tokens | ms");
console.log("------------------------+------------+----------+----------------+--------+------");
for (const r of rows) {
  const pad = (s: string, n: number) => s.padEnd(n);
  console.log(
    `${pad(r.strategy, 23)} | ${pad(r.status, 10)} | ${pad(String(r.hasTable), 8)} | ${pad(String(r.hasPlaceholder), 14)} | ${pad(String(r.tokens), 6)} | ${r.durationMs}`,
  );
}

const verdict = rows.every(
  (r) => r.status !== "crashed" && !r.hasPlaceholder,
);
console.log(verdict ? "\n✅ PROBE PASS (no crash, no placeholder regression)" : "\n❌ PROBE FAIL");
process.exit(verdict ? 0 : 1);
