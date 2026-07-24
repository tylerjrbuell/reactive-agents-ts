// Run: bun test packages/runtime/tests/approval-block-mode-gate.test.ts --timeout 30000
//
// DEBT-REGISTER §3 (2026-07-23) — `.withApprovalPolicy({ mode: "block" })` was an
// INERT safety switch. Every gate site keyed on `mode === "detach"`; nothing
// read `"block"`, so a `requiresApproval` tool executed with NO human decision.
// And `"block"` is the mode you get from `.withApprovalPolicy(...)` WITHOUT
// durable runs — the common one. Empirically confirmed before the fix: a gated
// tool executed identically with block mode and with no policy at all.
//
// These are BEHAVIORAL pins driven by the `test` provider. The `control` arm
// MUST dispatch the tool, or the probe proves nothing (the scenario/classifier
// can silently eat a scripted tool turn — see MEMORY feedback). Each real arm is
// asserted against that validated baseline.
//
// RED-ON-CUT: delete the block-approval gate in `executeToolAndObserve`
// (tool-observe.ts) or `resolveBlockApproval`'s deny-by-default branch
// (approval-gate.ts) and the deny/approve arms fail — the tool executes again.
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { ReactiveAgents } from "../src/builder.js";
import type { ApprovalPolicyConfig } from "../src/builder/types.js";

// A low-risk tool that always keeps the loop going, so with a single repeating
// scenario turn + a tight iteration cap the run can only stop by hitting the cap
// (the builder-seam fixture pattern — provably dispatches).
const loopTool = (name: string, requiresApproval: boolean, onCall: () => void) => ({
  tools: [
    {
      definition: {
        name,
        description: "seam behavioral marker tool",
        parameters: [],
        riskLevel: "low" as const,
        timeoutMs: 5_000,
        requiresApproval,
        source: "function" as const,
      },
      handler: () => {
        onCall();
        return Effect.succeed("keep going");
      },
    },
  ],
});

async function runArm(
  label: string,
  policy: ApprovalPolicyConfig | undefined,
  opts: { toolName?: string; requiresApproval?: boolean } = {},
): Promise<{ executed: number; terminatedBy: string | undefined; output: string }> {
  const toolName = opts.toolName ?? "danger_tool";
  const requiresApproval = opts.requiresApproval ?? true;
  let executed = 0;
  let b = ReactiveAgents.create()
    .withName(`approval-${label}`)
    .withTestScenario([{ toolCalls: [{ name: toolName, args: {} }] }])
    .withReasoning({ defaultStrategy: "reactive" })
    .withMaxIterations(2)
    .withTools(loopTool(toolName, requiresApproval, () => {
      executed += 1;
    }));
  if (policy) b = b.withApprovalPolicy(policy);
  const agent = await b.build();
  try {
    const r = await agent.run("loop forever");
    return { executed, terminatedBy: r.terminatedBy, output: String(r.output ?? "") };
  } finally {
    await agent.dispose();
  }
}

describe("block-mode approval gate (Durable HITL, Phase D)", () => {
  it("CONTROL: with no approval policy the gated tool executes (baseline for the probe)", async () => {
    const { executed } = await runArm("control", undefined);
    // If this is 0 the probe is invalid — the scenario never dispatched.
    expect(executed).toBeGreaterThan(0);
  }, 30_000);

  it("block mode with NO onApprove DENIES the gated call (deny-by-default)", async () => {
    const control = await runArm("control2", undefined);
    const denied = await runArm("deny", { tools: ["danger_tool"], mode: "block" });
    // The whole point: the tool that ran in control does NOT run here.
    expect(control.executed).toBeGreaterThan(0);
    expect(denied.executed).toBe(0);
  }, 30_000);

  it("block mode with onApprove → approve RUNS the gated call", async () => {
    let asked = 0;
    const approved = await runArm("approve", {
      tools: ["danger_tool"],
      mode: "block",
      onApprove: ({ toolName }) => {
        asked += 1;
        expect(toolName).toBe("danger_tool");
        return true;
      },
    });
    expect(asked).toBeGreaterThan(0); // the decider was consulted
    expect(approved.executed).toBeGreaterThan(0); // and the call ran
  }, 30_000);

  it("block mode with onApprove → deny does NOT run the gated call", async () => {
    let asked = 0;
    const refused = await runArm("refuse", {
      tools: ["danger_tool"],
      mode: "block",
      onApprove: () => {
        asked += 1;
        return { approve: false, reason: "not this time" };
      },
    });
    expect(asked).toBeGreaterThan(0);
    expect(refused.executed).toBe(0);
  }, 30_000);

  it("a tool that neither declares requiresApproval nor is named runs under a block policy", async () => {
    // `safe_tool` has requiresApproval:false and the policy names a DIFFERENT
    // tool, so it is not gated by either the autofeed or the tools list → runs.
    // (A requiresApproval:true tool WOULD be gated by the F2 autofeed even when
    // unnamed — that is the intended safety default, not a bug.)
    const { executed } = await runArm(
      "scoped",
      { tools: ["some_other_tool"], mode: "block" },
      { toolName: "safe_tool", requiresApproval: false },
    );
    expect(executed).toBeGreaterThan(0);
  }, 30_000);
});
