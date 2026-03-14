/**
 * Example 21: Interaction Modes
 *
 * Demonstrates the interaction and autonomy modes available in reactive-agents.
 * The 5 conceptual modes are:
 * - fully-autonomous:  Agent acts without any human confirmation
 * - semi-autonomous:   Agent asks for confirmation before tool calls
 * - step-by-step:      Agent pauses after each step for human review
 * - supervised:        Human must approve each reasoning step
 * - fully-manual:      Human drives every action
 *
 * The `.withInteraction()` builder flag enables approval gate support via the
 * InteractionManager service. The `.withKillSwitch()` flag provides lifecycle
 * control (pause / resume / stop / terminate) usable as a checkpoint mechanism.
 *
 * This example runs entirely offline — no API key required.
 *
 * Usage:
 *   bun run apps/examples/src/interaction/21-interaction-modes.ts
 */
import { ReactiveAgents } from "reactive-agents";

export interface ExampleResult {
  passed: boolean;
  output: string;
  steps: number;
  tokens: number;
  durationMs: number;
}

export async function run(): Promise<ExampleResult> {
  const start = Date.now();
  console.log("\n=== Interaction Modes Example ===\n");
  console.log("Mode: OFFLINE (test provider)\n");

  // ─── Mode 1: Fully autonomous (default — no withInteraction() needed) ─────

  console.log("Mode 1: Fully autonomous (default behavior)\n");

  const autoAgent = await ReactiveAgents.create()
    .withName("autonomous-agent")
    .withTestScenario([{ text: "FINAL ANSWER: Task completed autonomously without human interaction." }])
    .build();

  const autoResult = await autoAgent.run("What is the sum of 5 + 3?");
  console.log(`  Result:  ${autoResult.output.slice(0, 70)}`);
  console.log(`  Success: ${autoResult.success}`);

  // ─── Mode 2: Interaction-aware (approval gates via withInteraction()) ──────

  console.log("\nMode 2: Interaction-aware agent (.withInteraction())\n");

  const interactionAgent = await ReactiveAgents.create()
    .withName("interaction-agent")
    .withTestScenario([{ text: "FINAL ANSWER: Task completed with interaction layer enabled." }])
    .withInteraction()
    .build();

  const interactionResult = await interactionAgent.run(
    "What is the product of 4 × 5?",
  );
  console.log(`  Result:  ${interactionResult.output.slice(0, 70)}`);
  console.log(`  Success: ${interactionResult.success}`);

  // ─── Mode 3: Supervised via kill switch checkpoints ───────────────────────

  console.log(
    "\nMode 3: Supervised agent (.withKillSwitch() for lifecycle control)\n",
  );

  const supervisedAgent = await ReactiveAgents.create()
    .withName("supervised-agent")
    .withTestScenario([{ text: "FINAL ANSWER: Task completed with supervision checkpoints active." }])
    .withKillSwitch()
    .build();

  const supervisedResult = await supervisedAgent.run(
    "What is 100 divided by 4?",
  );
  console.log(`  Result:  ${supervisedResult.output.slice(0, 70)}`);
  console.log(`  Success: ${supervisedResult.success}`);

  // ─── Mode 4: Full combination — interaction + kill switch + guardrails ─────

  console.log(
    "\nMode 4: Full supervision stack (interaction + kill switch + guardrails)\n",
  );

  const fullSupervisedAgent = await ReactiveAgents.create()
    .withName("full-supervised-agent")
    .withTestScenario([{ text: "FINAL ANSWER: Task completed under full supervision stack." }])
    .withInteraction()
    .withKillSwitch()
    .withGuardrails()
    .build();

  const fullResult = await fullSupervisedAgent.run(
    "Summarize the benefits of human-in-the-loop AI systems.",
  );
  console.log(`  Result:  ${fullResult.output.slice(0, 70)}`);
  console.log(`  Success: ${fullResult.success}`);

  // ─── Summary ──────────────────────────────────────────────────────────────

  const passed =
    autoResult.success &&
    interactionResult.success &&
    supervisedResult.success &&
    fullResult.success;

  const totalSteps =
    autoResult.metadata.stepsCount +
    interactionResult.metadata.stepsCount +
    supervisedResult.metadata.stepsCount +
    fullResult.metadata.stepsCount;

  console.log(`\nAll 4 modes ran successfully: ${passed}`);

  const output = [
    `autonomous: ${autoResult.success}`,
    `interaction: ${interactionResult.success}`,
    `supervised: ${supervisedResult.success}`,
    `full: ${fullResult.success}`,
  ].join(" | ");

  return {
    passed,
    output,
    steps: totalSteps,
    tokens: 0,
    durationMs: Date.now() - start,
  };
}

if (import.meta.main) {
  const r = await run();
  console.log(r.passed ? "\n✅ PASS" : "\n❌ FAIL", r.output);
  process.exit(r.passed ? 0 : 1);
}
