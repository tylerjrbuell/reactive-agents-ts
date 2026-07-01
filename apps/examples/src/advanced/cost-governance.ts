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
 *   - TEST (no key): under the deterministic test provider the reactive strategy
 *     exits on `end_turn` before the next before-think guard runs, so the
 *     token/stall guards can't fire deterministically (documented in
 *     killswitch-toggle.ts). `timeoutAfter` IS the canonical live-trigger witness
 *     under the test provider (a delayed scenario turn trips the wall-clock timer
 *     regardless of iteration count). We drive it to prove the governance stack
 *     terminates a run and surfaces the killswitch reason.
 *
 * In BOTH modes the demo asserts `success === false` and that the raw killswitch
 * reason reached `AgentCompleted.terminationReason`, then prints the measured
 * governance overhead (a bare-vs-governed A/B on the same deterministic scenario).
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... bun run apps/examples/src/advanced/cost-governance.ts
 *   bun run apps/examples/src/advanced/cost-governance.ts   # test mode (no key)
 */
import { ReactiveAgents } from "reactive-agents";
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

export async function run(opts?: { provider?: string; model?: string }): Promise<ExampleResult> {
  const start = Date.now();
  const provider = (opts?.provider ?? (process.env.ANTHROPIC_API_KEY ? "anthropic" : "test")) as PN;
  const live = provider !== "test";

  // Wall-clock cap is the DETERMINISTIC witness under the test provider (tiny,
  // trips on a delayed scenario turn). In LIVE mode we widen it so budgetLimit —
  // the primary cost governor — wins the race and caps the run on real token spend.
  const WALL_CLOCK = live ? "60s" : "10ms";

  console.log("\n=== Cost Governance — budget + watchdog + approval + timeout on ONE agent ===\n");
  console.log(`Mode: ${live ? `LIVE (${provider})` : "TEST (deterministic)"}\n`);

  // ─── Build ONE agent composing all four cost/governance killswitches ───
  //
  // In LIVE mode we lean on budgetLimit as the primary cost governor; the small
  // token cap trips once real usage accumulates. In TEST mode budget/watchdog
  // can't fire deterministically (reactive strategy exits before the next
  // guard), so timeoutAfter is the deterministic witness — its wall-clock cap
  // is tiny and a delayed scenario turn trips it.
  const mkGoverned = (name: string) => {
    let b = ReactiveAgents.create()
      .withName(name)
      .withProvider(provider)
      .withReasoning()
      .withMinIterations(2)
      // ── Compose the cost/governance killswitches (all real, all on one agent) ──
      .withHarness(budgetLimit({ maxTokens: TOKEN_BUDGET, onTrigger: "stop" }))
      .withHarness(watchdog({ noProgressFor: NO_PROGRESS_FOR, onTrigger: "stop" }))
      .withHarness(
        requireApprovalFor({
          tools: [...GATED_TOOLS],
          approver: () => false, // deny every gated tool call
          onDeny: "stop",
        }),
      )
      .withHarness(timeoutAfter({ wallClock: WALL_CLOCK, onTrigger: "stop" }));
    // Live runs need real tools so multi-step work accumulates tokens and trips
    // budgetLimit. Under the test provider, tools + approval short-circuit the
    // reactive strategy to a final answer before the timeout witness can fire,
    // so we omit them and let timeoutAfter be the deterministic witness.
    if (live) b = b.withTools();
    // Small model for live runs (cheap; cost governance is the point).
    const model = opts?.model ?? (live ? "claude-haiku-4-5" : undefined);
    if (model) b = b.withModel(model);
    if (!live) {
      // Delayed turns so the wall-clock timeout witness trips deterministically.
      b = b.withTestScenario([
        { text: "Working on it… step 1", delayMs: 50 },
        { text: "step 2", delayMs: 50 },
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
  const budgetSignals: { tokensUsed: number; costUsd: number; status: string; reason?: string }[] = [];
  const unsubCompleted = await agent.subscribe("AgentCompleted", (e) => {
    terminationReason = e.terminationReason ?? "";
  });
  // Budget signals (if the trace surface emits them) let us print used-vs-cap.
  let unsubBudget: (() => void) | undefined;
  try {
    unsubBudget = await agent.subscribe(
      "BudgetSignalCollected" as never,
      (e: unknown) => {
        const ev = e as { tokensUsed?: number; costUsd?: number; status?: string; reason?: string };
        budgetSignals.push({
          tokensUsed: ev.tokensUsed ?? 0,
          costUsd: ev.costUsd ?? 0,
          status: ev.status ?? "ok",
          reason: ev.reason,
        });
      },
    );
  } catch {
    // Event name not exposed on this build's typed subscribe surface — fine.
  }

  const result = await agent.run(task);
  unsubCompleted();
  unsubBudget?.();
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
    console.log(`  budget signal:      status=${last.status} tokens=${last.tokensUsed}${last.reason ? ` reason=${last.reason}` : ""}`);
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
