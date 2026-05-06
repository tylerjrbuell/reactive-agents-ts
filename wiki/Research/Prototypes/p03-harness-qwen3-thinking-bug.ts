// p03-harness-qwen3-thinking-bug.ts
//
// ─── PROBE / WIRING-GAP GATE ──────────────────────────────────────────────────
//
// HYPOTHESIS (gap): The @reactive-agents harness auto-enables qwen3 thinking
//   mode (resolveThinking() in packages/llm-provider/src/providers/local.ts:226
//   defaults to capable→true when caller passes undefined), which produces
//   empty `message.content` from Ollama and degrades harness output for
//   qwen3:4b on rw-2.
//
// WHY THIS PROBE EXISTS: gate-before-fix. We need to reproduce the failure
//   on the current main code path before touching it. If we cannot reproduce
//   the empty-content failure, the gap theory is wrong and we adjust.
//
// MEASUREMENT (per discipline contract Rule 4):
//   - Behavioral: did the agent produce non-empty output? how many iterations?
//   - Mechanistic: how many LLM calls? how many tool calls? content lengths?
//   - Quality: did it identify ELEC-4K-TV-001 OOS as the cause? (TV slot 1-3 only)
//   - Cost: tokens, durationMs
//   - Robustness: across N=3 runs (temp=0)
//   - Surprise: anything unexpected in the event stream
//
// PROVIDER: ollama; MODEL: qwen3:4b; STRATEGY: reactive (react)
// TASK: rw-2 (sales-data investigation, red herring = 15% discount,
//       true cause = TV ELEC-4K-TV-001 out of stock after order 3 on day 2)
// RUNS: 3 (kept low — each run is many iterations under the bug)
//
// Output: harness-reports/spike-results/p03-harness-qwen3-PRE-FIX.json
//   (re-run post-fix → p03-harness-qwen3-POST-FIX.json; diff is the evidence)

import { ReactiveAgents } from "@reactive-agents/runtime";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const MODEL = "qwen3:4b";
const PROVIDER = "ollama" as const;
const N_RUNS = 3;
const MAX_ITERATIONS = 15;
const TIMEOUT_MS = 180_000; // 3 min per run

// ── rw-2 task definition (mirrored from packages/benchmarks/src/tasks/real-world.ts) ──

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

const RW2_BASE_PROMPT =
  `Analyze the attached sales data in sales-data.csv. Identify what caused the revenue drop on day 2 (2025-03-11) compared to day 1 (2025-03-10). Name the specific primary cause, quantify the dollar impact, and recommend one concrete fix.`;

// ── Per-run telemetry capture ──

interface RunResult {
  run: number;
  status: "pass" | "fail" | "error";
  agentSuccess: boolean | null; // agentResult.success — false on verifier reject / kernel failure
  agentError: string | null; // agentResult.error — structured failure reason
  agentTerminatedBy: string | null; // why the kernel exited (final_answer | max_iterations | etc.)
  agentGoalAchieved: boolean | null; // semantic completion
  durationMs: number;
  output: string;
  outputLength: number;
  outputEmpty: boolean;
  identifiedTrueCause: boolean; // mentions ELEC-4K-TV-001 or "out of stock" or "stockout"
  grabbedRedHerring: boolean; // mentions "discount" + "15%"
  metadata: {
    tokensUsed: number;
    iterations: number;
  };
  events: {
    llmCallsCompleted: number;
    toolCallsExecuted: number;
    reasoningSteps: number;
    emptyAssistantContentCount: number; // diagnostic for the bug
    nonEmptyAssistantContentCount: number;
  };
  error?: string;
}

async function runOnce(runIdx: number, tmpDir: string): Promise<RunResult> {
  const start = performance.now();

  // Build with full prompt that points to the fixture path (matches bench runner pattern)
  const prompt =
    `Working directory for this task: ${tmpDir}\n\n` +
    `All task files (e.g. sales-data.csv) are located in that directory. Use the full path when reading files.\n\n` +
    RW2_BASE_PROMPT;

  // Build harness with same shape as bench rw-2 config: tools + reasoning + react strategy
  const builder = ReactiveAgents.create()
    .withName(`p03-rw2-${runIdx}`)
    .withProvider(PROVIDER)
    .withModel(MODEL)
    .withMaxIterations(MAX_ITERATIONS)
    .withTools()
    .withReasoning({ defaultStrategy: "reactive" });

  const agent = await builder.build();

  let llmCallsCompleted = 0;
  let toolCallsExecuted = 0;
  let reasoningSteps = 0;
  let emptyAssistantContentCount = 0;
  let nonEmptyAssistantContentCount = 0;
  let cumulativeTokens = 0;

  const unsub = await agent.subscribe((event: { _tag: string; [k: string]: unknown }) => {
    if (event._tag === "LLMRequestCompleted") {
      llmCallsCompleted++;
      cumulativeTokens += (event.tokensUsed as number | undefined) ?? 0;
    }
    // Sprint 3.6 diagnostic — has response.content for empty-content detection
    if (event._tag === "LLMExchangeEmitted") {
      const response = event.response as
        | { content?: string; toolCalls?: readonly unknown[] }
        | undefined;
      const content = response?.content ?? "";
      const hasToolCalls = (response?.toolCalls?.length ?? 0) > 0;
      if (content.trim().length === 0 && !hasToolCalls) emptyAssistantContentCount++;
      else nonEmptyAssistantContentCount++;
    }
    if (event._tag === "ToolCallCompleted") {
      toolCallsExecuted++;
    }
    if (event._tag === "ReasoningStepCompleted") {
      reasoningSteps++;
    }
  });

  try {
    const timeoutP = new Promise<never>((_, r) =>
      setTimeout(() => r(new Error(`timeout after ${TIMEOUT_MS}ms`)), TIMEOUT_MS),
    );

    // Suppress agent's verbose logs to keep probe output clean
    const _log = console.log;
    const _err = console.error;
    const _warn = console.warn;
    const _info = console.info;
    const _debug = console.debug;
    const _stdout = process.stdout.write.bind(process.stdout);
    console.log = console.error = console.warn = console.info = console.debug = () => {};
    process.stdout.write = (() => true) as never;

    let agentResult: Awaited<ReturnType<typeof agent.run>>;
    try {
      agentResult = await Promise.race([agent.run(prompt), timeoutP]);
    } finally {
      console.log = _log;
      console.error = _err;
      console.warn = _warn;
      console.info = _info;
      console.debug = _debug;
      process.stdout.write = _stdout;
    }

    const durationMs = performance.now() - start;
    const output = agentResult.output ?? "";
    const lower = output.toLowerCase();
    const ar = agentResult as unknown as {
      success?: boolean;
      error?: string;
      terminatedBy?: string;
      goalAchieved?: boolean | null;
    };

    return {
      run: runIdx,
      status: "pass",
      agentSuccess: typeof ar.success === "boolean" ? ar.success : null,
      agentError: typeof ar.error === "string" ? ar.error : null,
      agentTerminatedBy: typeof ar.terminatedBy === "string" ? ar.terminatedBy : null,
      agentGoalAchieved: typeof ar.goalAchieved === "boolean" || ar.goalAchieved === null ? ar.goalAchieved ?? null : null,
      durationMs,
      output,
      outputLength: output.length,
      outputEmpty: output.trim().length === 0,
      identifiedTrueCause:
        lower.includes("elec-4k-tv-001") ||
        lower.includes("out of stock") ||
        lower.includes("out-of-stock") ||
        lower.includes("stockout") ||
        lower.includes("inventory"),
      grabbedRedHerring: lower.includes("discount") && lower.includes("15"),
      metadata: {
        tokensUsed: agentResult.metadata?.tokensUsed ?? cumulativeTokens,
        iterations: agentResult.metadata?.stepsCount ?? reasoningSteps,
      },
      events: {
        llmCallsCompleted,
        toolCallsExecuted,
        reasoningSteps,
        emptyAssistantContentCount,
        nonEmptyAssistantContentCount,
      },
    };
  } catch (e) {
    const durationMs = performance.now() - start;
    return {
      run: runIdx,
      status: "error",
      agentSuccess: null,
      agentError: e instanceof Error ? e.message : String(e),
      agentTerminatedBy: null,
      agentGoalAchieved: null,
      durationMs,
      output: "",
      outputLength: 0,
      outputEmpty: true,
      identifiedTrueCause: false,
      grabbedRedHerring: false,
      metadata: { tokensUsed: cumulativeTokens, iterations: reasoningSteps },
      events: {
        llmCallsCompleted,
        toolCallsExecuted,
        reasoningSteps,
        emptyAssistantContentCount,
        nonEmptyAssistantContentCount,
      },
      error: e instanceof Error ? e.message : String(e),
    };
  } finally {
    unsub();
    await agent.dispose();
  }
}

async function main() {
  // Allow caller to override output filename to distinguish PRE-FIX vs POST-FIX
  const outputSuffix = process.argv[2] ?? "PRE-FIX";

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "p03-rw2-"));
  fs.writeFileSync(path.join(tmpDir, "sales-data.csv"), generateSalesData());

  console.log(`p03 HARNESS × ${MODEL} × rw-2 × ${N_RUNS} runs`);
  console.log(`tmpDir: ${tmpDir}`);
  console.log(`output suffix: ${outputSuffix}`);
  console.log("---");

  const results: RunResult[] = [];
  for (let i = 0; i < N_RUNS; i++) {
    process.stdout.write(`run ${i + 1}/${N_RUNS}... `);
    const r = await runOnce(i, tmpDir);
    results.push(r);
    console.log(
      `status=${r.status} success=${r.agentSuccess} termBy=${r.agentTerminatedBy ?? "?"} ` +
      `dur=${(r.durationMs / 1000).toFixed(1)}s outLen=${r.outputLength} ` +
      `iter=${r.metadata.iterations} toolCalls=${r.events.toolCallsExecuted} ` +
      `cause=${r.identifiedTrueCause ? "TV-OOS✓" : "missed"} ` +
      `redherring=${r.grabbedRedHerring ? "yes" : "no"}` +
      (r.agentError ? ` ERR: ${r.agentError.slice(0, 90)}` : "") +
      (r.error ? ` EX: ${r.error}` : ""),
    );
  }

  const summary = {
    probe: "p03-harness-qwen3-thinking-bug",
    suffix: outputSuffix,
    model: MODEL,
    provider: PROVIDER,
    task: "rw-2",
    n_runs: N_RUNS,
    max_iterations: MAX_ITERATIONS,
    generated_at: new Date().toISOString(),
    aggregate: {
      empty_outputs: results.filter((r) => r.outputEmpty).length,
      agent_success_true: results.filter((r) => r.agentSuccess === true).length,
      agent_success_false: results.filter((r) => r.agentSuccess === false).length,
      runs_with_structured_error: results.filter((r) => (r.agentError?.length ?? 0) > 0).length,
      identified_true_cause: results.filter((r) => r.identifiedTrueCause).length,
      grabbed_red_herring: results.filter((r) => r.grabbedRedHerring).length,
      avg_iterations: Math.round(
        results.reduce((s, r) => s + r.metadata.iterations, 0) / results.length,
      ),
      avg_tokens: Math.round(
        results.reduce((s, r) => s + r.metadata.tokensUsed, 0) / results.length,
      ),
      avg_duration_ms: Math.round(
        results.reduce((s, r) => s + r.durationMs, 0) / results.length,
      ),
      avg_empty_content_ratio:
        results.reduce(
          (s, r) =>
            s +
            (r.events.llmCallsCompleted > 0
              ? r.events.emptyAssistantContentCount / r.events.llmCallsCompleted
              : 0),
          0,
        ) / results.length,
    },
    runs: results,
  };

  const outDir = path.join(
    "/home/tylerbuell/Documents/AIProjects/reactive-agents-ts",
    "harness-reports",
    "spike-results",
  );
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `p03-harness-qwen3-${outputSuffix}.json`);
  fs.writeFileSync(outFile, JSON.stringify(summary, null, 2));
  console.log("---");
  console.log(`wrote ${outFile}`);
  console.log(
    `summary: empty_outputs=${summary.aggregate.empty_outputs}/${N_RUNS} ` +
      `true_cause=${summary.aggregate.identified_true_cause}/${N_RUNS} ` +
      `red_herring=${summary.aggregate.grabbed_red_herring}/${N_RUNS} ` +
      `avg_iter=${summary.aggregate.avg_iterations} ` +
      `avg_tok=${summary.aggregate.avg_tokens} ` +
      `avg_empty_content_ratio=${summary.aggregate.avg_empty_content_ratio.toFixed(2)}`,
  );

  await new Promise((r) => setTimeout(r, 100));
  process.exit(0);
}

main().catch((err) => {
  console.error("p03 probe failed:", err);
  process.exit(1);
});
