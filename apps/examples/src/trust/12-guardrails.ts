/**
 * Example 12: Guardrails — Behavioral Contracts & Kill Switch
 *
 * Demonstrates two enforcement mechanisms:
 *
 * Part 1: Behavioral Contracts
 * - .withBehavioralContracts() enforces typed behavioral boundaries
 * - deniedTools: tools the agent is never allowed to call
 * - allowedTools: whitelist (if set, only these tools may be called)
 * - maxIterations: per-contract cap that cannot be overridden at runtime
 *
 * Part 2: Kill Switch
 * - .withKillSwitch() enables agent.pause(), agent.resume(), agent.stop(), agent.terminate()
 * - pause() blocks at the next phase boundary until resume() is called
 * - stop() gracefully completes the current phase then exits
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... bun run apps/examples/src/trust/12-guardrails.ts
 *   bun run apps/examples/src/trust/12-guardrails.ts  # test mode
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
  const provider = (opts?.provider ?? (process.env.ANTHROPIC_API_KEY ? "anthropic" : "test")) as PN;

  console.log("\n=== Guardrails Example ===");
  console.log(`Mode: ${provider !== "test" ? `LIVE (${provider})` : "TEST"}\n`);

  const mkBase = (name: string) => {
    let b = ReactiveAgents.create().withName(name).withProvider(provider);
    if (opts?.model) b = b.withModel(opts.model);
    return b;
  };

  // ─── Part 1: Behavioral contract — deny web-search tool ────────────────────

  console.log("Part 1: Behavioral contracts (deniedTools)");

  const contractAgent = await mkBase("contract-demo")
    .withTools()
    .withBehavioralContracts({
      deniedTools: ["web-search"],
      maxIterations: 4,
    })
    .withTestResponses({
      "": "FINAL ANSWER: I answered this from my training knowledge without using web-search (which is denied by my behavioral contract).",
    })
    .build();

  const contractResult = await contractAgent.run(
    "What is the capital of France? (Answer from knowledge, do not search the web.)"
  );

  console.log(`  Contract result: ${contractResult.output.slice(0, 80)}`);
  console.log(`  Success: ${contractResult.success}`);

  // ─── Part 2: Kill switch — pause + resume ──────────────────────────────────

  console.log("\nPart 2: Kill switch (pause + resume)");

  const ksAgent = await mkBase("killswitch-demo")
    .withKillSwitch()
    .withTestResponses({
      "": "FINAL ANSWER: Task completed after pause/resume cycle.",
    })
    .build();

  // Pause the agent, then resume after a short delay
  await ksAgent.pause();
  console.log("  Agent paused — will resume in 100ms...");
  setTimeout(() => {
    ksAgent.resume();
    console.log("  Agent resumed.");
  }, 100);

  const ksResult = await ksAgent.run("Complete this simple task: what is 2 + 2?");
  console.log(`  Kill switch result: ${ksResult.output.slice(0, 80)}`);
  console.log(`  Success: ${ksResult.success}`);

  // ─── Summary ───────────────────────────────────────────────────────────────

  const passed = contractResult.success && ksResult.success;
  const output = [
    `[contract] ${contractResult.output.slice(0, 60)}`,
    `[killswitch] ${ksResult.output.slice(0, 60)}`,
  ].join(" | ");

  return {
    passed,
    output,
    steps: contractResult.metadata.stepsCount + ksResult.metadata.stepsCount,
    tokens: contractResult.metadata.tokensUsed + ksResult.metadata.tokensUsed,
    durationMs: Date.now() - start,
  };
}

if (import.meta.main) {
  const r = await run();
  console.log(r.passed ? "\n✅ PASS" : "\n❌ FAIL", r.output.slice(0, 200));
  process.exit(r.passed ? 0 : 1);
}
