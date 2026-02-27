/**
 * Example 15: Prompt A/B Experiment Framework
 *
 * Demonstrates the ExperimentService for structured prompt variant testing.
 * Experiments track which prompt variant is served to each user and record
 * success/failure outcomes for statistical analysis.
 *
 * The ExperimentService provides:
 * - createExperiment(): define variants with split ratios
 * - assignVariant(): deterministic sticky assignment per user
 * - recordOutcome(): track success/failure with optional scores
 * - getExperimentResults(): aggregate stats with winner detection
 *
 * This example runs entirely offline — no LLM needed.
 *
 * Usage:
 *   bun run apps/examples/src/advanced/15-prompt-experiments.ts
 */
import { Effect } from "effect";
import {
  ExperimentService,
  ExperimentServiceLive,
} from "@reactive-agents/prompts";

export interface ExampleResult {
  passed: boolean;
  output: string;
  steps: number;
  tokens: number;
  durationMs: number;
}

export async function run(): Promise<ExampleResult> {
  const start = Date.now();
  console.log("\n=== Prompt A/B Experiments Example ===\n");

  // ─── Define the Effect-based program ──────────────────────────────────────

  const program = Effect.gen(function* () {
    const svc = yield* ExperimentService;

    // ── Step 1: Create an experiment with two prompt variants ──────────────
    console.log("Step 1: Creating experiment 'welcome-prompt'");
    const exp = yield* svc.createExperiment(
      "welcome-prompt",
      { "variant-a": 1, "variant-b": 2 }, // variant → template version
      { "variant-a": 0.5, "variant-b": 0.5 }, // 50/50 split
    );
    console.log(`  Experiment ID: ${exp.id}, status: ${exp.status}`);

    // ── Step 2: Assign 20 users deterministically ──────────────────────────
    console.log("\nStep 2: Assigning 20 users to variants");
    const assignments: Record<string, number> = { "variant-a": 0, "variant-b": 0 };
    for (let i = 0; i < 20; i++) {
      const result = yield* svc.assignVariant(exp.id, `user-${i}`);
      if (result) {
        assignments[result.variant] = (assignments[result.variant] ?? 0) + 1;
      }
    }
    console.log(`  variant-a: ${assignments["variant-a"]} assignments`);
    console.log(`  variant-b: ${assignments["variant-b"]} assignments`);

    // ── Step 3: Re-assign same users — should be sticky ────────────────────
    console.log("\nStep 3: Verifying sticky assignment (same user = same variant)");
    const stickyChecks: boolean[] = [];
    for (let i = 0; i < 5; i++) {
      const first = yield* svc.assignVariant(exp.id, `user-${i}`);
      const second = yield* svc.assignVariant(exp.id, `user-${i}`);
      stickyChecks.push(first?.variant === second?.variant);
    }
    const allSticky = stickyChecks.every(Boolean);
    console.log(`  All 5 sticky checks passed: ${allSticky}`);

    // ── Step 4: Record outcomes ────────────────────────────────────────────
    console.log("\nStep 4: Recording outcomes");
    // Variant B has higher success rate in this simulated run
    for (let i = 0; i < 10; i++) {
      const assignment = yield* svc.assignVariant(exp.id, `user-${i}`);
      if (assignment) {
        const isB = assignment.variant === "variant-b";
        yield* svc.recordOutcome(exp.id, assignment.variant, `user-${i}`, {
          success: isB ? Math.random() > 0.2 : Math.random() > 0.5,
          score: isB ? 0.8 + Math.random() * 0.2 : 0.4 + Math.random() * 0.4,
        });
      }
    }
    console.log("  10 outcomes recorded");

    // ── Step 5: Get results ────────────────────────────────────────────────
    console.log("\nStep 5: Fetching aggregated experiment results");
    const results = yield* svc.getExperimentResults(exp.id);
    if (results) {
      console.log(`  Total assignments: ${results.totalAssignments}`);
      console.log(`  Total outcomes: ${results.totalOutcomes}`);
      for (const [name, stats] of Object.entries(results.variants)) {
        console.log(`  [${name}] assignments=${stats.assignments}, outcomes=${stats.outcomes}, successRate=${stats.successRate.toFixed(2)}`);
      }
      if (results.winner) {
        console.log(`  Winner: ${results.winner}`);
      }
    }

    // ── Step 6: List experiments ───────────────────────────────────────────
    const allExps = yield* svc.listExperiments("welcome-prompt");
    console.log(`\nStep 6: Listed ${allExps.length} experiment(s) for 'welcome-prompt'`);

    return {
      assignments,
      allSticky,
      results,
      experimentCount: allExps.length,
    };
  });

  // ─── Run with ExperimentServiceLive ───────────────────────────────────────

  const result = await Effect.runPromise(
    program.pipe(Effect.provide(ExperimentServiceLive)),
  );

  const bothAssigned =
    (result.assignments["variant-a"] ?? 0) > 0 &&
    (result.assignments["variant-b"] ?? 0) > 0;
  const passed = bothAssigned && result.allSticky && result.experimentCount === 1;

  const output = [
    `variant-a: ${result.assignments["variant-a"]}`,
    `variant-b: ${result.assignments["variant-b"]}`,
    `sticky: ${result.allSticky}`,
    `outcomes: ${result.results?.totalOutcomes ?? 0}`,
  ].join(", ");

  return { passed, output, steps: 6, tokens: 0, durationMs: Date.now() - start };
}

if (import.meta.main) {
  const r = await run();
  console.log(r.passed ? "\n✅ PASS" : "\n❌ FAIL", r.output.slice(0, 200));
  process.exit(r.passed ? 0 : 1);
}
