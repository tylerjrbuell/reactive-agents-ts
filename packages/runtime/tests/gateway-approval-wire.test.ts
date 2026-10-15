// Run: bun test packages/runtime/tests/gateway-approval-wire.test.ts --timeout 30000
//
// Wave 6.1 — gateway `policies.requireApprovalFor` had zero consumers: a
// declared safety list that silently did nothing. build() now unions it into
// the kernel approval policy (order-independent: gateway-only, explicit-only,
// or both), and the existing block-mode gate (deny-by-default, no decider)
// refuses the gated call.
//
// RED-ON-CUT: delete the build() merge and the gateway arm dispatches the
// tool exactly like the control arm.
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { ReactiveAgents } from "../src/builder.js";

const loopTool = (name: string, onCall: () => void) => ({
  tools: [
    {
      definition: {
        name,
        description: "seam behavioral marker tool",
        parameters: [],
        riskLevel: "low" as const,
        timeoutMs: 5_000,
        // Deliberately FALSE: the gate under test comes from the gateway
        // policy list, not the tool's own flag.
        requiresApproval: false,
        source: "function" as const,
      },
      handler: () => {
        onCall();
        return Effect.succeed("keep going");
      },
    },
  ],
});

async function runArm(opts: {
  gatewayGated?: readonly string[];
  explicitTools?: readonly string[];
}): Promise<{ executed: number; output: string }> {
  let executed = 0;
  let b = ReactiveAgents.create()
    .withName("gateway-approval")
    .withTestScenario([{ toolCalls: [{ name: "danger_tool", args: {} }] }])
    .withReasoning({ defaultStrategy: "reactive" })
    .withMaxIterations(2)
    .withTools(loopTool("danger_tool", () => {
      executed += 1;
    }));
  if (opts.gatewayGated) b = b.withGateway({ policies: { requireApprovalFor: [...opts.gatewayGated] } });
  if (opts.explicitTools) b = b.withApprovalPolicy({ tools: [...opts.explicitTools] });
  const agent = await b.build();
  try {
    const r = await agent.run("loop forever");
    return { executed, output: String(r.output ?? "") };
  } finally {
    await agent.dispose();
  }
}

describe("6.1 gateway requireApprovalFor wire", () => {
  it("control: ungated tool dispatches (baseline proves the probe)", async () => {
    expect((await runArm({})).executed).toBeGreaterThan(0);
  });

  it("gateway list gates the tool (refused, never executes)", async () => {
    const r = await runArm({ gatewayGated: ["danger_tool"] });
    expect(r.executed).toBe(0);
    // Refusal signal, not a silent skip: the run reports the gated attempt
    // by name with zero successes (the denial observation itself lives in
    // the steps; the harness-authored summary carries the count).
    expect(r.output).toContain("danger_tool");
    expect(r.output).toContain("0 succeeded");
  });

  it("explicit policy + gateway list union (neither order drops the other)", async () => {
    // gateway names danger_tool; explicit names an absent tool — the union
    // must still gate danger_tool regardless of wither order.
    let bCount = 0;
    const mk = () => {
      let b = ReactiveAgents.create()
        .withName("gateway-union")
        .withTestScenario([{ toolCalls: [{ name: "danger_tool", args: {} }] }])
        .withReasoning({ defaultStrategy: "reactive" })
        .withMaxIterations(2)
        .withTools(loopTool("danger_tool", () => {
          bCount += 1;
        }));
      return b;
    };
    const a1 = mk()
      .withGateway({ policies: { requireApprovalFor: ["danger_tool"] } })
      .withApprovalPolicy({ tools: ["other_tool"] });
    const a2 = mk()
      .withApprovalPolicy({ tools: ["other_tool"] })
      .withGateway({ policies: { requireApprovalFor: ["danger_tool"] } });
    for (const b of [a1, a2]) {
      const agent = await b.build();
      try {
        await agent.run("loop forever");
      } finally {
        await agent.dispose();
      }
    }
    expect(bCount).toBe(0);
  });
});
