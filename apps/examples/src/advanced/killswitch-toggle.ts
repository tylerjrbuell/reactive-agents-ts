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
 * `result.terminatedBy` is the closed TerminatedBy enum, so a dynamic
 * killswitch reason like "budget-limit:tokens:109/1" is read from
 * `AgentCompleted.terminationReason`, which carries the raw kernel reason.
 */

import { Schema } from "effect";
import { ReactiveAgents, defineTool } from "reactive-agents";
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

/** Harmless tool the scripted test model calls, so each run takes several turns. */
const doStepTool = defineTool({
  name: "do-step",
  description: "Do one step of the task and report it.",
  input: Schema.Struct({ n: Schema.Number }),
  handler: async (args) => `step ${args.n} done`,
});

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
  // Scenario with tool calls forces the kernel to continue past iter 0
  // (a text-only turn ends the run; a tool turn needs another iteration to
  // process the result), so the before-think guards get to run.
  let b = ReactiveAgents.create()
    .withName(`ks-${name}`)
    .withProvider("test")
    .withReasoning()
    .withTools({ tools: [doStepTool] })
    .withTestScenario([
      { toolCall: { name: "do-step", args: { n: 1 } } },
      { toolCall: { name: "do-step", args: { n: 2 } } },
      { text: "FINAL ANSWER: done." },
    ]);
  b = configure(b);
  const agent = await b.withMaxIterations(5).build();

  // Subscribe to AgentCompleted BEFORE running so the typed
  // terminationReason field is captured. result.metadata.terminatedBy is
  // normalized to the closed TerminatedBy 5-value enum; AgentCompleted
  // .terminationReason carries the raw kernel reason (dynamic killswitch
  // strings).
  let capturedReason = "";
  const unsub = await agent.subscribe("AgentCompleted", (event) => {
    capturedReason = event.terminationReason ?? "";
  });

  await agent.run(task);
  unsub();
  await agent.dispose();

  const triggered = capturedReason.includes(expectedReasonPrefix);
  return {
    name,
    triggered,
    reason: capturedReason || undefined,
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
  // A microscopic budget and a slow tool turn: the cap is crossed before the
  // second think.
  {
    let b = ReactiveAgents.create()
      .withName("ks-timeoutAfter")
      .withProvider("test")
      .withReasoning()
      .withTools({ tools: [doStepTool] })
      .withTestScenario([
        { toolCall: { name: "do-step", args: { n: 1 } }, delayMs: 50 },
        { text: "FINAL ANSWER: done." },
      ])
      .withHarness(timeoutAfter({ wallClock: "10ms", onTrigger: "stop" }));
    const agent = await b.withMaxIterations(5).build();
    let captured = "";
    const unsub = await agent.subscribe("AgentCompleted", (event) => {
      captured = event.terminationReason ?? "";
    });
    await agent.run("Run.");
    unsub();
    await agent.dispose();
    const triggered = captured.includes("timeout-after");
    results.push({ name: "timeoutAfter", triggered, reason: captured || undefined });
  }

  // 4. requireApprovalFor — aborts when an unauthorized tool fires
  // Scenario: agent emits a tool_call for "denied-tool"; approver denies.
  {
    let b = ReactiveAgents.create()
      .withName("ks-requireApprovalFor")
      .withProvider("test")
      .withReasoning()
      .withTools({ builtins: ["file-write"] })
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
    let captured = "";
    const unsub = await agent.subscribe("AgentCompleted", (event) => {
      captured = event.terminationReason ?? "";
    });
    await agent.run("write file");
    unsub();
    await agent.dispose();
    const triggered = captured.includes("require-approval-for");
    results.push({ name: "requireApprovalFor", triggered, reason: captured || undefined });
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

  // Pass criterion: (a) all 5 registry-declared killswitches were attempted
  // (no missing surfaces), AND (b) every killswitch except watchdog fired
  // live with its raw dynamic reason surfacing through to
  // AgentCompleted.terminationReason (proves the full kernel → reasoning
  // result → engine ctx → AgentCompleted chain for each one). Watchdog is
  // wiring-asserted only (a stall scenario is hard under the test provider).
  const allDeclaredCovered = declared.length === results.length;
  const liveTriggers = results.filter((r) => r.triggered && !r.note);
  const liveExpected = results.filter((r) => !r.note).length;
  const allLiveTriggered = liveTriggers.length === liveExpected;

  const passed = allDeclaredCovered && allLiveTriggered;
  return {
    passed,
    output: passed
      ? `${declared.length}/${declared.length} killswitches covered; ${liveTriggers.length} live-triggered (raw kernel reason surfaced via AgentCompleted.terminationReason): ${liveTriggers.map((r) => r.name).join(", ")}.`
      : `killswitch witness FAILED — declared=${declared.length} runs=${results.length} live=${liveTriggers.length}`,
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
