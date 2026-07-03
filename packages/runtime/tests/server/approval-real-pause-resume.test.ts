// Run: bun test packages/runtime/tests/server/approval-real-pause-resume.test.ts --timeout 30000
//
// Durable HITL (Phase D) — REAL model-triggered approval pause + resume, e2e.
//
// The shipped approve-deny-resume.test.ts proves the DB plumbing but fabricates
// the pause via `injectPause` on a *completed* checkpoint (no
// `meta.awaitingApprovalFor`), so the runner's approval re-entry block is never
// actually exercised. This test drives a REAL pause: the deterministic `test`
// provider's first turn calls a gated tool, act.ts pauses the run
// (status:"done", terminatedBy:"awaiting-approval", meta.awaitingApprovalFor
// set, sentinel output), the durable wrapper persists it, and approveRun/denyRun
// must resume the RESTORED paused checkpoint to a real completion.
//
// Mirrors the known-good interaction-rail.test.ts shape (which pauses the same
// way at the same act.ts seam and resets terminal state on resume).
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { ReactiveAgentBuilder } from "../../src/builder.js";

const durableDir = () => mkdtempSync(join(tmpdir(), "ra-approval-real-"));

function riskyToolDef() {
  return {
    name: "risky-tool",
    description: "A tool that requires approval",
    parameters: [
      { name: "input", type: "string" as const, description: "Input", required: true },
    ],
    riskLevel: "low" as const,
    timeoutMs: 5_000,
    requiresApproval: false,
    source: "function" as const,
  };
}

/**
 * Scenario: first turn calls the gated tool (unconditional, like the
 * interaction-rail template). Resume is driven on the SAME agent instance so the
 * deterministic provider's turn cursor is preserved across run() → approve/deny
 * (advanced to index 1 by the paused call). Post-resume turns are chosen by what
 * the next think() actually SEES in the conversation:
 *  - after APPROVE, the executed tool appends a tool_result ("ran") → the
 *    `match:"denied"` turn is skipped → the unconditional final turn fires →
 *    "APPROVED FINAL: done".
 *  - after DENY, a correct fix injects an LLM-visible denial message containing
 *    "denied" → the `match:"denied"` turn fires → "DENIAL SEEN: done". If the
 *    denial is invisible (step-only) or the terminal state is not reset, this
 *    turn cannot fire and the run cannot reach a "done" answer.
 */
function buildAgent(dir: string) {
  return new ReactiveAgentBuilder()
    .withName("approval-real-e2e")
    .withProvider("test")
    .withSystemPrompt("You are precise.")
    .withTestScenario([
      { toolCall: { name: "risky-tool", args: { input: "go" } } },
      { text: "DENIAL SEEN: done", match: "denied" },
      { text: "APPROVED FINAL: done" },
    ])
    .withTools({
      tools: [
        { definition: riskyToolDef(), handler: () => Effect.succeed("ran") },
      ],
    })
    // Approval detach gating is intercepted in the reasoning kernel (act.ts), so
    // the reasoning path must be active — same as the interaction e2e.
    .withReasoning()
    // Disable adaptive tool-relevance classification: it fires an extra LLM
    // round-trip during setup that would consume the FIRST scenario turn (the
    // gated tool call) before think() ever sees it, so the run would never
    // pause. Opting out keeps the deterministic scenario aligned 1:1 with the
    // reasoning think() calls.
    .withRequiredTools({ adaptive: false })
    .withMaxIterations(6)
    .withDurableRuns({ dir })
    .withApprovalPolicy({ tools: ["risky-tool"], mode: "detach" })
    .build();
}

describe("approval rail e2e — REAL model-triggered pause", () => {
  test("pause → persist → approveRun → resume → completes with the answer (not a re-pause / sentinel)", async () => {
    const dir = durableDir();
    try {
      const agent = await buildAgent(dir);
      try {
        // Real pause: the model's first turn calls the gated tool.
        const paused = await agent.run("compute the answer");
        expect(paused.status).toBe("awaiting-approval");

        const pending = await agent.listPendingApprovals();
        expect(pending.length).toBe(1);
        expect(pending[0]!.toolName).toBe("risky-tool");
        const { runId } = pending[0]!;

        // Approve → resume the REAL restored checkpoint.
        const resumed = await agent.approveRun(runId);

        // The run must actually COMPLETE, not return the pause sentinel and not
        // re-pause. The gated tool ran and the post-resume think synthesized the
        // final answer.
        expect(resumed.output.toLowerCase()).not.toContain("awaiting");
        expect(resumed.output.toLowerCase()).not.toContain("paused");
        expect(resumed.output).toContain("APPROVED FINAL: done");
        expect(resumed.status ?? "completed").not.toBe("awaiting-approval");

        // No longer pending.
        const after = await agent.listPendingApprovals();
        expect(after.map((p) => p.runId)).not.toContain(runId);
      } finally {
        await agent.dispose();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30000);

  test("pause → persist → denyRun → resume → completes with the denial VISIBLE to the model", async () => {
    const dir = durableDir();
    try {
      const agent = await buildAgent(dir);
      try {
        const paused = await agent.run("compute the answer");
        expect(paused.status).toBe("awaiting-approval");

        const pending = await agent.listPendingApprovals();
        expect(pending.length).toBe(1);
        const { runId } = pending[0]!;

        // Deny with a reason → resume. The next think() must SEE the denial
        // (an LLM-visible message containing "denied"), which unlocks the
        // `match:"denied"` turn. If the denial were invisible (step-only) or the
        // terminal state were not reset, the run could not reach this answer.
        const resumed = await agent.denyRun(runId, "not allowed");

        expect(resumed.output.toLowerCase()).not.toContain("awaiting");
        expect(resumed.output.toLowerCase()).not.toContain("paused");
        expect(resumed.output).toContain("DENIAL SEEN: done");
        expect(resumed.status ?? "completed").not.toBe("awaiting-approval");

        const after = await agent.listPendingApprovals();
        expect(after.map((p) => p.runId)).not.toContain(runId);
      } finally {
        await agent.dispose();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30000);
});
