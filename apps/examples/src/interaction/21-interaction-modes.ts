/**
 * Example 21: Interaction Modes
 *
 * Demonstrates the interaction and autonomy modes available in reactive-agents.
 * The 5 conceptual modes (from `@reactive-agents/interaction`) are:
 * - autonomous:     Agent acts without any human confirmation
 * - supervised:     Agent pauses at milestone checkpoints for approval
 * - collaborative:  Agent and user work together in real time
 * - consultative:   Agent observes and suggests
 * - interrogative:  User drills into agent state / reasoning
 *
 * The interaction layer is used **directly** via the
 * `@reactive-agents/interaction` package: `createInteractionLayer()` provides
 * the `InteractionManager` service (mode switching, checkpoints,
 * notifications) as a composable Effect layer. The `.withKillSwitch()` builder
 * flag provides lifecycle control (pause / resume / stop / terminate) usable
 * as a checkpoint mechanism on the agent side.
 *
 * This example runs entirely offline — no API key required.
 *
 * Usage:
 *   bun run apps/examples/src/interaction/21-interaction-modes.ts
 */
import { ReactiveAgents } from "reactive-agents";
import {
  createInteractionLayer,
  InteractionManager,
} from "@reactive-agents/interaction";
import { EventBusLive } from "@reactive-agents/core";
import { Effect, Layer } from "effect";

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

  // ─── Mode 1: Fully autonomous (default — no interaction layer needed) ─────

  console.log("Mode 1: Fully autonomous (default behavior)\n");

  const autoAgent = await ReactiveAgents.create()
    .withName("autonomous-agent")
    .withTestScenario([{ text: "FINAL ANSWER: Task completed autonomously without human interaction." }])
    .build();

  const autoResult = await autoAgent.run("What is the sum of 5 + 3?");
  console.log(`  Result:  ${autoResult.output.slice(0, 70)}`);
  console.log(`  Success: ${autoResult.success}`);

  // ─── Mode 2: The interaction layer, used directly ─────────────────────────
  //
  // `createInteractionLayer()` from @reactive-agents/interaction provides the
  // InteractionManager service. It only requires an EventBus.

  console.log(
    "\nMode 2: Interaction layer (createInteractionLayer + InteractionManager)\n",
  );

  const InteractionLive = createInteractionLayer().pipe(
    Layer.provide(EventBusLive),
  );

  const interactionDemo = Effect.gen(function* () {
    const manager = yield* InteractionManager;

    // Every agent starts autonomous...
    const initialMode = yield* manager.getMode("interaction-agent");

    // ...and can be escalated to supervised (milestone checkpoints).
    yield* manager.switchMode("interaction-agent", "supervised");
    const currentMode = yield* manager.getMode("interaction-agent");

    // In supervised mode the agent pauses at milestones for human review.
    const checkpoint = yield* manager.createCheckpoint({
      agentId: "interaction-agent",
      taskId: "demo-task",
      milestoneName: "plan-review",
      description: "Review the computed plan before execution",
    });
    const resolved = yield* manager.resolveCheckpoint(
      checkpoint.id,
      "approved",
      "Plan looks good — proceed.",
    );

    return { initialMode, currentMode, checkpointStatus: resolved.status };
  });

  const interactionOutcome = await Effect.runPromise(
    interactionDemo.pipe(Effect.provide(InteractionLive)),
  );
  console.log(`  Initial mode:      ${interactionOutcome.initialMode}`);
  console.log(`  Switched to:       ${interactionOutcome.currentMode}`);
  console.log(`  Checkpoint status: ${interactionOutcome.checkpointStatus}`);
  const interactionPassed =
    interactionOutcome.initialMode === "autonomous" &&
    interactionOutcome.currentMode === "supervised" &&
    interactionOutcome.checkpointStatus === "approved";
  console.log(`  Success: ${interactionPassed}`);

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

  // ─── Mode 4: Full stack — interaction layer + kill switch + guardrails ────
  //
  // The interaction layer gates the run (pre-run checkpoint approval), while
  // the agent itself carries kill-switch lifecycle control and guardrails.

  console.log(
    "\nMode 4: Full supervision stack (interaction layer + kill switch + guardrails)\n",
  );

  const preRunGate = Effect.gen(function* () {
    const manager = yield* InteractionManager;
    const checkpoint = yield* manager.createCheckpoint({
      agentId: "full-supervised-agent",
      taskId: "summarize-hitl",
      milestoneName: "pre-run-review",
      description: "Approve the task before the agent starts",
    });
    const resolved = yield* manager.resolveCheckpoint(checkpoint.id, "approved");
    return resolved.status === "approved";
  });

  const approved = await Effect.runPromise(
    preRunGate.pipe(Effect.provide(InteractionLive)),
  );
  console.log(`  Pre-run checkpoint approved: ${approved}`);

  const fullSupervisedAgent = await ReactiveAgents.create()
    .withName("full-supervised-agent")
    .withTestScenario([{ text: "FINAL ANSWER: Task completed under full supervision stack." }])
    .withKillSwitch()
    .withGuardrails()
    .build();

  const fullResult = approved
    ? await fullSupervisedAgent.run(
        "Summarize the benefits of human-in-the-loop AI systems.",
      )
    : null;
  console.log(`  Result:  ${fullResult?.output.slice(0, 70) ?? "(not approved — skipped)"}`);
  console.log(`  Success: ${fullResult?.success ?? false}`);

  // ─── Summary ──────────────────────────────────────────────────────────────

  const passed =
    autoResult.success &&
    interactionPassed &&
    supervisedResult.success &&
    (fullResult?.success ?? false);

  const totalSteps =
    autoResult.metadata.stepsCount +
    supervisedResult.metadata.stepsCount +
    (fullResult?.metadata.stepsCount ?? 0);

  console.log(`\nAll 4 modes ran successfully: ${passed}`);

  const output = [
    `autonomous: ${autoResult.success}`,
    `interaction: ${interactionPassed}`,
    `supervised: ${supervisedResult.success}`,
    `full: ${fullResult?.success ?? false}`,
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
