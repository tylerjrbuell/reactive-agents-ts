// Run: bun test packages/runtime/tests/approval-gate-strategy-coverage.test.ts
//
// Durable HITL (Phase D) — the approval gate must fire under EVERY kernel-backed
// strategy, not just `reactive`.
//
// Defect (2026-07-22, found dogfooding FORGE): `approvalPolicy` was threaded onto
// `KernelInput` by reactive.ts ONLY. Under reflexion / tree-of-thought /
// plan-execute-per-step the field never reached the kernel, so `act.ts`'s detach
// gate never fired: a tool the caller declared `requiresApproval: true` EXECUTED
// with no human decision, and the run reported success. Silent HITL bypass.
//
// Secondary defect: only reactive.ts forwarded `meta.awaitingApprovalFor` onto the
// strategy result, so even when a pause did occur under another strategy the
// runtime could not surface `status: "awaiting-approval"` + `pendingApproval` —
// the caller saw the pause sentinel text as a completed answer.
//
// Both are pinned here at the user-facing boundary: the gated handler must not run,
// and `AgentResult` must carry the pause descriptor.
import { describe, it, expect, afterAll } from "bun:test";
import { Effect } from "effect";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReactiveAgents } from "../src/builder.js";

const dir = mkdtempSync(join(tmpdir(), "ra-hitl-strategies-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** Strategies that reach the ReAct kernel's act phase, where the gate lives. */
const KERNEL_STRATEGIES = [
  "reactive",
  "reflexion",
  "tree-of-thought",
  // blueprint dispatches through its 0-LLM DAG worker, which has no act phase —
  // it routes to reactive when an approval policy is configured, so the
  // user-visible contract (never execute a gated tool unattended) still holds.
  "blueprint",
  "adaptive",
] as const;

/**
 * plan-execute plans first, so its scenario needs a plan; the gated tool then
 * runs as a `tool_call` step — the DIRECT dispatch path, which bypasses the
 * kernel act phase entirely and needs its own gate check.
 */
const PLAN_JSON = JSON.stringify({
  steps: [
    {
      title: "Do the risky thing",
      instruction: "Call the risky tool",
      type: "tool_call",
      toolName: "risky-tool",
      toolArgs: { input: "go" },
      rationale: { why: "The task asks for it", confidence: 0.9 },
    },
  ],
});

function makeAgent(
  strategy: string,
  onExecute: () => void,
  scenario: unknown[] = [{ toolCall: { name: "risky-tool", args: { input: "go" } } }],
) {
  return ReactiveAgents.create()
    .withName(`hitl-${strategy}`)
    .withProvider("test")
    // One turn, repeated: every LLM call answers with the gated tool call, so the
    // pause is reached no matter how many passes a strategy makes.
    .withTestScenario(scenario as never)
    .withTools({
      tools: [
        {
          definition: {
            name: "risky-tool",
            description: "Mutates state — requires approval.",
            parameters: [
              { name: "input", type: "string" as const, description: "Input", required: true },
            ],
            riskLevel: "high" as const,
            requiresApproval: true,
            timeoutMs: 5_000,
            source: "function" as const,
          },
          handler: () =>
            Effect.sync(() => {
              onExecute();
              return "ran";
            }),
        },
      ],
    })
    // adaptive: false keeps the tool-relevance classifier from consuming scenario
    // turns — it is orthogonal to the gate and only adds noise here.
    .withReasoning({
      defaultStrategy: strategy as never,
      enableStrategySwitching: false,
    })
    .withRequiredTools({ adaptive: false })
    .withMaxIterations(4)
    .withDurableRuns({ dir, checkpointEvery: 1 })
    .withApprovalPolicy({ tools: ["risky-tool"], mode: "detach" })
    .build();
}

describe("durable HITL gate — every kernel-backed strategy", () => {
  for (const strategy of KERNEL_STRATEGIES) {
    it(`${strategy}: a gated tool never executes without approval`, async () => {
      let executions = 0;
      const agent = await makeAgent(strategy, () => {
        executions += 1;
      });
      const result = await agent.run("do the risky thing");

      expect(executions).toBe(0);
      expect(result.status).toBe("awaiting-approval");
      expect(result.pendingApproval?.toolName).toBe("risky-tool");
      expect(result.pendingApproval?.runId).toBeTruthy();
    }, 30_000);
  }

  it("plan-execute-reflect: a gated tool_call step pauses instead of dispatching", async () => {
    let executions = 0;
    const agent = await makeAgent(
      "plan-execute-reflect",
      () => {
        executions += 1;
      },
      [{ text: PLAN_JSON }],
    );
    const result = await agent.run("do the risky thing");

    expect(executions).toBe(0);
    expect(result.status).toBe("awaiting-approval");
    expect(result.pendingApproval?.toolName).toBe("risky-tool");
  }, 30_000);

  it("direct: never dispatches the gated tool (single-iteration cap)", async () => {
    // `direct` caps itself at one iteration, so it reaches the act phase only
    // when a strategy config raises the cap — the gate is threaded onto its
    // kernel input for that case, but the invariant this test defends is the
    // user-visible one: the gated tool does not run.
    let executions = 0;
    const agent = await makeAgent("direct", () => {
      executions += 1;
    });
    await agent.run("do the risky thing");
    expect(executions).toBe(0);
  }, 30_000);

  it("code-action: refuses to run rather than bypassing the gate", async () => {
    let executions = 0;
    const agent = await makeAgent("code-action", () => {
      executions += 1;
    });
    const result = await agent.run("do the risky thing");

    expect(executions).toBe(0);
    expect(result.status).not.toBe("awaiting-approval");
    // Loud, actionable failure — never a silent unattended execution.
    expect(`${result.error ?? ""}${result.output}`).toContain("cannot honor");
  }, 30_000);
});

// ── Block mode (2026-07-23) ──────────────────────────────────────────────────
// The detach coverage above pins the PAUSE path. `mode: "block"` is the OTHER
// mode — in-process, no pause, no durable store — and it was an inert no-op
// until this wave: every gate site keyed on `mode === "detach"`, so a gated
// tool executed with no decision (DEBT-REGISTER §3). Block mode is the DEFAULT
// when `.withDurableRuns()` is absent, i.e. the common configuration. These pin
// that block now enforces deny-by-default across every strategy.

/** Like makeAgent, but block mode (no durable runs) with an optional decider. */
function makeBlockAgent(
  strategy: string,
  onExecute: () => void,
  onApprove?: import("../src/builder/types.js").ApprovalPolicyConfig["onApprove"],
  scenario: unknown[] = [{ toolCall: { name: "risky-tool", args: { input: "go" } } }],
) {
  return ReactiveAgents.create()
    .withName(`hitl-block-${strategy}`)
    .withProvider("test")
    .withTestScenario(scenario as never)
    .withTools({
      tools: [
        {
          definition: {
            name: "risky-tool",
            description: "Mutates state — requires approval.",
            parameters: [
              { name: "input", type: "string" as const, description: "Input", required: true },
            ],
            riskLevel: "high" as const,
            requiresApproval: true,
            timeoutMs: 5_000,
            source: "function" as const,
          },
          handler: () =>
            Effect.sync(() => {
              onExecute();
              return "ran";
            }),
        },
      ],
    })
    .withReasoning({ defaultStrategy: strategy as never, enableStrategySwitching: false })
    .withRequiredTools({ adaptive: false })
    .withMaxIterations(4)
    .withApprovalPolicy({
      tools: ["risky-tool"],
      mode: "block",
      ...(onApprove ? { onApprove } : {}),
    })
    .build();
}

describe("block-mode approval gate — every strategy (deny-by-default)", () => {
  // blueprint routes to reactive when a policy is set; code-action refuses; both
  // are asserted separately below. These reach a gate-capable path.
  const BLOCK_STRATEGIES = ["reactive", "reflexion", "tree-of-thought", "adaptive"] as const;

  for (const strategy of BLOCK_STRATEGIES) {
    it(`${strategy}: block + no onApprove denies the gated tool (no execution, no pause)`, async () => {
      let executions = 0;
      const agent = await makeBlockAgent(strategy, () => {
        executions += 1;
      });
      const result = await agent.run("do the risky thing");
      try {
        expect(executions).toBe(0);
        // Block mode does NOT pause — it decides in-process.
        expect(result.status).not.toBe("awaiting-approval");
      } finally {
        await agent.dispose();
      }
    }, 30_000);
  }

  it("reactive: block + onApprove→approve runs the gated tool", async () => {
    let executions = 0;
    let asked = 0;
    const agent = await makeBlockAgent(
      "reactive",
      () => {
        executions += 1;
      },
      () => {
        asked += 1;
        return true;
      },
    );
    await agent.run("do the risky thing");
    try {
      expect(asked).toBeGreaterThan(0);
      expect(executions).toBeGreaterThan(0);
    } finally {
      await agent.dispose();
    }
  }, 30_000);

  it("plan-execute-reflect: block + no onApprove denies the gated tool_call step", async () => {
    let executions = 0;
    const agent = await makeBlockAgent(
      "plan-execute-reflect",
      () => {
        executions += 1;
      },
      undefined,
      [{ text: PLAN_JSON }],
    );
    await agent.run("do the risky thing");
    try {
      expect(executions).toBe(0);
    } finally {
      await agent.dispose();
    }
  }, 30_000);

  it("code-action: refuses on block mode too (its tools run past the gate)", async () => {
    let executions = 0;
    const agent = await makeBlockAgent("code-action", () => {
      executions += 1;
    });
    const result = await agent.run("do the risky thing");
    try {
      expect(executions).toBe(0);
      expect(`${result.error ?? ""}${result.output}`).toContain("cannot honor");
    } finally {
      await agent.dispose();
    }
  }, 30_000);
});
