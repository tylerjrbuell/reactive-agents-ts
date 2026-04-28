// p00-bare-vs-harness.ts
//
// ─── HYPOTHESIS ────────────────────────────────────────────────────────────────
//
// A bare-LLM ReAct loop (Ollama SDK directly, no @reactive-agents harness)
// on rw-2 (data investigation with red herring) produces output that
// MEANINGFULLY DIFFERS in quality from the @reactive-agents harness on the
// same task with the same model.
//
// NULL HYPOTHESIS: Bare loop output is qualitatively indistinguishable from
//   harness output. Implication: harness is dead weight for this class of
//   task and we have empirical mandate to start cutting.
//
// MEASUREMENT: 5 runs, qualitative read. Did the model identify
//   ELEC-4K-TV-001 as the cause? Did it quantify? Recommend? How many
//   iterations? How many tokens?
//
// PROMOTION CRITERIA: N/A — this is the control experiment, not a candidate
//   for promotion. Outcome informs whether next spike validates EXISTING
//   harness mechanisms (gap is large) or proposes deletions (gap small/wash).
//
// KILL CRITERIA: N/A
//
// PROVIDER: ollama only. MODEL: cogito:8b (matches bench).
// TASK: rw-2 (data investigation with red herring) — see real-world.ts
// RUNS: 5
//
// Per discipline contract Rule 8: NO infrastructure first. This file is
// self-contained except for the official `ollama` SDK + node fs.

import { Ollama } from "ollama";
import fs from "node:fs";

const MODEL = "cogito:8b";
const MAX_ITERATIONS = 15;
const N_RUNS = 5;
const RW2_PROMPT = `Analyze the attached sales data in sales-data.csv. Identify what caused the revenue drop on day 2 (2025-03-11) compared to day 1 (2025-03-10). Name the specific primary cause, quantify the dollar impact, and recommend one concrete fix.`;

// ── Generate the SAME fixture the bench uses (copied from real-world.ts) ─────
function generateSalesData(): string {
  const header = "date,order_id,sku,qty,unit_price,discount_pct,net_revenue";
  const rows: string[] = [header];
  let id = 1;
  const pad = (n: number) => String(n).padStart(4, "0");
  const skus = [
    { sku: "APPL-IPAD-AIR", price: 329.99 },
    { sku: "FURN-CHAIR-ERG", price: 299.99 },
    { sku: "CLTH-JACKET-L", price: 89.99 },
    { sku: "BOOK-DESIGN-01", price: 34.99 },
  ];
  const tv = { sku: "ELEC-4K-TV-001", price: 849.99 };
  const tvSlots1 = new Set([1, 2, 4, 6, 8, 10, 12, 14]);
  for (let i = 1; i <= 15; i++) {
    const item = tvSlots1.has(i) ? tv : skus[(i % skus.length)]!;
    const rev = item.price.toFixed(2);
    rows.push(`2025-03-10,ORD-${pad(id++)},${item.sku},1,${item.price.toFixed(2)},0.00,${rev}`);
  }
  for (let i = 1; i <= 15; i++) {
    const useTv = i <= 3;
    const item = useTv ? tv : skus[(i % skus.length)]!;
    const disc = 0.15;
    const rev = (item.price * (1 - disc)).toFixed(2);
    rows.push(`2025-03-11,ORD-${pad(id++)},${item.sku},1,${item.price.toFixed(2)},0.15,${rev}`);
  }
  const tvSlots3 = new Set([1, 3, 5, 8, 11, 13]);
  for (let i = 1; i <= 15; i++) {
    const item = tvSlots3.has(i) ? tv : skus[(i % skus.length)]!;
    const rev = item.price.toFixed(2);
    rows.push(`2025-03-12,ORD-${pad(id++)},${item.sku},1,${item.price.toFixed(2)},0.00,${rev}`);
  }
  return rows.join("\n");
}

const SALES_CSV = generateSalesData();
fs.mkdirSync("/tmp/p00-bare", { recursive: true });
fs.writeFileSync("/tmp/p00-bare/sales-data.csv", SALES_CSV);

// ── Single tool: read_csv ────────────────────────────────────────────────────
const tools = [{
  type: "function" as const,
  function: {
    name: "read_csv",
    description: "Read the contents of a CSV file by filename",
    parameters: {
      type: "object" as const,
      properties: { filename: { type: "string", description: "filename (e.g. sales-data.csv)" } },
      required: ["filename"],
    },
  },
}];

const ollama = new Ollama({ host: "http://localhost:11434" });

interface RunResult {
  runIdx: number;
  iters: number;
  finalAnswer: string;
  toolCallCount: number;
  totalEvalCount: number; // ollama eval tokens (output)
  totalPromptCount: number; // ollama prompt tokens (input)
  durationMs: number;
  trace: Array<{ iter: number; preview: string; toolCalls: number }>;
}

async function runOnce(runIdx: number): Promise<RunResult> {
  const messages: Array<Record<string, unknown>> = [
    { role: "system", content: "You are a data analyst. Use the read_csv tool to inspect data files. When you have an answer, state it clearly without making more tool calls." },
    { role: "user", content: RW2_PROMPT },
  ];
  const trace: RunResult["trace"] = [];
  let toolCallCount = 0;
  let totalEvalCount = 0;
  let totalPromptCount = 0;
  const start = Date.now();

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    const resp = await ollama.chat({
      model: MODEL,
      messages: messages as { role: string; content: string }[],
      tools,
      options: { temperature: 0 },
    });
    const msg = resp.message;
    messages.push(msg as Record<string, unknown>);
    totalEvalCount += resp.eval_count ?? 0;
    totalPromptCount += resp.prompt_eval_count ?? 0;
    const tcCount = msg.tool_calls?.length ?? 0;
    trace.push({ iter, preview: (msg.content ?? "").slice(0, 120), toolCalls: tcCount });

    if (tcCount === 0) {
      return {
        runIdx, iters: iter + 1, finalAnswer: msg.content ?? "",
        toolCallCount, totalEvalCount, totalPromptCount,
        durationMs: Date.now() - start, trace,
      };
    }
    for (const tc of msg.tool_calls!) {
      toolCallCount++;
      let result = "ERROR: unknown tool";
      if (tc.function.name === "read_csv") {
        const args = tc.function.arguments as { filename?: string };
        const safe = (args.filename ?? "sales-data.csv").split("/").pop() ?? "sales-data.csv";
        try {
          result = fs.readFileSync(`/tmp/p00-bare/${safe}`, "utf-8");
        } catch (e) {
          result = `ERROR reading ${safe}: ${(e as Error).message}`;
        }
      }
      messages.push({ role: "tool", content: result });
    }
  }
  return {
    runIdx, iters: MAX_ITERATIONS, finalAnswer: "MAX_ITERATIONS_REACHED",
    toolCallCount, totalEvalCount, totalPromptCount,
    durationMs: Date.now() - start, trace,
  };
}

async function main(): Promise<void> {
  fs.mkdirSync("harness-reports/spike-results", { recursive: true });
  const results: RunResult[] = [];
  console.log(`p00 bare-LLM × ${MODEL} × rw-2 × ${N_RUNS} runs (temp=0)`);
  for (let i = 0; i < N_RUNS; i++) {
    process.stdout.write(`  run ${i + 1}/${N_RUNS} ... `);
    try {
      const r = await runOnce(i);
      results.push(r);
      const totalTok = r.totalEvalCount + r.totalPromptCount;
      console.log(`${r.iters} iters, ${r.toolCallCount} tools, ${totalTok} tok, ${(r.durationMs / 1000).toFixed(1)}s`);
    } catch (e) {
      console.log(`FAILED: ${(e as Error).message}`);
    }
  }
  const out = "harness-reports/spike-results/p00-bare-rw2.json";
  fs.writeFileSync(out, JSON.stringify({ model: MODEL, task: "rw-2", n_runs: N_RUNS, generated_at: new Date().toISOString(), results }, null, 2));
  console.log(`\nSaved → ${out}`);
}

void main();
