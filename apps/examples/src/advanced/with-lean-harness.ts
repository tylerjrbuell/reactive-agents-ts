/**
 * Example: .withLeanHarness() Pruning-Principle Witness
 *
 * Witnesses the lean-harness builder gate (Pruning Principle, NLAH §9),
 * shipped at `packages/runtime/src/builder.ts:1106` and wired through
 * `packages/runtime/src/runtime.ts:915`.
 *
 * What it does:
 *   - Bypasses the terminal verifier gate (no-op verifier substituted)
 *   - Disables strategy switching
 *
 * Why it ships: on frontier models the verifier+strategy-switch pair costs
 * ~13.6× tokens while producing outcomes 0.8pp worse than the lean config.
 *
 * This example runs the same task through:
 *   A) full harness (.withReasoning())
 *   B) lean harness  (.withReasoning().withLeanHarness())
 * and asserts the lean variant emits **strictly fewer** harness-attributable
 * steps/tokens than the full variant on an identical deterministic scenario.
 *
 * Pass criterion: `lean.tokens <= full.tokens` AND `lean.steps <= full.steps`
 * AND both runs complete (success=true).
 *
 * Limitation note: under the test provider, the LLM call cost is fixed by the
 * scenario, so the observable delta is in *step count* (verifier phase skipped)
 * rather than tokens. With a live provider the token delta dominates. We assert
 * the "≤" relation (strictly-lower step count expected with test provider).
 *
 * Usage:
 *   bun run apps/examples/src/advanced/with-lean-harness.ts
 */

import { ReactiveAgents } from "reactive-agents";

export interface ExampleResult {
  passed: boolean;
  output: string;
  steps: number;
  tokens: number;
  durationMs: number;
}

const SCENARIO = [
  { match: "summarize", text: "FINAL ANSWER: The report covers Q1 revenue, growth metrics, and outlook." },
  { text: "FINAL ANSWER: Done." },
];

async function runVariant(
  label: string,
  lean: boolean,
  opts?: { provider?: string; model?: string },
): Promise<{ steps: number; tokens: number; success: boolean; output: string; durationMs: number }> {
  type PN = "anthropic" | "openai" | "ollama" | "gemini" | "litellm" | "test";
  const provider = (opts?.provider ?? "test") as PN;
  const t0 = Date.now();

  let b = ReactiveAgents.create()
    .withName(`harness-${label}`)
    .withProvider(provider)
    .withReasoning();
  if (opts?.model) b = b.withModel(opts.model);
  if (provider === "test") b = b.withTestScenario(SCENARIO);
  if (lean) b = b.withLeanHarness();

  const agent = await b.withMaxIterations(4).build();

  const result = await agent.run("Summarize the quarterly report.");
  await agent.dispose();

  return {
    steps: result.metadata.stepsCount,
    tokens: result.metadata.tokensUsed,
    success: result.success,
    output: result.output,
    durationMs: Date.now() - t0,
  };
}

export async function run(opts?: { provider?: string; model?: string }): Promise<ExampleResult> {
  const start = Date.now();
  console.log("=== withLeanHarness() Pruning Witness ===\n");

  console.log("─── Variant A: full harness ───");
  const full = await runVariant("full", false, opts);
  console.log(
    `  success=${full.success} steps=${full.steps} tokens=${full.tokens} durationMs=${full.durationMs}`,
  );
  console.log(`  output: ${full.output.slice(0, 80)}`);

  console.log("\n─── Variant B: .withLeanHarness() ───");
  const lean = await runVariant("lean", true, opts);
  console.log(
    `  success=${lean.success} steps=${lean.steps} tokens=${lean.tokens} durationMs=${lean.durationMs}`,
  );
  console.log(`  output: ${lean.output.slice(0, 80)}`);

  // ── Delta ─────────────────────────────────────────────────────────────────
  const stepsDelta = full.steps - lean.steps;
  const tokensDelta = full.tokens - lean.tokens;
  console.log("\n─── Delta (full − lean) ───");
  console.log(`  steps:  ${stepsDelta >= 0 ? "+" : ""}${stepsDelta}`);
  console.log(`  tokens: ${tokensDelta >= 0 ? "+" : ""}${tokensDelta}`);

  // Aspirational witness: lean must be STRICTLY cheaper on at least one axis
  // (steps OR tokens) under the same scenario. Today this cannot fire under
  // the deterministic test provider — there is no entropy/verifier overhead
  // for lean to strip — so the example is flagged `expectsFail: true` in the
  // suite registry. Promote when:
  //   (a) the witness is rewritten to assert telemetry-event-emission delta
  //       (lean emits strictly fewer reactive-intelligence phase events), OR
  //   (b) a cassette-driven provider produces measurable RI overhead in record
  //       mode so a step/token delta is observable.
  const bothCompleted = full.success && lean.success;
  const leanStrictlyCheaper =
    lean.steps < full.steps || lean.tokens < full.tokens;
  const passed = bothCompleted && leanStrictlyCheaper;

  return {
    passed,
    output: passed
      ? `lean strictly cheaper on at least one axis (Δsteps=${stepsDelta}, Δtokens=${tokensDelta}).`
      : `withLeanHarness witness FAILED — bothCompleted=${bothCompleted} leanStrictlyCheaper=${leanStrictlyCheaper} Δsteps=${stepsDelta} Δtokens=${tokensDelta} — test provider has no RI overhead to strip; rewrite witness to assert event-emission delta.`,
    steps: lean.steps,
    tokens: lean.tokens,
    durationMs: Date.now() - start,
  };
}

if (import.meta.main) {
  const r = await run();
  console.log(r.passed ? "\n✅ PASS" : "\n❌ FAIL", r.output);
  process.exit(r.passed ? 0 : 1);
}
