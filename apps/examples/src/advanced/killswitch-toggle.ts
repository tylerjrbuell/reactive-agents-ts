/**
 * Example: Compose Killswitch Toggle Witness
 *
 * Pins all 5 compose killswitches end-to-end under the test provider:
 *
 *   - budgetLimit         — abort when state.tokens >= maxTokens
 *   - timeoutAfter        — abort when wall-clock budget exceeded
 *   - maxIterations       — abort when ctx.iteration >= max
 *   - requireApprovalFor  — abort when a denied tool is about to fire
 *   - watchdog            — abort on stalled progress
 *     (NOTE: watchdog needs real inter-iteration delay to assert
 *     deterministically; covered by wiring assertion + unit tests rather
 *     than live trigger here.)
 *
 * Each killswitch runs in its OWN agent build (isolated harness composition)
 * so a stuck-on side effect from one killswitch cannot mask another. The
 * witness asserts the agent's termination metadata contains the killswitch's
 * `reason:` prefix.
 *
 * History: May 19 2026 honesty sweep flagged 3/6 killswitches as shipped
 * dead — tests used wrong state shapes and false-passed. Fixes landed at
 * that time; this example is the executable regression net.
 *
 * **Known propagation gap (2026-05-24 — xfail):** the kernel-side
 * killswitch.reason preservation shipped (state.meta.terminatedBy is set
 * by 4 abort sites in runner.ts + act.ts), but `react-kernel.ts:152` and
 * `reactive.ts:256` narrow `state.meta.terminatedBy` to the closed
 * TerminatedBy 5-value enum before building the reasoning result.
 * Killswitch reasons like "budget-limit:tokens:1/0" become "max_iterations"
 * or "final_answer" via the fallback branch. The dynamic reason is
 * unobservable from result.metadata.terminatedBy until the propagation
 * chain preserves raw kernel meta through to AgentCompleted.terminationReason
 * (event schema already extended for this; consumer-side TaskResult
 * needs a parallel rawTerminatedBy field). This example asserts the
 * happy path that does NOT hold today — flip from xfail to passing once
 * the chain ships.
 */

import { ReactiveAgents } from "reactive-agents";
import { killswitches } from "@reactive-agents/compose";
import {
  budgetLimit,
  timeoutAfter,
  maxIterations,
  requireApprovalFor,
  watchdog,
} from "@reactive-agents/compose";

export interface ExampleResult {
  passed: boolean;
  output: string;
  steps: number;
  tokens: number;
  durationMs: number;
}

interface KillswitchResult {
  name: string;
  triggered: boolean;
  reason?: string;
  note?: string;
}

async function runKillswitch(
  name: string,
  configure: (b: ReturnType<typeof ReactiveAgents.create>) => ReturnType<typeof ReactiveAgents.create>,
  expectedReasonPrefix: string,
  task: string = "Run the task",
): Promise<KillswitchResult> {
  let b = ReactiveAgents.create()
    .withName(`ks-${name}`)
    .withProvider("test")
    .withReasoning()
    .withTestScenario([
      { text: "thinking..." },
      { text: "still thinking..." },
      { text: "FINAL ANSWER: done." },
    ]);
  b = configure(b);
  const agent = await b.withMaxIterations(5).build();
  const result = await agent.run(task);
  await agent.dispose();

  // The killswitch's reason ends up in result.metadata.terminatedBy
  // (kernel routes the abort through terminate() with the reason).
  const terminatedBy = (result.metadata as { terminatedBy?: string }).terminatedBy ?? "";
  const triggered = terminatedBy.includes(expectedReasonPrefix);
  return {
    name,
    triggered,
    reason: terminatedBy || undefined,
  };
}

export async function run(): Promise<ExampleResult> {
  const start = Date.now();
  console.log("\n=== Compose Killswitches — Toggle Witness ===\n");

  const declared = killswitches.list();
  console.log(`  registry declares ${declared.length} killswitches: [${declared.join(", ")}]`);

  const results: KillswitchResult[] = [];

  // 1. maxIterations — most deterministic; aborts on iteration >= max
  results.push(
    await runKillswitch(
      "maxIterations",
      (b) => b.withHarness(maxIterations({ max: 1, onTrigger: "stop" })),
      "max-iterations",
    ),
  );

  // 2. budgetLimit — aborts when state.tokens exceeds budget
  results.push(
    await runKillswitch(
      "budgetLimit",
      (b) => b.withHarness(budgetLimit({ maxTokens: 1, onTrigger: "stop" })),
      "budget-limit",
    ),
  );

  // 3. timeoutAfter — aborts when wall-clock exceeded
  // Hard to assert deterministically without delayMs; use a microscopic
  // budget and a delayed scenario.
  {
    let b = ReactiveAgents.create()
      .withName("ks-timeoutAfter")
      .withProvider("test")
      .withReasoning()
      .withTestScenario([
        { text: "step 1", delayMs: 50 },
        { text: "FINAL ANSWER: done." },
      ])
      .withHarness(timeoutAfter({ wallClock: "10ms", onTrigger: "stop" }));
    const agent = await b.withMaxIterations(5).build();
    const result = await agent.run("Run.");
    await agent.dispose();
    const terminatedBy = (result.metadata as { terminatedBy?: string }).terminatedBy ?? "";
    const triggered = terminatedBy.includes("timeout-after");
    results.push({ name: "timeoutAfter", triggered, reason: terminatedBy || undefined });
  }

  // 4. requireApprovalFor — aborts when an unauthorized tool fires
  // Scenario: agent emits a tool_call for "denied-tool"; approver denies.
  {
    let b = ReactiveAgents.create()
      .withName("ks-requireApprovalFor")
      .withProvider("test")
      .withReasoning()
      .withTools()
      .withTestScenario([
        { toolCall: { name: "file-write", args: { path: "/tmp/x", content: "y" } } },
        { text: "FINAL ANSWER: done." },
      ])
      .withHarness(
        requireApprovalFor({
          tools: ["file-write"],
          approver: () => false, // always deny
          onDeny: "stop",
        }),
      );
    const agent = await b.withMaxIterations(5).build();
    const result = await agent.run("write file");
    await agent.dispose();
    const terminatedBy = (result.metadata as { terminatedBy?: string }).terminatedBy ?? "";
    const triggered = terminatedBy.includes("require-approval-for");
    results.push({ name: "requireApprovalFor", triggered, reason: terminatedBy || undefined });
  }

  // 5. watchdog — wiring assertion only.
  // Watchdog measures inter-iteration delay; deterministic trigger
  // requires the agent to stall, which is hard to engineer under the test
  // provider. Verify the composition compiles + agent builds + runs without
  // throwing. Full live trigger covered by watchdog unit tests in compose.
  {
    let b = ReactiveAgents.create()
      .withName("ks-watchdog-wiring")
      .withProvider("test")
      .withReasoning()
      .withTestScenario([{ text: "FINAL ANSWER: ok" }])
      .withHarness(watchdog({ noProgressFor: "5m", onTrigger: "stop" }));
    const agent = await b.withMaxIterations(2).build();
    const result = await agent.run("ok");
    await agent.dispose();
    const builtOk = result.success;
    results.push({
      name: "watchdog",
      triggered: builtOk, // wiring witness only
      note: "wiring assertion only; live trigger requires stall scenario",
    });
  }

  // Report
  console.log("\n  killswitch                 triggered  reason / note");
  console.log("  ────────────────────────────────────────────────────────");
  for (const r of results) {
    const icon = r.triggered ? "✓" : "✗";
    const tail = r.reason ?? r.note ?? "";
    console.log(`  ${r.name.padEnd(24)} ${icon}          ${tail.slice(0, 60)}`);
  }

  const allHit = results.every((r) => r.triggered);
  const triggeredLive = results.filter((r) => r.triggered && !r.note).length;

  const passed = allHit && declared.length === results.length;
  return {
    passed,
    output: passed
      ? `${declared.length}/${declared.length} killswitches witnessed (${triggeredLive} live-triggered, ${results.length - triggeredLive} wiring-asserted). Reasons captured in terminatedBy.`
      : `killswitch witness FAILED — declared=${declared.length} runs=${results.length} hit=${results.filter((r) => r.triggered).length}`,
    steps: 0,
    tokens: 0,
    durationMs: Date.now() - start,
  };
}

if (import.meta.main) {
  const r = await run();
  console.log(r.passed ? "\n✅ PASS" : "\n❌ FAIL", r.output);
  process.exit(r.passed ? 0 : 1);
}
