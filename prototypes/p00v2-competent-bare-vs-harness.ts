// p00v2-competent-bare-vs-harness.ts
//
// ─── HYPOTHESIS ────────────────────────────────────────────────────────────────
//
// A COMPETENT bare-LLM ReAct loop (Ollama SDK + qwen3:4b which natively
// supports function calling, ~80 LOC, no @reactive-agents harness) on rw-2
// produces output of comparable quality to the @reactive-agents harness on
// the same task with the same model.
//
// COMPETITIVE QUESTION: "Why wouldn't someone just hand-roll their own agent
//   via SDK and bare LLM calls?" If a 100-LOC hand-roll matches the harness,
//   the harness has a serious differentiation problem.
//
// NULL HYPOTHESIS (HARNESS WINS): The bare loop's output is meaningfully
//   worse — it fabricates, gets wrong answer, fails to converge, OR ships
//   confidently incorrect output where harness honest-fails.
//
// NULL HYPOTHESIS (HARNESS LOSES): The bare loop produces equal-or-better
//   output at far less complexity. **Implication: most of the harness's
//   ~30 packages are dead weight.**
//
// MEASUREMENT (per discipline contract Rule 4 — six-level signals):
//   - Behavioral: did the model call the tool? how many times?
//   - Mechanistic: did it engage with the actual data?
//   - Quality: did it identify ELEC-4K-TV-001 OOS as the cause?
//   - Cost: tokens, time
//   - Robustness: across N=5 runs (temp=0 so deterministic-ish)
//   - Surprise: anything unexpected
//
// PROMOTION: N/A (control experiment)
// KILL: N/A
//
// PROVIDER: ollama; MODEL: qwen3:4b (verified FC-capable in bench)
// TASK: rw-2 (data investigation with red herring)
// RUNS: 5
//
// Per discipline contract Rule 8: still hand-rolled, no infrastructure.

import { Ollama } from "ollama";
import fs from "node:fs";

const MODEL = "qwen3:4b";
const MAX_ITERATIONS = 15;
const N_RUNS = 5;
const RW2_PROMPT = `Analyze the attached sales data in sales-data.csv. Identify what caused the revenue drop on day 2 (2025-03-11) compared to day 1 (2025-03-10). Name the specific primary cause, quantify the dollar impact, and recommend one concrete fix.`;

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
fs.mkdirSync("/tmp/p00v2-bare", { recursive: true });
fs.writeFileSync("/tmp/p00v2-bare/sales-data.csv", SALES_CSV);

const tools = [{
  type: "function" as const,
  function: {
    name: "read_csv",
    description: "Read the contents of a CSV file by filename. Use this to inspect data before answering.",
    parameters: {
      type: "object" as const,
      properties: { filename: { type: "string", description: "filename, e.g. sales-data.csv" } },
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
  totalEvalCount: number;
  totalPromptCount: number;
  durationMs: number;
  trace: Array<{ iter: number; preview: string; toolCalls: number }>;
}

async function runOnce(runIdx: number): Promise<RunResult> {
  const messages: Array<Record<string, unknown>> = [
    {
      role: "system",
      content: "You are a data analyst. To answer questions about data files, you MUST use the read_csv tool to inspect the actual file contents before drawing conclusions. Do not guess or fabricate values — always inspect the data first. After inspecting the data, provide a clear answer.",
    },
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
      think: false, // SDK-level disable of qwen3 thinking-mode (verbose internal monologue)
      options: { temperature: 0 },
    });
    const msg = resp.message;
    messages.push(msg as Record<string, unknown>);
    totalEvalCount += resp.eval_count ?? 0;
    totalPromptCount += resp.prompt_eval_count ?? 0;
    const tcCount = msg.tool_calls?.length ?? 0;
    trace.push({ iter, preview: (msg.content ?? "").slice(0, 120), toolCalls: tcCount });

    if (tcCount === 0) {
      return { runIdx, iters: iter + 1, finalAnswer: msg.content ?? "", toolCallCount, totalEvalCount, totalPromptCount, durationMs: Date.now() - start, trace };
    }
    for (const tc of msg.tool_calls!) {
      toolCallCount++;
      let result = "ERROR: unknown tool";
      if (tc.function.name === "read_csv") {
        const args = tc.function.arguments as { filename?: string };
        const safe = (args.filename ?? "sales-data.csv").split("/").pop() ?? "sales-data.csv";
        try {
          result = fs.readFileSync(`/tmp/p00v2-bare/${safe}`, "utf-8");
        } catch (e) {
          result = `ERROR reading ${safe}: ${(e as Error).message}`;
        }
      }
      messages.push({ role: "tool", content: result });
    }
  }
  return { runIdx, iters: MAX_ITERATIONS, finalAnswer: "MAX_ITERATIONS_REACHED", toolCallCount, totalEvalCount, totalPromptCount, durationMs: Date.now() - start, trace };
}

async function main(): Promise<void> {
  fs.mkdirSync("harness-reports/spike-results", { recursive: true });
  const results: RunResult[] = [];
  console.log(`p00v2 COMPETENT bare-LLM × ${MODEL} × rw-2 × ${N_RUNS} runs (temp=0)`);
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
  const out = "harness-reports/spike-results/p00v2-bare-rw2-qwen3-4b.json";
  fs.writeFileSync(out, JSON.stringify({ model: MODEL, task: "rw-2", n_runs: N_RUNS, generated_at: new Date().toISOString(), results }, null, 2));
  console.log(`\nSaved → ${out}`);
}

void main();
