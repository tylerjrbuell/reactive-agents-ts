/**
 * Example: Cost Governance — budget + watchdog + approval + timeout on ONE agent
 *
 * Composes the framework's cost/governance killswitches together on a single
 * agent and shows the stack terminating a run that would otherwise burn budget:
 *
 *   - budgetLimit({ maxTokens })       — abort when cumulative tokens exceed the cap
 *   - watchdog({ noProgressFor })      — abort on a stalled run (no forward progress)
 *   - requireApprovalFor({ tools })    — abort when an unapproved tool is about to fire
 *   - timeoutAfter({ wallClock })      — abort when the wall-clock budget is exceeded
 *
 * All four are composed with `.withHarness(...)` (the alias `.compose(...)`
 * registers the same way). Each is a real @reactive-agents/compose killswitch;
 * none are invented.
 *
 * Which killswitch is the DETERMINISTIC witness depends on the provider:
 *
 *   - LIVE (anthropic): `budgetLimit` fires — real token accumulation across
 *     iterations trips the before-think guard once state.tokens ≥ maxTokens.
 *     Termination reason surfaces as `budget-limit:tokens:<used>/<cap>`.
 *
 *   - TEST (no key): the scripted model makes slow tool calls (a harmless
 *     `do-step` tool, 50ms per turn). The test provider reports few tokens, so
 *     `timeoutAfter` is the deterministic witness: the 10ms wall-clock cap trips
 *     at the next before-think guard.
 *
 * The cost caps use `onTrigger: "terminate"`, which ends the run as failed.
 * (`"stop"`, the default, ends it gracefully and keeps `success: true`.)
 *
 * In BOTH modes the demo asserts `success === false` and that the raw killswitch
 * reason reached `AgentCompleted.terminationReason`, then prints the measured
 * governance overhead (a bare-vs-governed A/B on the same deterministic scenario).
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... bun run apps/examples/src/advanced/cost-governance.ts
 *   bun run apps/examples/src/advanced/cost-governance.ts   # test mode (no key)
 */
import { Schema } from "effect";
import { ReactiveAgents, defineTool } from "reactive-agents";
import {
  budgetLimit,
  watchdog,
  requireApprovalFor,
  timeoutAfter,
} from "@reactive-agents/compose";

export interface ExampleResult {
  passed: boolean;
  output: string;
  steps: number;
  tokens: number;
  durationMs: number;
}

type PN = "anthropic" | "openai" | "ollama" | "gemini" | "litellm" | "test";

/** Governance caps applied to the agent. Small on purpose so the stack fires. */
const TOKEN_BUDGET = 400;
const NO_PROGRESS_FOR = "5m";
const GATED_TOOLS = ["file-write"] as const;

/** Harmless tool the scripted test model calls, so the run takes several turns. */
const doStepTool = defineTool({
  name: "do-step",
  description: "Do one step of the task and report it.",
  input: Schema.Struct({ n: Schema.Number }),
  handler: async (args) => `step ${args.n} done`,
});

export async function run(opts?: { provider?: string; model?: string }): Promise<ExampleResult> {
  const start = Date.now();
  const provider = (opts?.provider ?? (process.env.ANTHROPIC_API_KEY ? "anthropic" : "test")) as PN;
  const live = provider !== "test";

  // Wall-clock cap is the DETERMINISTIC witness under the test provider (tiny,
  // trips after the first slow tool turn). In LIVE mode we widen it so
  // budgetLimit, the primary cost governor, wins the race on real token spend.
  const WALL_CLOCK = live ? "60s" : "10ms";

  console.log("\n=== Cost Governance — budget + watchdog + approval + timeout on ONE agent ===\n");
  console.log(`Mode: ${live ? `LIVE (${provider})` : "TEST (deterministic)"}\n`);

  // ─── Build ONE agent composing all four cost/governance killswitches ───
  const mkGoverned = (name: string) => {
    let b = ReactiveAgents.create()
      .withName(name)
      .withProvider(provider)
      .withReasoning()
      // ── Compose the cost/governance killswitches (all real, all on one agent) ──
      // "terminate" fails the run when a cap is crossed; "stop" would end it
      // gracefully with success kept.
      .withHarness(budgetLimit({ maxTokens: TOKEN_BUDGET, onTrigger: "terminate" }))
      .withHarness(watchdog({ noProgressFor: NO_PROGRESS_FOR, onTrigger: "terminate" }))
      .withHarness(
        requireApprovalFor({
          tools: [...GATED_TOOLS],
          approver: () => false, // deny every gated tool call
          onDeny: "terminate",
        }),
      )
      .withHarness(timeoutAfter({ wallClock: WALL_CLOCK, onTrigger: "terminate" }));
    // Live: real built-in tools, so multi-step work accumulates tokens and
    // trips budgetLimit. Test: one harmless scripted tool, so the run takes
    // several slow turns and the before-think guards get to run.
    b = live ? b.withTools({ builtins: true }) : b.withTools({ tools: [doStepTool] });
    // Small model for live runs (cheap; cost governance is the point).
    const model = opts?.model ?? (live ? "claude-haiku-4-5" : undefined);
    if (model) b = b.withModel(model);
    if (!live) {
      // Slow tool turns: the 10ms wall-clock cap is crossed after the first one.
      b = b.withTestScenario([
        { toolCall: { name: "do-step", args: { n: 1 } }, delayMs: 50 },
        { toolCall: { name: "do-step", args: { n: 2 } }, delayMs: 50 },
        { text: "FINAL ANSWER: done." },
      ]);
    }
    return b.withMaxIterations(6).build();
  };

  const task = live
    ? "List several prime numbers, explain each in detail, then compute their product step by step."
    : "Do the multi-step task.";

  // ─── Run the governed agent; capture the killswitch that terminated it ───
  const agent = await mkGoverned("cost-governed");

  let terminationReason = "";
  const budgetSignals: { budgetType: string; limit: number; used: number }[] = [];
  const unsubCompleted = await agent.subscribe("AgentCompleted", (e) => {
    terminationReason = e.terminationReason ?? "";
  });
  // budgetLimit() publishes BudgetExhausted with the real figures when it fires.
  const unsubBudget = await agent.subscribe("BudgetExhausted", (e) => {
    budgetSignals.push({ budgetType: e.budgetType, limit: e.limit, used: e.used });
  });

  const result = await agent.run(task);
  unsubCompleted();
  unsubBudget();
  await agent.dispose();

  const tokens = result.metadata.tokensUsed ?? 0;
  const cost = result.metadata.cost ?? 0;
  const steps = result.metadata.stepsCount ?? 0;

  // Which killswitch fired?
  const firedBudget = terminationReason.startsWith("budget-limit");
  const firedTimeout = terminationReason.startsWith("timeout-after");
  const firedWatchdog = terminationReason.startsWith("watchdog");
  const firedApproval = terminationReason.startsWith("require-approval-for");
  const governed = firedBudget || firedTimeout || firedWatchdog || firedApproval;

  // ─── Governance summary ───
  console.log("─── Governed run ───");
  console.log(`  success:            ${result.success}`);
  console.log(`  terminated by:      ${terminationReason || "(no killswitch — completed)"}`);
  console.log(`  killswitch fired:   ${
    firedBudget
      ? "budgetLimit (cost cap)"
      : firedTimeout
        ? "timeoutAfter (wall-clock cap)"
        : firedWatchdog
          ? "watchdog (stall)"
          : firedApproval
            ? "requireApprovalFor (approval)"
            : "none"
  }`);
  console.log(`  tokens used / cap:  ${tokens} / ${TOKEN_BUDGET}`);
  console.log(`  cost:               $${cost.toFixed(6)}`);
  console.log(`  steps:              ${steps}`);
  console.log(`  wall-clock cap:     ${WALL_CLOCK}`);
  if (budgetSignals.length > 0) {
    const last = budgetSignals[budgetSignals.length - 1];
    console.log(`  budget exhausted:   ${last.budgetType} used=${last.used} limit=${last.limit}`);
  }

  // ─── Measured governance overhead (bare vs governed, same scenario) ───
  // The A/B is deterministic under the test provider (canned scenario). In LIVE
  // mode the numbers are indicative only (LLM latency dominates and varies), so
  // we run the overhead A/B under the test provider regardless of mode.
  console.log("\n─── Governance overhead (framework's own cost) ───");
  const overhead = await measureOverhead();
  console.log(`  bare agent (no killswitches):     ${overhead.bareMs}ms`);
  console.log(`  governed agent (4 killswitches):  ${overhead.governedMs}ms`);
  console.log(`  governance overhead:              ${overhead.deltaMs}ms (${overhead.pct})`);

  // ─── Verdict ───
  // Requirement: a cost/governance killswitch terminated the run (success=false)
  // AND the raw killswitch reason surfaced through AgentCompleted.terminationReason.
  const passed = result.success === false && governed;
  const output = passed
    ? `governed: ${terminationReason} (tokens=${tokens}/${TOKEN_BUDGET}, overhead=${overhead.deltaMs}ms) — ${
        firedBudget ? "budget killswitch capped the run" : "timeout killswitch capped the run"
      }`
    : `governance did NOT terminate the run: success=${result.success} reason="${terminationReason}"`;

  return {
    passed,
    output,
    steps,
    tokens,
    durationMs: Date.now() - start,
  };
}

/**
 * Measure the framework's own governance overhead: same deterministic scenario,
 * bare agent vs an agent carrying all four killswitches. Timeout cap is set
 * large here so BOTH runs complete (we're measuring the composition cost, not a
 * trigger). Runs under the test provider for determinism.
 */
async function measureOverhead(): Promise<{ bareMs: number; governedMs: number; deltaMs: number; pct: string }> {
  const scenario = [{ text: "FINAL ANSWER: overhead probe done." }];
  const TRIALS = 5;

  const mkBare = () =>
    ReactiveAgents.create()
      .withName("overhead-bare")
      .withProvider("test")
      .withReasoning()
      .withTestScenario(scenario)
      .withMaxIterations(3)
      .build();

  const mkGoverned = () =>
    ReactiveAgents.create()
      .withName("overhead-governed")
      .withProvider("test")
      .withReasoning()
      .withHarness(budgetLimit({ maxTokens: 1_000_000, onTrigger: "stop" }))
      .withHarness(watchdog({ noProgressFor: "1h", onTrigger: "stop" }))
      .withHarness(requireApprovalFor({ tools: ["file-write"], approver: () => true, onDeny: "stop" }))
      .withHarness(timeoutAfter({ wallClock: "60s", onTrigger: "stop" }))
      .withTestScenario(scenario)
      .withMaxIterations(3)
      .build();

  const timeAvg = async (make: () => Promise<Awaited<ReturnType<typeof mkBare>>>): Promise<number> => {
    let total = 0;
    for (let i = 0; i < TRIALS; i++) {
      const agent = await make();
      const t = Date.now();
      await agent.run("probe");
      total += Date.now() - t;
      await agent.dispose();
    }
    return total / TRIALS;
  };

  const bareMs = Math.round(await timeAvg(mkBare));
  const governedMs = Math.round(await timeAvg(mkGoverned));
  const deltaMs = Math.max(0, governedMs - bareMs);
  const pct = bareMs > 0 ? `${((deltaMs / bareMs) * 100).toFixed(1)}%` : "n/a";
  return { bareMs, governedMs, deltaMs, pct };
}

// Allow direct execution.
if (import.meta.main) {
  run().then((r) => {
    console.log(`\n${r.passed ? "✅ PASS" : "❌ FAIL"} — ${r.output}`);
    console.log(`(${r.durationMs}ms)\n`);
    process.exit(r.passed ? 0 : 1);
  });
}
