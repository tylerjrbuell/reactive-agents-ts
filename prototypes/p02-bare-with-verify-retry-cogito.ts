// p02-bare-with-verify-retry-cogito.ts
//
// ─── HYPOTHESIS ────────────────────────────────────────────────────────────────
//
// Adding a retry-on-rejection loop to p01b's verification gate (when gate
// fails, inject the rejection reason as a system message and re-run the
// loop, max 2 retries) converts cogito:8b's 5/5 honest-fail into ≥1/5
// grounded answer.
//
// CONTEXT: p01b proved verification rejects cogito's fabrication 5/5.
// p02 tests whether the rejection FEEDBACK can rescue cogito — i.e., does
// telling cogito "you didn't call the tool" make it actually call the tool
// on the next attempt?
//
// PROMOTION CRITERIA: ≥1/5 retry attempts produce a grounded answer
//   (verification passes on retry). Implication: verifier-driven retry
//   (commit 45960be6) is a real recovery mechanism for fabrication-prone
//   models, not just a token sink.
//
// KILL CRITERIA: 0/5 — retry feedback is wasted on cogito-class FC failure.
//   Implication: cogito's "I'll call read_csv" prose without actual FC
//   emission is a model-level limitation, not solvable by harness feedback.
//   Mandate: route cogito through text-parse driver, OR don't use cogito
//   for tool tasks. The verifier-retry mechanism is then justified ONLY
//   for models with intermittent failure (sometimes-FC), not universal.
//
// PROVIDER: ollama; MODEL: cogito:8b
// TASK: rw-2
// RUNS: 5
// MAX_RETRIES: 2 (so each task gets up to 3 total attempts)

import { Ollama } from "ollama";
import fs from "node:fs";

const MODEL = "cogito:8b";
const MAX_ITERATIONS = 15;
const N_RUNS = 5;
const MAX_RETRIES = 2;
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
fs.mkdirSync("/tmp/p02-bare-retry", { recursive: true });
fs.writeFileSync("/tmp/p02-bare-retry/sales-data.csv", SALES_CSV);

const tools = [{
  type: "function" as const,
  function: {
    name: "read_csv",
    description: "Read the contents of a CSV file by filename. Use this to inspect data before answering.",
    parameters: { type: "object" as const, properties: { filename: { type: "string" } }, required: ["filename"] },
  },
}];

const ollama = new Ollama({ host: "http://localhost:11434" });

interface VerifyResult { passed: boolean; reason: string; }
function verifyOutput(answer: string, toolCallCount: number, observations: string[]): VerifyResult {
  if (toolCallCount === 0) return { passed: false, reason: "agent-took-no-action: no tool was called" };
  const obsBlob = observations.join("\n");
  const numericRefs = answer.match(/\b\d{1,3}(?:[,.]\d{2,})\b|\b\d{4,}\b/g) ?? [];
  const skuRefs = answer.match(/[A-Z]{3,}[-_][A-Z0-9]+(?:[-_][A-Z0-9]+)*/g) ?? [];
  const allRefs = [...numericRefs, ...skuRefs];
  if (allRefs.length === 0) return { passed: false, reason: "synthesis-not-verifiable: answer contains no checkable references" };
  const grounded = allRefs.filter(ref => obsBlob.includes(ref));
  if (grounded.length === 0) return { passed: false, reason: `synthesis-ungrounded: 0 of ${allRefs.length} references appear in tool observations` };
  return { passed: true, reason: `${grounded.length}/${allRefs.length} references grounded` };
}

interface AttemptRecord { attemptIdx: number; toolCallCount: number; rawAnswer: string; verification: VerifyResult; tokens: number; }
interface RunResult {
  runIdx: number;
  attempts: AttemptRecord[];
  shippedAnswer: string;
  finalVerification: VerifyResult;
  totalTokens: number;
  durationMs: number;
}

async function runAttempt(extraSystemMsg?: string): Promise<{ rawAnswer: string; toolCallCount: number; observations: string[]; tokens: number; }> {
  const systemContent = "You are a data analyst. To answer questions about data files, you MUST use the read_csv tool to inspect the actual file contents before drawing conclusions. Do not guess or fabricate values — always inspect the data first." + (extraSystemMsg ? `\n\nIMPORTANT (RETRY FEEDBACK): ${extraSystemMsg}` : "");
  const messages: Array<Record<string, unknown>> = [
    { role: "system", content: systemContent },
    { role: "user", content: RW2_PROMPT },
  ];
  const observations: string[] = [];
  let toolCallCount = 0;
  let tokens = 0;
  let rawAnswer = "";

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    const resp = await ollama.chat({
      model: MODEL,
      messages: messages as { role: string; content: string }[],
      tools,
      think: false,
      options: { temperature: 0 },
    });
    const msg = resp.message;
    messages.push(msg as Record<string, unknown>);
    tokens += (resp.eval_count ?? 0) + (resp.prompt_eval_count ?? 0);
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
        try { result = fs.readFileSync(`/tmp/p02-bare-retry/${safe}`, "utf-8"); }
        catch (e) { result = `ERROR reading ${safe}: ${(e as Error).message}`; }
      }
      observations.push(result);
      messages.push({ role: "tool", content: result });
    }
  }
  return { rawAnswer, toolCallCount, observations, tokens };
}

async function runOnce(runIdx: number): Promise<RunResult> {
  const attempts: AttemptRecord[] = [];
  let totalTokens = 0;
  let lastFeedback: string | undefined = undefined;
  let lastVerification: VerifyResult = { passed: false, reason: "no attempts yet" };
  const start = Date.now();

  for (let attemptIdx = 0; attemptIdx <= MAX_RETRIES; attemptIdx++) {
    const { rawAnswer, toolCallCount, observations, tokens } = await runAttempt(lastFeedback);
    totalTokens += tokens;
    const verification = verifyOutput(rawAnswer, toolCallCount, observations);
    attempts.push({ attemptIdx, toolCallCount, rawAnswer, verification, tokens });
    lastVerification = verification;
    if (verification.passed) break;
    // Inject the rejection reason as feedback for the next attempt
    lastFeedback = `Your previous answer was rejected: ${verification.reason}. You MUST call the read_csv tool to inspect the actual data before answering. Do not just describe what you would do — actually emit a tool call.`;
  }

  return {
    runIdx,
    attempts,
    shippedAnswer: lastVerification.passed ? attempts[attempts.length - 1]!.rawAnswer : "",
    finalVerification: lastVerification,
    totalTokens,
    durationMs: Date.now() - start,
  };
}

async function main(): Promise<void> {
  fs.mkdirSync("harness-reports/spike-results", { recursive: true });
  const results: RunResult[] = [];
  console.log(`p02 bare-LLM + GATE + RETRY × ${MODEL} × rw-2 × ${N_RUNS} runs (max ${MAX_RETRIES} retries)`);
  for (let i = 0; i < N_RUNS; i++) {
    process.stdout.write(`  run ${i + 1}/${N_RUNS} ... `);
    try {
      const r = await runOnce(i);
      results.push(r);
      const recovered = r.finalVerification.passed ? "RECOVERED" : "STILL-FAILS";
      console.log(`${r.attempts.length} attempts, ${r.totalTokens}tok, final=${recovered} (${r.finalVerification.reason})`);
    } catch (e) {
      console.log(`FAILED: ${(e as Error).message}`);
    }
  }
  const out = "harness-reports/spike-results/p02-bare-verify-retry-rw2-cogito-8b.json";
  fs.writeFileSync(out, JSON.stringify({ model: MODEL, task: "rw-2", n_runs: N_RUNS, max_retries: MAX_RETRIES, generated_at: new Date().toISOString(), results }, null, 2));
  console.log(`\nSaved → ${out}`);
}

void main();
