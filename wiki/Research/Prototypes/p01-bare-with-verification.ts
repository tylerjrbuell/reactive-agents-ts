// p01-bare-with-verification.ts
//
// ─── HYPOTHESIS ────────────────────────────────────────────────────────────────
//
// Adding a SINGLE ~30-LOC post-LLM verification gate to the bare-LLM ReAct
// loop (same as p00v2) captures most of the harness's anti-fabrication value.
//
// Specifically: the gate runs AFTER the model emits a final answer and checks:
//   (1) Did the model call at least one tool during the loop?
//        (matches harness's `agent-took-action` check)
//   (2) Does the final answer contain at least one factual reference (number,
//        SKU, date) that appears in tool observations?
//        (lightweight stand-in for harness's `synthesis-grounded` check)
//
// If either check fails → output is rejected (shipped empty).
// If both pass → output ships.
//
// PROMOTION CRITERIA: ≥3/5 outputs end up either CORRECT or HONEST-FAIL
//   (empty), with NO confident-wrong shipped. Total LOC stays ≤150.
//   Implication: a 30-LOC verification gate captures the harness's trust
//   differentiator → mandate to delete the rest.
//
// KILL CRITERIA: ≤1/5 improvement vs p00v2 (still ships ≥4 confident-wrong).
//   Implication: verification alone isn't the trust mechanism; the gain is
//   distributed elsewhere or comes from multi-iteration reasoning.
//
// PRE-REGISTERED PREDICTION: For qwen3:4b on rw-2, the verification gate is
//   UNLIKELY to help — qwen3 outputs are already grounded in data (the 15%
//   discount IS in the CSV). The model's failure mode is shallow reasoning
//   ("first plausible cause wins"), not fabrication. Predicted result:
//   verification rejects 0/5, ships same red-herring 5/5 as p00v2.
//   If this prediction holds: KILL outcome → verification's contribution
//   is task/model-specific, not the universal trust mechanism. Suggests
//   the harness's value comes from somewhere ELSE (multi-iteration?
//   reflection? specific prompt structure?). p02 isolates that.
//
// PROVIDER: ollama; MODEL: qwen3:4b
// TASK: rw-2
// RUNS: 5
// BASELINE: p00v2 (same setup, no verification gate)

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
fs.mkdirSync("/tmp/p01-bare-verify", { recursive: true });
fs.writeFileSync("/tmp/p01-bare-verify/sales-data.csv", SALES_CSV);

const tools = [{
  type: "function" as const,
  function: {
    name: "read_csv",
    description: "Read the contents of a CSV file by filename. Use this to inspect data before answering.",
    parameters: {
      type: "object" as const,
      properties: { filename: { type: "string" } },
      required: ["filename"],
    },
  },
}];

const ollama = new Ollama({ host: "http://localhost:11434" });

// ── THE VERIFICATION GATE — ~25 LOC, the entire mechanism under test ────────
interface VerifyResult { passed: boolean; reason: string; }
function verifyOutput(answer: string, toolCallCount: number, observations: string[]): VerifyResult {
  // Check 1: did the model call any tool?
  if (toolCallCount === 0) {
    return { passed: false, reason: "agent-took-no-action: no tool was called" };
  }
  // Check 2: lightweight grounding — extract numeric tokens + SKU codes from
  // the answer and require at least one to appear in tool observations.
  const obsBlob = observations.join("\n");
  const numericRefs = answer.match(/\b\d{1,3}(?:[,.]\d{2,})\b|\b\d{4,}\b/g) ?? [];
  const skuRefs = answer.match(/[A-Z]{3,}[-_][A-Z0-9]+(?:[-_][A-Z0-9]+)*/g) ?? [];
  const allRefs = [...numericRefs, ...skuRefs];
  if (allRefs.length === 0) {
    return { passed: false, reason: "synthesis-not-verifiable: answer contains no checkable references" };
  }
  const grounded = allRefs.filter(ref => obsBlob.includes(ref));
  if (grounded.length === 0) {
    return { passed: false, reason: `synthesis-ungrounded: 0 of ${allRefs.length} references appear in tool observations` };
  }
  return { passed: true, reason: `${grounded.length}/${allRefs.length} references grounded` };
}

interface RunResult {
  runIdx: number;
  iters: number;
  rawAnswer: string;
  shippedAnswer: string; // empty if verification rejected
  verification: VerifyResult;
  toolCallCount: number;
  totalEvalCount: number;
  totalPromptCount: number;
  durationMs: number;
}

async function runOnce(runIdx: number): Promise<RunResult> {
  const messages: Array<Record<string, unknown>> = [
    { role: "system", content: "You are a data analyst. To answer questions about data files, you MUST use the read_csv tool to inspect the actual file contents before drawing conclusions. Do not guess or fabricate values — always inspect the data first. After inspecting the data, provide a clear answer." },
    { role: "user", content: RW2_PROMPT },
  ];
  const observations: string[] = [];
  let toolCallCount = 0;
  let totalEvalCount = 0;
  let totalPromptCount = 0;
  let rawAnswer = "";
  let iters = 0;
  const start = Date.now();

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    iters = iter + 1;
    const resp = await ollama.chat({
      model: MODEL,
      messages: messages as { role: string; content: string }[],
      tools,
      think: false,
      options: { temperature: 0 },
    });
    const msg = resp.message;
    messages.push(msg as Record<string, unknown>);
    totalEvalCount += resp.eval_count ?? 0;
    totalPromptCount += resp.prompt_eval_count ?? 0;
    if (!msg.tool_calls?.length) {
      rawAnswer = msg.content ?? "";
      break;
    }
    for (const tc of msg.tool_calls) {
      toolCallCount++;
      let result = "ERROR: unknown tool";
      if (tc.function.name === "read_csv") {
        const args = tc.function.arguments as { filename?: string };
        const safe = (args.filename ?? "sales-data.csv").split("/").pop() ?? "sales-data.csv";
        try {
          result = fs.readFileSync(`/tmp/p01-bare-verify/${safe}`, "utf-8");
        } catch (e) {
          result = `ERROR reading ${safe}: ${(e as Error).message}`;
        }
      }
      observations.push(result);
      messages.push({ role: "tool", content: result });
    }
  }

  // ── GATE FIRES HERE ────────────────────────────────────────────────────────
  const verification = verifyOutput(rawAnswer, toolCallCount, observations);
  const shippedAnswer = verification.passed ? rawAnswer : "";

  return {
    runIdx, iters, rawAnswer, shippedAnswer, verification,
    toolCallCount, totalEvalCount, totalPromptCount,
    durationMs: Date.now() - start,
  };
}

async function main(): Promise<void> {
  fs.mkdirSync("harness-reports/spike-results", { recursive: true });
  const results: RunResult[] = [];
  console.log(`p01 bare-LLM + VERIFICATION GATE × ${MODEL} × rw-2 × ${N_RUNS} runs`);
  for (let i = 0; i < N_RUNS; i++) {
    process.stdout.write(`  run ${i + 1}/${N_RUNS} ... `);
    try {
      const r = await runOnce(i);
      results.push(r);
      const tot = r.totalEvalCount + r.totalPromptCount;
      console.log(`${r.iters}i, ${r.toolCallCount}t, ${tot}tok, verify=${r.verification.passed ? "PASS" : "FAIL"} (${r.verification.reason})`);
    } catch (e) {
      console.log(`FAILED: ${(e as Error).message}`);
    }
  }
  const out = "harness-reports/spike-results/p01-bare-verify-rw2-qwen3-4b.json";
  fs.writeFileSync(out, JSON.stringify({ model: MODEL, task: "rw-2", n_runs: N_RUNS, generated_at: new Date().toISOString(), results }, null, 2));
  console.log(`\nSaved → ${out}`);
}

void main();
