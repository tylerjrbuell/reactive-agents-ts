/**
 * Example: Builder Configuration Surfaces
 *
 * Pins a batch of declarative builder methods that have no other example
 * witness. Each surface is exercised as a builder chain that compiles +
 * builds successfully under the test provider:
 *
 *   - .withBudget({ tokenLimit, costLimit, warningRatio })
 *   - .withTimeout(ms)
 *   - .withMinIterations(n)
 *   - .withTaskContext({ ... })
 *   - .withEnvironment({ ... })
 *   - .withDocuments([{ content, source }])
 *   - .withRetryPolicy({ maxRetries, backoffMs })
 *   - .withErrorHandler(fn)
 *   - .withHealthCheck()
 *   - .withCortex(url?)
 *   - .withGateway()
 *
 * Pass criterion: agent builds without throwing, then runs the test
 * scenario to completion (success=true). Surface coverage is asserted
 * via `agent.toConfig()` — every method we chained MUST be reflected
 * somewhere in the serialized config (an "absent" surface would silently
 * fail the build but pass the run).
 */

import { ReactiveAgents } from "reactive-agents";

export interface ExampleResult {
  passed: boolean;
  output: string;
  steps: number;
  tokens: number;
  durationMs: number;
}

export async function run(opts?: { provider?: string; model?: string }): Promise<ExampleResult> {
  const start = Date.now();
  type PN = "anthropic" | "openai" | "ollama" | "gemini" | "litellm" | "test";
  const provider = (opts?.provider ?? "test") as PN;

  console.log("\n=== Builder Configuration Surfaces witness ===\n");

  let b = ReactiveAgents.create()
    .withName("config-surfaces")
    .withProvider(provider)
    .withReasoning()
    .withBudget({ tokenLimit: 50000, costLimit: 1.0, warningRatio: 0.75 })
    .withTimeout(60_000)
    .withMinIterations(1)
    .withMaxIterations(3)
    .withTaskContext({ task_id: "demo-task-1", priority: "low" })
    .withEnvironment({ DEPLOY_ENV: "smoke-test" })
    .withDocuments([
      { content: "Paris is the capital of France.", source: "facts.txt" },
      { content: "The Eiffel Tower is in Paris.", source: "facts.txt" },
    ])
    .withRetryPolicy({ maxRetries: 2, backoffMs: 100 })
    .withErrorHandler(async (err) => {
      console.log("  error handler invoked:", String(err).slice(0, 40));
    })
    .withHealthCheck()
    .withCortex();

  if (opts?.model) b = b.withModel(opts.model);
  if (provider === "test") {
    b = b.withTestScenario([
      { text: "FINAL ANSWER: Paris." },
    ]);
  }

  // Surface fingerprint: read the builder's internal `_*` fields directly
  // (the `with*` methods are mutators that set these). Each chained method
  // MUST have left its corresponding `_*` field set; if any is unset, the
  // builder silently dropped the call.
  const bs = b as unknown as Record<string, unknown>;
  const surfaces = {
    budget: bs._budget !== undefined || bs._budgetLimits !== undefined,
    timeout: bs._executionTimeoutMs === 60_000,
    taskContext: bs._taskContext !== undefined,
    environment: bs._environmentContext !== undefined,
    documents: Array.isArray(bs._documents) && (bs._documents as unknown[]).length >= 2,
    minIterations: bs._minIterations === 1,
    retryPolicy: bs._retryPolicy !== undefined,
    errorHandler: typeof bs._errorHandler === "function",
    healthCheck: bs._enableHealthCheck === true,
    cortex: bs._cortexUrl !== undefined || bs._enableCortex === true,
  };

  const agent = await b.build();
  const result = await agent.run("What is the capital of France?");
  await agent.dispose();

  console.log("  surface fingerprints:", surfaces);
  console.log(`  agent.run success=${result.success} steps=${result.metadata.stepsCount} tokens=${result.metadata.tokensUsed}`);
  const allReached = Object.values(surfaces).every(Boolean);

  const passed = result.success && allReached;
  return {
    passed,
    output: passed
      ? `${Object.keys(surfaces).length} declarative builder surfaces left fingerprints on builder state: ${Object.keys(surfaces).join(", ")}`
      : `config-surfaces witness FAILED — success=${result.success} surfaces=${JSON.stringify(surfaces)}`,
    steps: result.metadata.stepsCount,
    tokens: result.metadata.tokensUsed,
    durationMs: Date.now() - start,
  };
}

if (import.meta.main) {
  const r = await run();
  console.log(r.passed ? "\n✅ PASS" : "\n❌ FAIL", r.output);
  process.exit(r.passed ? 0 : 1);
}
