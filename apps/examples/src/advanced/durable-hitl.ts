/**
 * Example: Durable Human-in-the-Loop (approval gates that survive process death)
 *
 * A high-risk tool call (here: `delete-records`) is gated behind human approval.
 * When the agent tries to call it, the run PAUSES — the durable RunStore persists
 * `awaiting-approval` plus the pending action, and `runStream()` completes with a
 * `pendingApproval` descriptor. The process could exit here. A human then
 * approves or denies (from any process), and the run resumes from its checkpoint.
 *
 * LIVE mode drives the real gate with a frontier model. Offline (no key) the test
 * provider cannot be scripted to pause through the streaming gate, so the example
 * verifies the builder surface + policy wiring and explains the live flow.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... bun run apps/examples/src/advanced/durable-hitl.ts
 *   bun run apps/examples/src/advanced/durable-hitl.ts   # offline (config demo)
 */
import { Effect } from "effect";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReactiveAgents } from "reactive-agents";

export interface ExampleResult {
  passed: boolean;
  output: string;
  steps: number;
  tokens: number;
  durationMs: number;
}

type PN = "anthropic" | "openai" | "ollama" | "gemini" | "litellm" | "test";

/** A harmless stand-in for a destructive action — returns a marker, deletes nothing. */
const deleteRecordsTool = {
  definition: {
    name: "delete-records",
    description: "Permanently delete records matching a query. HIGH RISK.",
    parameters: [
      { name: "query", type: "string" as const, description: "Which records to delete", required: true },
    ],
    riskLevel: "high" as const,
    timeoutMs: 5_000,
    requiresApproval: true,
    source: "function" as const,
  },
  handler: (args: { query: string }) =>
    Effect.succeed(`DELETED records matching "${args.query}" (demo: nothing was really removed)`),
};

export async function run(opts?: { provider?: string; model?: string }): Promise<ExampleResult> {
  const start = Date.now();
  const provider = (opts?.provider ?? (process.env.ANTHROPIC_API_KEY ? "anthropic" : "test")) as PN;
  const live = provider !== "test";
  const dir = mkdtempSync(join(tmpdir(), "ra-hitl-example-"));

  console.log("\n=== Durable Human-in-the-Loop Example ===\n");
  console.log(`Mode: ${live ? `LIVE (${provider})` : "OFFLINE (config demo)"}\n`);

  const mkAgent = () => {
    let b = ReactiveAgents.create()
      .withName("ops-agent")
      .withProvider(provider)
      .withSystemPrompt(
        "You are an operations agent. To delete records you MUST call the delete-records tool.",
      )
      .withTools({ tools: [deleteRecordsTool] })
      .withReasoning()
      .withMaxIterations(6)
      .withDurableRuns({ dir, checkpointEvery: 1 })
      // Gate the destructive tool behind durable human approval.
      .withApprovalPolicy({ tools: ["delete-records"], mode: "detach" });
    if (opts?.model) b = b.withModel(opts.model);
    if (!live) {
      b = b.withTestScenario([
        { toolCall: { name: "delete-records", args: { query: "stale rows" } } },
        { text: "FINAL ANSWER: records deleted." },
      ]);
    }
    return b.build();
  };

  let passed = false;
  let output = "";
  let tokens = 0;

  try {
    if (live) {
      // 1. Run until the gate pauses the stream.
      const agent = await mkAgent();
      let pending: { runId: string; gateId: string; toolName: string; args: unknown } | undefined;
      console.log("Step 1 — running 'delete the stale customer records'…");
      for await (const ev of agent.runStream("Delete the stale customer records.")) {
        const e = ev as { _tag: string; pendingApproval?: typeof pending };
        if (e._tag === "StreamCompleted" && e.pendingApproval) pending = e.pendingApproval;
      }

      if (!pending) {
        // Model answered without calling the gated tool — still a valid run.
        output = "Run completed without requesting the gated tool (no approval needed).";
        console.log(`  ${output}`);
        passed = true;
      } else {
        console.log(`  ⏸  PAUSED awaiting approval: ${pending.toolName}(${JSON.stringify(pending.args)})`);
        console.log(`     runId=${pending.runId}\n`);

        // 2. A human (any process) lists what's waiting…
        const waiting = await agent.listPendingApprovals();
        console.log(`Step 2 — listPendingApprovals(): ${waiting.length} run(s) awaiting a decision`);

        // 3. …and approves. The run resumes and executes the gated call.
        console.log("Step 3 — approveRun()…");
        const resumed = await agent.approveRun(pending.runId);
        output = resumed.output;
        tokens = resumed.metadata.tokensUsed ?? 0;
        console.log(`  ✅ resumed & completed: ${output.slice(0, 100)}`);
        const after = await agent.listPendingApprovals();
        passed = after.length === 0;
      }
      await agent.dispose();

      // 4. Show the deny path on a fresh run.
      console.log("\nStep 4 — deny path on a second run…");
      const agent2 = await mkAgent();
      let pend2: { runId: string } | undefined;
      for await (const ev of agent2.runStream("Delete the stale customer records.")) {
        const e = ev as { _tag: string; pendingApproval?: { runId: string } };
        if (e._tag === "StreamCompleted" && e.pendingApproval) pend2 = e.pendingApproval;
      }
      if (pend2) {
        const denied = await agent2.denyRun(pend2.runId, "not authorized in production");
        console.log(`  🚫 denied & resumed: ${denied.output.slice(0, 100)}`);
      }
      await agent2.dispose();
    } else {
      // Offline: prove the policy wiring + the detach-requires-durable guard,
      // then explain that a live key triggers the real pause.
      const agent = await mkAgent();
      const r = await agent.run("Delete the stale customer records.");
      output = r.output;
      tokens = r.metadata.tokensUsed ?? 0;
      console.log(`  Built with .withApprovalPolicy({ tools: ['delete-records'], mode: 'detach' }).`);
      console.log(`  Offline run output: ${output.slice(0, 80)}`);
      console.log("  ▶ With a real provider key, calling delete-records PAUSES the run");
      console.log("    (status: awaiting-approval) until approveRun()/denyRun().");
      await agent.dispose();

      // Verify the build guard fires without durable runs.
      let guardFired = false;
      try {
        await ReactiveAgents.create()
          .withName("no-durable")
          .withProvider("test")
          .withReasoning()
          .withApprovalPolicy({ tools: ["delete-records"], mode: "detach" })
          .build();
      } catch {
        guardFired = true;
      }
      console.log(`  Guard: detach without .withDurableRuns() throws → ${guardFired ? "✓" : "✗"}`);
      passed = guardFired;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  return { passed, output, steps: 0, tokens, durationMs: Date.now() - start };
}

// Allow direct execution.
if (import.meta.main) {
  run().then((r) => {
    console.log(`\n${r.passed ? "✓ PASS" : "✗ FAIL"} — ${r.durationMs}ms\n`);
    process.exit(r.passed ? 0 : 1);
  });
}
