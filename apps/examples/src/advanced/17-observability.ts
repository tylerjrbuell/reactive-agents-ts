/**
 * Example 17: Full Observability
 *
 * Demonstrates the observability layer with:
 * - Live log streaming during execution
 * - Metrics dashboard printed on completion
 * - JSONL file export for offline analysis
 * - Structured phase timing and tool tracking
 *
 * The metrics dashboard shows:
 * - Header card: status, duration, steps, tokens, estimated cost
 * - Execution timeline: per-phase timing with warning icons
 * - Tool execution summary: call counts and average duration
 * - Alerts & insights: bottleneck detection and optimization tips
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... bun run apps/examples/src/advanced/17-observability.ts
 *   bun run apps/examples/src/advanced/17-observability.ts  # test mode
 */
import { ReactiveAgents } from "reactive-agents";
import { existsSync, unlinkSync } from "node:fs";

export interface ExampleResult {
  passed: boolean;
  output: string;
  steps: number;
  tokens: number;
  durationMs: number;
}

// Always use test provider — this example demonstrates instrumentation, not LLM quality.
// Swap to "anthropic" (and remove withTestResponses) to observe real LLM execution.
const PROVIDER = "test" as const;
const LOG_FILE = "/tmp/example_17_obs.jsonl";

export async function run(): Promise<ExampleResult> {
  const start = Date.now();

  // Clean up any previous run
  try { if (existsSync(LOG_FILE)) unlinkSync(LOG_FILE); } catch { /* ignore */ }

  console.log("\n=== Observability Example ===\n");
  console.log(`Mode: TEST (observability instrumentation demo)\n`);

  // ─── Part 1: Normal verbosity with JSONL file export ──────────────────────

  console.log("Part 1: Normal verbosity + JSONL file export");

  const agent1 = await ReactiveAgents.create()
    .withName("observed-agent")
    .withProvider(PROVIDER)
    .withObservability({ verbosity: "normal", live: false, file: LOG_FILE })
    .withTestResponses({ "": "FINAL ANSWER: Observability demo complete. All phases tracked." })
    .build();

  const result1 = await agent1.run("Run a task to demonstrate full observability tracking.");

  const fileCreated = existsSync(LOG_FILE);
  console.log(`  JSONL log created: ${fileCreated}`);
  console.log(`  Output: ${result1.output.slice(0, 80)}`);
  console.log(`  Steps: ${result1.metadata.stepsCount}, Tokens: ${result1.metadata.tokensUsed}`);

  // ─── Part 2: Verbose mode — structured phase logs ─────────────────────────

  console.log("\nPart 2: Verbose mode (structured phase logs)");

  const agent2 = await ReactiveAgents.create()
    .withName("verbose-agent")
    .withProvider(PROVIDER)
    .withObservability({ verbosity: "verbose", live: false })
    .withTestResponses({ "": "FINAL ANSWER: Verbose mode captures all phase details." })
    .build();

  const result2 = await agent2.run("Demonstrate verbose observability output.");
  console.log(`  Output: ${result2.output.slice(0, 80)}`);

  // ─── Part 3: Minimal mode — no output except final result ─────────────────

  console.log("\nPart 3: Minimal mode (silent execution)");

  const agent3 = await ReactiveAgents.create()
    .withName("minimal-agent")
    .withProvider(PROVIDER)
    .withObservability({ verbosity: "minimal", live: false })
    .withTestResponses({ "": "FINAL ANSWER: Minimal mode suppresses all observability output." })
    .build();

  const result3 = await agent3.run("Run silently.");
  console.log(`  Output: ${result3.output.slice(0, 80)}`);

  // ─── Cleanup ───────────────────────────────────────────────────────────────

  try { if (fileCreated) unlinkSync(LOG_FILE); } catch { /* ignore */ }

  // ─── Summary ───────────────────────────────────────────────────────────────

  const passed = result1.success && result2.success && result3.success && fileCreated;
  const output = `jsonl=${fileCreated} | ${result1.output.slice(0, 60)}`;

  return {
    passed,
    output,
    steps: (result1.metadata.stepsCount ?? 1) + (result2.metadata.stepsCount ?? 1) + (result3.metadata.stepsCount ?? 1),
    tokens: result1.metadata.tokensUsed + result2.metadata.tokensUsed + result3.metadata.tokensUsed,
    durationMs: Date.now() - start,
  };
}

if (import.meta.main) {
  const r = await run();
  console.log(r.passed ? "\n✅ PASS" : "\n❌ FAIL", r.output.slice(0, 200));
  process.exit(r.passed ? 0 : 1);
}
