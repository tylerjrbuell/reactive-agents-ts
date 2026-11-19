// Run: bun test packages/runtime/tests/approval-resume-iteration-cap.test.ts --timeout 30000
//
// `.withMaxIterations(n)` bounds a RUN, not one leg of it. A durable run that
// pauses at an approval gate and is resumed (approveRun / denyRun / the
// run({ onApproval }) driver) is the same run: the think passes of every leg
// count against one cap.
//
// Pin (pre-v0.19.0 QA, with-approval-gates template): a model that kept
// proposing a gated call while the host denied it ran six legs on one runId.
// That was the cap (6) holding: the pause lands mid-pass, so `state.iteration`
// never advances on a paused leg, and the cap is enforced by the restored
// `llmCalls` count instead. Resetting the carried `llmCalls` on resume turns
// both tests red (verified by mutation in durable-facade's decideAndResumeRun).
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { ReactiveAgentBuilder } from "../src/builder.js";

const MAX_ITERATIONS = 3;

function riskyToolDef() {
  return {
    name: "risky-tool",
    description: "A tool that requires approval",
    parameters: [{ name: "input", type: "string" as const, description: "Input", required: true }],
    riskLevel: "low" as const,
    timeoutMs: 5_000,
    requiresApproval: false,
    source: "function" as const,
  };
}

/** Every think proposes the gated call again (the last scenario turn repeats). */
function buildAgent(dir: string) {
  return new ReactiveAgentBuilder()
    .withName("approval-cap")
    .withProvider("test")
    .withSystemPrompt("You are precise.")
    .withTestScenario([{ toolCall: { name: "risky-tool", args: { input: "go" } } }])
    .withTools({ tools: [{ definition: riskyToolDef(), handler: () => Effect.succeed("ran") }] })
    .withReasoning()
    .withRequiredTools({ adaptive: false })
    .withMaxIterations(MAX_ITERATIONS)
    .withDurableRuns({ dir })
    .withApprovalPolicy({ tools: ["risky-tool"], mode: "detach" })
    .build();
}

describe("iteration cap across durable approval resumes", () => {
  test("a deny -> resume -> re-propose loop ends at .withMaxIterations(n)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ra-approval-cap-"));
    try {
      const agent = await buildAgent(dir);
      try {
        let asked = 0;
        const result = await agent.run("compute the answer", {
          onApproval: () => {
            asked += 1;
            // Safety valve so a regression fails fast instead of hanging.
            if (asked > 10) throw new TypeError("approval loop did not end at the iteration cap");
            return false;
          },
        });
        // One think pass per leg; the passes of all legs share the cap. The
        // capped pass answers instead of acting, so cap-1 proposals reach the host.
        expect(asked).toBe(MAX_ITERATIONS - 1);
        expect(result.status).not.toBe("awaiting-approval");
        expect(result.success).toBe(false);
      } finally {
        await agent.dispose();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30000);

  test("denyRun on a run whose cap is spent ends it instead of thinking again", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ra-approval-cap-deny-"));
    try {
      const agent = await buildAgent(dir);
      try {
        let result = await agent.run("compute the answer");
        let legs = 1;
        while (result.status === "awaiting-approval" && result.pendingApproval && legs <= 10) {
          result = await agent.denyRun(result.pendingApproval.runId, "no");
          legs += 1;
        }
        expect(result.status).not.toBe("awaiting-approval");
        // One think pass per leg: the run ends on its cap-th leg.
        expect(legs).toBe(MAX_ITERATIONS);
      } finally {
        await agent.dispose();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30000);
});
