// Live probe (harness-warden, 2026-11-19 strategy-substrate wave no-regression check).
//
// The owner's Cortex task shape from the 2026-11-18 conformance audit corpus
// (wiki/Research/Harness-Reports/2026-11-18-strategy-substrate-conformance.md):
// four crypto prices plus web research, rendered as a markdown report. Config
// mirrors the corpus run-started.config: gemini-2.5-flash, maxIterations 16,
// temperature 0.7, strategy switching off, todo + recall meta-tools, approval policy
// `{ mode: "detach" }` with durable runs (Cortex's default when "ask before
// risky tools" is on).
//
// Run it from the checkout under test (the file resolves `@reactive-agents/runtime`
// relative to itself, so copy it into a worktree at the same path to probe that
// worktree's build; rebuild that worktree's reasoning dist first):
//   bun --env-file=<repo>/.env .agents/skills/harness-improvement-loop/scripts/probe-strategy-crypto-report.ts \
//     --out <abs results.json> --trace-root <abs dir> --strategies reflexion,direct --n 2
//
// One trace dir per run (REACTIVE_AGENTS_TRACE_DIR), so `rax-diagnose cause <dir>/*.jsonl`
// reads exactly one run. Results are appended per run, so a cut-off keeps what ran.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ReactiveAgents } from "@reactive-agents/runtime";

const TASK =
  "Find the current price of the major crypto currencies (BTC ,XRP, ETH, XLM) and research each currency market trends then render it in a markdown report";
const COINS = ["BTC", "XRP", "ETH", "XLM"] as const;

const arg = (name: string, def?: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
};

type Strategy = "reactive" | "reflexion" | "tree-of-thought" | "code-action" | "direct" | "plan-execute-reflect";

interface Row {
  readonly strategy: Strategy;
  readonly run: number;
  readonly status: string;
  readonly error: string | null;
  readonly tokens: number;
  readonly costUsd: number;
  readonly durationMs: number;
  readonly outputChars: number;
  /** Coins named in the output next to a number (a crude deliverable check; not a grader). */
  readonly coinsPriced: number;
  readonly hasMarkdownHeading: boolean;
  readonly traceFile: string | null;
}

const out = arg("out");
const traceRoot = arg("trace-root");
if (!out || !traceRoot) {
  console.error("usage: --out <abs.json> --trace-root <abs dir> [--strategies a,b] [--n 2]");
  process.exit(2);
}
const strategies = (arg("strategies", "reflexion,tree-of-thought,code-action,direct,plan-execute-reflect") ?? "").split(",") as Strategy[];
const n = Number(arg("n", "2"));
const rows: Row[] = existsSync(out) ? (JSON.parse(readFileSync(out, "utf8")) as Row[]) : [];
const done = new Set(rows.map((r) => `${r.strategy}|${r.run}`));

const coinsPriced = (text: string): number =>
  COINS.filter((c) => new RegExp(`${c}[^\\n]{0,80}?\\$?\\s?\\d[\\d,]*(\\.\\d+)?`, "i").test(text)).length;

for (let run = 0; run < n; run++) {
  for (const strategy of strategies) {
    if (done.has(`${strategy}|${run}`)) continue;
    const traceDir = join(traceRoot, strategy, `run${run}`);
    mkdirSync(traceDir, { recursive: true });
    process.env.REACTIVE_AGENTS_TRACE_DIR = traceDir;
    const start = Date.now();
    let row: Row;
    try {
      const agent = await ReactiveAgents.create()
        .withName(`crypto-report-${strategy}`)
        .withProvider("gemini")
        .withModel({ model: "gemini-2.5-flash", temperature: 0.7 })
        .withTools({ allowedTools: ["crypto-price", "web-search"] })
        .withMetaTools({ todo: true, recall: true })
        .withReasoning({ defaultStrategy: strategy, enableStrategySwitching: false })
        .withMaxIterations(16)
        .withDurableRuns({ dir: join(traceDir, "runs") })
        .withApprovalPolicy({ mode: "detach" })
        .build();
      const result = await agent.run(TASK);
      await agent.dispose();
      const output = result.output ?? "";
      row = {
        strategy, run,
        status: `${result.success ? "success" : "failure"}/${result.outcome ?? "-"}/${result.terminatedBy ?? "-"}`,
        error: result.error ? String(result.error).slice(0, 300) : null,
        tokens: result.metadata?.tokensUsed ?? 0,
        costUsd: result.metadata?.cost ?? 0,
        durationMs: Date.now() - start,
        outputChars: output.length,
        coinsPriced: coinsPriced(output),
        hasMarkdownHeading: /^#{1,3} /m.test(output),
        traceFile: null,
      };
    } catch (err) {
      row = {
        strategy, run, status: "crashed", error: String(err).slice(0, 300), tokens: 0, costUsd: 0,
        durationMs: Date.now() - start, outputChars: 0, coinsPriced: 0, hasMarkdownHeading: false, traceFile: null,
      };
    }
    const trace = readdirSync(traceDir).find((f) => f.endsWith(".jsonl"));
    row = { ...row, traceFile: trace ? join(traceDir, trace) : null };
    rows.push(row);
    writeFileSync(out, JSON.stringify(rows, null, 2));
    console.log(`${strategy}\trun${run}\t${row.status}\ttok=${row.tokens}\tms=${row.durationMs}\tcoins=${row.coinsPriced}/4\tmd=${row.hasMarkdownHeading}\t${row.error ?? ""}`);
  }
}
