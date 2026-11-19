// Live QA probe (harness-warden, 2026-11-19 pre-v0.19.0 strategy matrix).
//
// Strategy x model x task matrix with deterministic custom tools, so every cell
// has a mechanical correctness check (not a grader):
//   (a) research : coin-quote (deterministic) + web-search, markdown report
//   (b) repeat   : city-population called for 6 distinct cities, plus the sum
//   (c) reason   : pure arithmetic over time, no custom tools
//
// Usage (from the checkout under test; rebuild its reasoning dist first):
//   bun --env-file=<repo>/.env .agents/skills/harness-improvement-loop/scripts/probe-qa-strategy-matrix.ts \
//     --out <abs results.json> --trace-root <abs dir> --model gemini-flash-latest --provider gemini \
//     [--strategies reactive,reflexion] [--tasks a,b,c] [--n 1] [--rep-offset 0]
//
// One trace dir per run (REACTIVE_AGENTS_TRACE_DIR). Results append per run.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Effect } from "effect";
import { ReactiveAgents } from "@reactive-agents/runtime";

const arg = (name: string, def?: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
};

const PRICES: Record<string, number> = { BTC: 97123.45, ETH: 3456.78, XRP: 2.3456, XLM: 0.4321 };
const POPS: Record<string, number> = {
  Tokyo: 3141592, Paris: 2718281, Lagos: 1618033, Lima: 1414213, Oslo: 1732050, Cairo: 2236067,
};
const POP_TOTAL = Object.values(POPS).reduce((a, b) => a + b, 0); // 12860236

const coinQuote = {
  definition: {
    name: "coin-quote",
    description: "Return the current USD price for one crypto ticker symbol (e.g. BTC).",
    parameters: [{ name: "symbol", type: "string" as const, description: "Ticker symbol", required: true }],
    riskLevel: "low" as const, timeoutMs: 5_000, requiresApproval: false, source: "function" as const,
  },
  handler: (args: Record<string, unknown>) => {
    const s = String(args["symbol"] ?? "").toUpperCase().trim();
    const p = PRICES[s];
    return Effect.succeed(p === undefined ? { error: `unknown symbol ${s}` } : { symbol: s, priceUsd: p });
  },
};

const cityPopulation = {
  definition: {
    name: "city-population",
    description: "Return the registered population for exactly one city name.",
    parameters: [{ name: "city", type: "string" as const, description: "City name", required: true }],
    riskLevel: "low" as const, timeoutMs: 5_000, requiresApproval: false, source: "function" as const,
  },
  handler: (args: Record<string, unknown>) => {
    const raw = String(args["city"] ?? "").trim();
    const key = Object.keys(POPS).find((k) => k.toLowerCase() === raw.toLowerCase());
    return Effect.succeed(key ? { city: key, population: POPS[key] } : { error: `unknown city ${raw}` });
  },
};

type TaskId = "a" | "b" | "c";
const TASKS: Record<TaskId, { prompt: string; check: (o: string) => { ok: boolean; detail: string } }> = {
  a: {
    prompt:
      "Use the coin-quote tool to get the current prices of BTC and ETH, and use web-search to find one recent news headline about Ethereum. Write a short markdown report with a heading, both prices exactly as the tool returned them, and the headline with its source.",
    check: (o) => {
      const btc = /97,?123\.45/.test(o);
      const eth = /3,?456\.78/.test(o);
      const md = /^#{1,3} /m.test(o);
      return { ok: btc && eth && md, detail: `btc=${btc} eth=${eth} md=${md}` };
    },
  },
  b: {
    prompt:
      "Use the city-population tool to look up the population of each of these cities: Tokyo, Paris, Lagos, Lima, Oslo, Cairo. List each city with its population, then give the total of all six.",
    check: (o) => {
      const flat = o.replace(/[,\s]/g, "");
      const hits = Object.values(POPS).filter((p) => flat.includes(String(p))).length;
      const total = flat.includes(String(POP_TOTAL));
      return { ok: hits === 6 && total, detail: `pops=${hits}/6 total=${total}` };
    },
  },
  c: {
    prompt:
      "A train departs at 14:35. The first leg takes 2 hours 50 minutes, then there is a 25 minute connection, then a second leg of 1 hour 40 minutes. At what time does the traveler arrive? Answer with the time in HH:MM and one sentence of reasoning.",
    check: (o) => {
      const ok = /19:30/.test(o);
      return { ok, detail: `19:30=${ok}` };
    },
  },
};

interface Row {
  readonly model: string;
  readonly strategy: string;
  readonly task: TaskId;
  readonly run: number;
  readonly success: boolean | null;
  readonly outcome: string | null;
  readonly terminatedBy: string | null;
  readonly error: string | null;
  readonly correct: boolean;
  readonly checkDetail: string;
  readonly toolCalls: Record<string, number>;
  readonly toolErrors: number;
  readonly llmCalls: number;
  readonly tokens: number;
  readonly durationMs: number;
  readonly outputHead: string;
  readonly receiptVerdict: string | null;
  readonly traceFile: string | null;
}

const out = arg("out");
const traceRoot = arg("trace-root");
const model = arg("model", "gemini-flash-latest") as string;
const provider = arg("provider", "gemini") as "gemini" | "ollama";
if (!out || !traceRoot) {
  console.error("usage: --out <abs.json> --trace-root <abs dir> [--model m] [--provider p]");
  process.exit(2);
}
const strategies = (arg("strategies", "reactive,reflexion,plan-execute-reflect,tree-of-thought,direct,code-action,adaptive") ?? "").split(",");
const tasks = (arg("tasks", "a,b,c") ?? "").split(",") as TaskId[];
const n = Number(arg("n", "1"));
const repOffset = Number(arg("rep-offset", "0"));
const rows: Row[] = existsSync(out) ? (JSON.parse(readFileSync(out, "utf8")) as Row[]) : [];
const done = new Set(rows.map((r) => `${r.model}|${r.strategy}|${r.task}|${r.run}`));

const readTrace = (file: string | null) => {
  const toolCalls: Record<string, number> = {};
  let toolErrors = 0;
  let llmCalls = 0;
  if (!file) return { toolCalls, toolErrors, llmCalls };
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let ev: {
      kind?: string; toolName?: string; ok?: boolean;
      entries?: ReadonlyArray<{ kind?: string; toolName?: string; toolCallId?: string; success?: boolean }>;
    };
    try { ev = JSON.parse(line); } catch { continue; }
    if (ev.kind === "tool-call-end" && ev.toolName) {
      toolCalls[ev.toolName] = (toolCalls[ev.toolName] ?? 0) + 1;
      if (ev.ok === false) toolErrors++;
    }
    // code-action sandbox calls surface only as ledger entries (no tool-call-* events).
    if (ev.kind === "ledger-entry" && ev.entries) {
      for (const e of ev.entries) {
        if (e.kind === "tool-result" && e.toolName && e.toolCallId?.startsWith("code-action")) {
          const k = `${e.toolName}(ledger)`;
          toolCalls[k] = (toolCalls[k] ?? 0) + 1;
          if (e.success === false) toolErrors++;
        }
      }
    }
    if (ev.kind === "llm-exchange") llmCalls++;
  }
  return { toolCalls, toolErrors, llmCalls };
};

for (let r = 0; r < n; r++) {
  const run = r + repOffset;
  for (const task of tasks) {
    for (const strategy of strategies) {
      if (done.has(`${model}|${strategy}|${task}|${run}`)) continue;
      const traceDir = join(traceRoot, model.replace(/[^a-z0-9.-]/gi, "_"), task, strategy, `run${run}`);
      mkdirSync(traceDir, { recursive: true });
      process.env.REACTIVE_AGENTS_TRACE_DIR = traceDir;
      const start = Date.now();
      let partial: Omit<Row, "toolCalls" | "toolErrors" | "llmCalls" | "traceFile">;
      try {
        let b = ReactiveAgents.create()
          .withName(`qa-${strategy}-${task}`)
          .withProvider(provider)
          .withModel({ model, temperature: 0.3 });
        if (task === "a") b = b.withTools({ tools: [coinQuote], allowedTools: ["coin-quote", "web-search"] });
        if (task === "b") b = b.withTools({ tools: [cityPopulation], allowedTools: ["city-population"] });
        const agent = await b
          .withReasoning({ defaultStrategy: strategy as never, enableStrategySwitching: false })
          .withMaxIterations(14)
          .build();
        const result = await agent.run(TASKS[task].prompt);
        await agent.dispose();
        const output = result.output ?? "";
        const chk = TASKS[task].check(output);
        partial = {
          model, strategy, task, run,
          success: result.success, outcome: result.outcome ?? null,
          terminatedBy: result.terminatedBy ? String(result.terminatedBy) : null,
          error: result.error ? String(result.error).slice(0, 300) : null,
          correct: chk.ok, checkDetail: chk.detail,
          tokens: result.metadata?.tokensUsed ?? 0, durationMs: Date.now() - start,
          outputHead: output.slice(0, 400), receiptVerdict: result.receipt?.verdict ?? null,
        };
      } catch (err) {
        partial = {
          model, strategy, task, run, success: null, outcome: "crashed", terminatedBy: null,
          error: String(err).slice(0, 300), correct: false, checkDetail: "crash", tokens: 0,
          durationMs: Date.now() - start, outputHead: "", receiptVerdict: null,
        };
      }
      const trace = existsSync(traceDir) ? readdirSync(traceDir).find((f) => f.endsWith(".jsonl")) : undefined;
      const traceFile = trace ? join(traceDir, trace) : null;
      const row: Row = { ...partial, ...readTrace(traceFile), traceFile };
      rows.push(row);
      writeFileSync(out, JSON.stringify(rows, null, 2));
      console.log(
        `${task}\t${strategy}\trun${run}\t${row.success}/${row.outcome}/${row.terminatedBy}\tcorrect=${row.correct}(${row.checkDetail})\ttools=${JSON.stringify(row.toolCalls)}\tllm=${row.llmCalls}\tms=${row.durationMs}\t${row.error ?? ""}`,
      );
    }
  }
}
// Explicit exit: the process otherwise stays alive after agent.dispose() (open handles).
process.exit(0);
