/**
 * Example: The Process Model — inspect, fork, and the trust receipt
 * (Arc 1 launch demo, composes Tasks 1-9).
 *
 * A durable, reasoning agent runs a forced multi-step calculator task on a
 * local Ollama model. While it runs, `handle.inspect()` projects live
 * kernel state (iteration / steps / last thought) with zero setup. On
 * completion, `result.receipt` grades the run's evidence trail (did it
 * actually use a tool, or answer from memory?). Then `agent.fork()` starts a
 * BRAND NEW run from an early checkpoint of the first one — a counterfactual
 * restart, never "time travel": every LLM call after the fork point is a
 * live, fresh call.
 *
 * This mirrors `rax ps` / `rax attach` (same durable RunStore, viewed from
 * the CLI instead of in-process) — see `apps/docs/src/content/docs/features/process-model.md`.
 *
 * Requires a local Ollama with `qwen3:4b` pulled (`ollama pull qwen3:4b`).
 * No API key needed. Gracefully skips (exit 0) when Ollama is unreachable —
 * this demo is NOT part of the CI-gated suite (see index.ts registration).
 *
 * Usage:
 *   bun apps/examples/src/advanced/process-model-demo.ts
 */
import { Effect } from "effect";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReactiveAgents } from "reactive-agents";
import type { AgentStreamEvent } from "@reactive-agents/runtime";

export interface ExampleResult {
  passed: boolean;
  output: string;
  steps: number;
  tokens: number;
  durationMs: number;
}

const MODEL = "qwen3:4b";

/**
 * A real, deterministic "calculator" tool — no built-in tool of this exact
 * name exists in the framework, so the task instruction below ("use the
 * calculator tool") needs a matching custom tool registered via
 * `.withTools({ tools: [...] })`, not a bare string array (which isn't a
 * valid `ToolsOptions` shape). Validates the expression is arithmetic-only
 * before evaluating — no arbitrary code execution.
 */
const calculatorTool = {
  definition: {
    name: "calculator",
    description: "Evaluate a basic arithmetic expression (+, -, *, /, parentheses) and return the numeric result.",
    parameters: [
      { name: "expression", type: "string" as const, description: "Arithmetic expression, e.g. '137*89'", required: true },
    ],
    riskLevel: "low" as const,
    timeoutMs: 5_000,
    requiresApproval: false,
    source: "function" as const,
  },
  handler: (args: Record<string, unknown>) =>
    Effect.try({
      try: () => {
        const expression = String(args.expression ?? "");
        if (!/^[\d\s+\-*/().]+$/.test(expression)) {
          throw new Error(`unsafe or empty expression: "${expression}"`);
        }
        // Arithmetic-only input validated above — safe to evaluate directly.
        const value = new Function(`"use strict"; return (${expression});`)() as number;
        return String(value);
      },
      catch: (e) => (e instanceof Error ? e : new Error(String(e))),
    }),
};

/** Same reachability check the CLI's `rax run` provider auto-detect uses (apps/cli/src/commands/demo.ts). */
async function detectOllama(model: string): Promise<{ reachable: boolean; hasModel: boolean }> {
  const endpoint = process.env.OLLAMA_ENDPOINT ?? "http://localhost:11434";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2000);
  try {
    const response = await fetch(`${endpoint}/api/tags`, { signal: controller.signal });
    if (!response.ok) return { reachable: false, hasModel: false };
    const data = (await response.json()) as { models?: Array<{ name: string }> };
    const models = (data.models ?? []).map((m) => m.name);
    return { reachable: true, hasModel: models.some((m) => m === model || m.startsWith(`${model}-`)) };
  } catch {
    return { reachable: false, hasModel: false };
  } finally {
    clearTimeout(timer);
  }
}

function skip(reason: string, start: number): ExampleResult {
  console.log(`\n=== Process Model Demo ===\n`);
  console.log(`  ⏭  SKIPPED: ${reason}\n`);
  return { passed: true, output: `skipped: ${reason}`, steps: 0, tokens: 0, durationMs: Date.now() - start };
}

export async function run(opts?: { provider?: string; model?: string }): Promise<ExampleResult> {
  const start = Date.now();

  // This demo is pinned to Ollama/qwen3:4b regardless of the suite's default
  // provider — inspect()/fork() need the durable kernel path and a real
  // multi-step tool-forcing task, which the `test` provider (used by
  // `bun run index.ts --offline`) can't script through a live stream. Skip
  // gracefully in offline mode and whenever Ollama itself isn't available.
  if (opts?.provider === "test") {
    return skip("offline mode (test provider) — this demo needs a live Ollama model", start);
  }
  const { reachable, hasModel } = await detectOllama(MODEL);
  if (!reachable) {
    return skip(`Ollama not reachable at ${process.env.OLLAMA_ENDPOINT ?? "http://localhost:11434"} — start it with 'ollama serve'`, start);
  }
  if (!hasModel) {
    return skip(`model '${MODEL}' not pulled — run 'ollama pull ${MODEL}'`, start);
  }

  const dir = mkdtempSync(join(tmpdir(), "ra-process-model-demo-"));
  console.log(`\n=== Process Model Demo (Ollama · ${MODEL}) ===\n`);

  try {
    const agent = await ReactiveAgents.create()
      .withName("process-model-demo")
      .withProvider("ollama")
      .withModel(MODEL)
      .withTools({ tools: [calculatorTool] })
      .withReasoning({ defaultStrategy: "reactive" })
      .withDurableRuns({ dir })
      .withMaxIterations(8)
      .build();

    // ── Step 1: run() as a stream — inspect() while it's still going ──
    console.log("Step 1 — runStream() a forced multi-step calculator task…");
    const task =
      "You MUST use the calculator tool for every arithmetic step — do NOT compute anything mentally. " +
      "Step 1: call calculator with 137*89. Step 2: call calculator adding 4455 to that result. " +
      "Step 3: call calculator dividing that sum by 7. Then report each step's result.";
    const handle = agent.runStream(task);

    const inspections: NonNullable<ReturnType<typeof handle.inspect>>[] = [];
    const sampler = setInterval(() => {
      const snap = handle.inspect();
      const last = inspections[inspections.length - 1];
      if (snap && (!last || snap.iteration > last.iteration)) {
        inspections.push(snap);
        console.log(
          `  inspect() #${inspections.length} — iteration=${snap.iteration} steps=${snap.stepsCount} ` +
            `messages=${snap.messagesCount} pendingToolCalls=[${snap.pendingToolCalls.join(", ")}] ` +
            `lastThought="${(snap.lastThought ?? "").slice(0, 60)}"`,
        );
      }
    }, 700);

    let completed: Extract<AgentStreamEvent, { _tag: "StreamCompleted" }> | undefined;
    for await (const event of handle) {
      if (event._tag === "StreamCompleted") completed = event;
    }
    clearInterval(sampler);

    if (!completed) throw new Error("stream ended without StreamCompleted");
    const runId = completed.runId;
    if (!runId) throw new Error("StreamCompleted carried no runId — was .withDurableRuns() applied?");

    console.log(`\nStep 2 — run completed. output: "${completed.output.slice(0, 100)}"`);
    console.log(`  runId=${runId}  iterations sampled=${inspections.length}`);

    // ── Step 3: the trust receipt — graded evidence, not a truth certificate ──
    const receipt = completed.receipt;
    console.log(`\nStep 3 — result.receipt:`);
    console.log(`  verdict=${receipt?.verdict} confidence=${receipt?.confidence} method=${receipt?.method}`);
    console.log(`  toolsUsed=[${receipt?.toolsUsed.join(", ")}] toolCallStats=${JSON.stringify(receipt?.toolCallStats)}`);

    // ── Step 4: fork — a counterfactual restart from an early checkpoint ──
    console.log(`\nStep 4 — agent.fork(runId, { at: 1 }) — counterfactual restart, NOT time-travel…`);
    const forkResult = await agent.fork(runId, { at: 1 });
    console.log(`  fork output: "${forkResult.output.slice(0, 100)}"`);
    console.log(`  fork receipt.forkedFrom=${forkResult.receipt?.forkedFrom}`);

    const runs = await agent.listRuns();
    const forkRow = runs.find((r) => r.runId.startsWith(`${runId}-fork-`));
    console.log(
      `\nStep 5 — listRuns() lineage: fork row runId=${forkRow?.runId} ` +
        `forkedFrom=${forkRow?.forkedFrom} forkedAtIteration=${forkRow?.forkedAtIteration} status=${forkRow?.status}`,
    );

    console.log(`\n  (mirrors: rax ps --all   |   rax attach ${runId})`);

    await agent.dispose();

    const passed =
      receipt?.verdict === "tool-grounded" &&
      inspections.length > 0 &&
      forkResult.success === true &&
      forkRow?.forkedFrom === runId;

    console.log(`\n${passed ? "✓ PASS" : "✗ FAIL"}\n`);

    return {
      passed,
      output: `${completed.output} | fork: ${forkResult.output}`,
      steps: completed.metadata.stepsCount,
      tokens: completed.metadata.tokensUsed,
      durationMs: Date.now() - start,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Allow direct execution.
if (import.meta.main) {
  run().then((r) => {
    process.exit(r.passed ? 0 : 1);
  });
}
