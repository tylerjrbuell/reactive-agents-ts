/**
 * Example: Durable Human-in-the-Loop (approval gates that survive process death)
 *
 * A high-risk tool call (here: `delete-records`) is gated behind human approval.
 * When the agent tries to call it, the run PAUSES: the durable RunStore persists
 * `awaiting-approval` plus the pending action, and `run()` returns with a
 * `pendingApproval` descriptor. The process could exit here. A human then
 * approves or denies (from any process), and the run resumes from its checkpoint.
 *
 * Offline (no key) the test provider scripts the gated call, so the same pause,
 * approve and deny flow runs end to end with no model. With a key, a real model
 * decides whether to call the tool.
 *
 * Without `.withDurableRuns()`, `mode: "detach"` still works: the run waits
 * live, in this process, for `approveRun()` / `denyRun()`.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... bun run apps/examples/src/advanced/durable-hitl.ts
 *   bun run apps/examples/src/advanced/durable-hitl.ts   # offline, test provider
 */
import { Schema } from "effect";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReactiveAgents, defineTool } from "reactive-agents";

export interface ExampleResult {
  passed: boolean;
  output: string;
  steps: number;
  tokens: number;
  durationMs: number;
}

type PN = "anthropic" | "openai" | "ollama" | "gemini" | "litellm" | "test";

/** A harmless stand-in for a destructive action: returns a marker, deletes nothing. */
const deleteRecordsTool = defineTool({
  name: "delete-records",
  description: "Permanently delete records matching a query. HIGH RISK.",
  input: Schema.Struct({ query: Schema.String }),
  handler: async (args) =>
    `DELETED records matching "${args.query}" (demo: nothing was really removed)`,
  riskLevel: "high",
  timeoutMs: 5_000,
  requiresApproval: true,
});

export async function run(opts?: { provider?: string; model?: string }): Promise<ExampleResult> {
  const start = Date.now();
  const provider = (opts?.provider ?? (process.env.ANTHROPIC_API_KEY ? "anthropic" : "test")) as PN;
  const live = provider !== "test";
  const dir = mkdtempSync(join(tmpdir(), "ra-hitl-example-"));

  console.log("\n=== Durable Human-in-the-Loop Example ===\n");
  console.log(`Mode: ${live ? `LIVE (${provider})` : "TEST (scripted tool call)"}\n`);

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
        { text: "FINAL ANSWER: the stale customer records were handled." },
      ]);
    }
    return b.build();
  };

  let passed = false;
  let output = "";
  let tokens = 0;

  try {
    // ── Tier 1: run() pauses and RETURNS (durable, cross-process ready) ──
    const agent = await mkAgent();
    console.log("Step 1: run('delete the stale customer records')");
    const first = await agent.run("Delete the stale customer records.");

    if (first.status !== "awaiting-approval" || !first.pendingApproval) {
      // Only a live model can skip the tool; the scripted test run always calls it.
      output = "Run completed without requesting the gated tool (no approval needed).";
      console.log(`  ${output}`);
      passed = live;
    } else {
      const p = first.pendingApproval;
      console.log(`  PAUSED awaiting approval: ${p.toolName}(${JSON.stringify(p.args)})`);
      console.log(`  runId=${p.runId}\n`);

      // A human (any process) lists what's waiting...
      const waiting = await agent.listPendingApprovals();
      console.log(`Step 2: listPendingApprovals() → ${waiting.length} run(s) awaiting a decision`);

      // ...and approves. The run resumes and executes the EXACT gated call.
      console.log("Step 3: approveRun()");
      const resumed = await agent.approveRun(p.runId);
      output = resumed.output;
      tokens = resumed.metadata.tokensUsed ?? 0;
      console.log(`  resumed and completed: ${output.slice(0, 100)}`);
      const after = await agent.listPendingApprovals();
      passed = waiting.length === 1 && resumed.success && after.length === 0;
    }
    await agent.dispose();

    // ── Tier 2: run({ onApproval }): pause, decide and resume in ONE call ──
    console.log("\nStep 4: run({ onApproval }) convenience (auto-deny here)");
    const agent2 = await mkAgent();
    let asked = false;
    const denied = await agent2.run("Delete the stale customer records.", {
      onApproval: ({ toolName }) => {
        asked = true;
        console.log(`  onApproval asked for: ${toolName} → denying`);
        return { approve: false, reason: "not authorized in production" };
      },
    });
    console.log(`  final result after deny: ${denied.output.slice(0, 100)}`);
    await agent2.dispose();
    // The scripted run must have asked; a live model may not call the tool.
    if (!live) passed = passed && asked && denied.status !== "awaiting-approval";
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  return { passed, output, steps: 0, tokens, durationMs: Date.now() - start };
}

// Allow direct execution.
if (import.meta.main) {
  run().then((r) => {
    console.log(`\n${r.passed ? "✓ PASS" : "✗ FAIL"}: ${r.durationMs}ms\n`);
    process.exit(r.passed ? 0 : 1);
  });
}
