// Run: bun test packages/runtime/tests/seam-mcp-approval-gate.test.ts --timeout 30000
//
// Security fix (found during audit G6, 2026-11-18): the builder folded only
// built-in and custom tools that need approval into `policy.tools`. Tools
// registered AFTER build never reached the gate, under any strategy: MCP tools
// (discovered when their server connects) and `.withAgentTool` sub-agent tools
// (default `requiresApproval: true`). An MCP server the server marks
// `destructiveHint: true` ran unattended under `.withApprovalPolicy()`.
//
// Fix: each reasoning pass reads the live registry (registeredApprovalTools)
// and buildRunEnvelopeFromConfig adds those names to the gated set, so the
// kernel gate and code-action's refusal both see them.
//
// RED-ON-CUT: drop `...gatedTools` from the Set in run-envelope-config.ts
// (or return [] from registeredApprovalTools) and the "destructive MCP",
// "sub-agent" and "code-action" cases fail: the tool runs / code-action runs.
import { describe, it, expect, afterAll } from "bun:test";
import { Effect } from "effect";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReactiveAgents } from "../src/builder.js";
import type { ApprovalPolicyConfig } from "../src/builder/types.js";
import { toolNeedsApproval } from "../src/builder/build-effect/approval-autofeed.js";
import { buildRunEnvelopeFromConfig } from "../src/engine/run-envelope-config.js";
import { registeredApprovalTools } from "../src/engine/registered-approval-tools.js";
import { defaultReactiveAgentsConfig } from "../src/types.js";

const FIXTURE = join(import.meta.dir, "fixtures", "annotated-stdio-mcp-server.ts");
const dir = mkdtempSync(join(tmpdir(), "ra-mcp-approval-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

let seq = 0;

interface Arm {
  readonly ran: readonly string[];
  readonly asked: readonly string[];
  readonly text: string;
}

/**
 * Run one agent whose only scripted move is calling `call`. `ran` = MCP tools
 * the fixture server actually executed; `asked` = tools the approval decider
 * was consulted for (it always DENIES).
 */
async function runArm(
  call: string,
  opts: { policy?: Omit<ApprovalPolicyConfig, "onApprove">; strategy?: string; scenario?: unknown[] } = {},
): Promise<Arm> {
  const log = join(dir, `calls-${seq++}.log`);
  const asked: string[] = [];
  let b = ReactiveAgents.create()
    .withName(`mcp-approval-${seq}`)
    .withProvider("test")
    .withTestScenario((opts.scenario ?? [{ toolCalls: [{ name: call, args: {} }] }]) as never)
    .withReasoning({ defaultStrategy: (opts.strategy ?? "reactive") as never, enableStrategySwitching: false })
    .withRequiredTools({ adaptive: false })
    .withMaxIterations(2)
    .withMCP({
      name: "fx",
      transport: "stdio",
      command: "bun",
      args: [FIXTURE],
      env: { MCP_FIXTURE_CALL_LOG: log },
      // Operator promise: `peek` is read-only.
      readOnly: ["peek"],
    });
  if (opts.policy) {
    b = b.withApprovalPolicy({
      ...opts.policy,
      onApprove: ({ toolName }) => {
        asked.push(toolName);
        return { approve: false, reason: "test denies" };
      },
    });
  }
  const agent = await b.build();
  try {
    const r = await agent.run(`call ${call}`);
    const ran = existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean) : [];
    return { ran, asked, text: `${r.error ?? ""}${r.output ?? ""}` };
  } finally {
    await agent.dispose();
  }
}

const BLOCK = { mode: "block" as const, tools: [] };

describe("MCP tools under an approval policy (reactive, block mode)", () => {
  it("CONTROL: no policy, the destructive MCP tool runs (probe dispatches)", async () => {
    const arm = await runArm("fx/wipe");
    expect(arm.ran).toContain("wipe");
  }, 30_000);

  it("destructive MCP tool (destructiveHint, discovered at connect): approval asked, call does not run", async () => {
    const arm = await runArm("fx/wipe", { policy: BLOCK });
    expect(arm.asked).toContain("fx/wipe");
    expect(arm.ran).not.toContain("wipe");
  }, 30_000);

  it("read-only MCP tool (operator readOnly): not gated, runs", async () => {
    const arm = await runArm("fx/peek", { policy: BLOCK });
    expect(arm.asked).toEqual([]);
    expect(arm.ran).toContain("peek");
  }, 30_000);

  it("unknown-effect MCP tool: follows the custom-tool rule, not gated by default", async () => {
    const arm = await runArm("fx/echo", { policy: BLOCK });
    expect(arm.asked).toEqual([]);
    expect(arm.ran).toContain("echo");
  }, 30_000);

  it("MCP tool named in policy.tools: gated", async () => {
    const arm = await runArm("fx/echo", { policy: { mode: "block", tools: ["fx/echo"] } });
    expect(arm.asked).toContain("fx/echo");
    expect(arm.ran).not.toContain("echo");
  }, 30_000);
});

// plan-execute dispatches a `tool_call` plan step directly (its own gate site).
const PLAN_WIPE = JSON.stringify({
  steps: [
    {
      title: "Wipe",
      instruction: "Call the wipe tool",
      type: "tool_call",
      toolName: "fx/wipe",
      toolArgs: {},
      rationale: { why: "The task asks for it", confidence: 0.9 },
    },
  ],
});

describe("destructive MCP tool under the other gate-capable strategies", () => {
  const ARMS = [
    { strategy: "reflexion" },
    { strategy: "tree-of-thought" },
    { strategy: "plan-execute-reflect", scenario: [{ text: PLAN_WIPE }] },
  ] as const;
  for (const a of ARMS) {
    it(`${a.strategy}: the destructive MCP tool runs without a policy (control) and never runs unapproved`, async () => {
      const scenario = "scenario" in a ? [...a.scenario] : undefined;
      const control = await runArm("fx/wipe", { strategy: a.strategy, ...(scenario ? { scenario } : {}) });
      expect(control.ran).toContain("wipe");
      const arm = await runArm("fx/wipe", { policy: BLOCK, strategy: a.strategy, ...(scenario ? { scenario } : {}) });
      expect(arm.ran).not.toContain("wipe");
    }, 60_000);
  }
});

describe("code-action sees MCP tools that need approval", () => {
  it("callable destructive MCP tool makes code-action refuse before any call", async () => {
    const arm = await runArm("fx/wipe", { policy: BLOCK, strategy: "code-action" });
    expect(arm.text).toContain("cannot honor");
    expect(arm.text).toContain("fx/wipe");
    expect(arm.ran).toEqual([]);
  }, 30_000);
});

describe("sub-agent tools (.withAgentTool, default requiresApproval: true)", () => {
  it("gated under a policy: approval asked, the sub-agent does not run", async () => {
    const asked: string[] = [];
    const agent = await ReactiveAgents.create()
      .withName("mcp-approval-subagent")
      .withProvider("test")
      .withTestScenario([{ toolCalls: [{ name: "helper", args: { input: "go" } }] }] as never)
      .withReasoning({ defaultStrategy: "reactive", enableStrategySwitching: false })
      .withRequiredTools({ adaptive: false })
      .withMaxIterations(2)
      .withTools()
      .withAgentTool("helper", { name: "helper-agent", description: "Helps." })
      .withApprovalPolicy({
        mode: "block",
        onApprove: ({ toolName }) => {
          asked.push(toolName);
          return false;
        },
      })
      .build();
    let started = 0;
    const unsubscribe = await agent.subscribe((e) => {
      if (e._tag === "ToolCallCompleted" && e.toolName === "helper" && e.success) started += 1;
    });
    try {
      await agent.run("delegate to helper");
      expect(asked).toContain("helper");
      expect(started).toBe(0);
    } finally {
      unsubscribe();
      await agent.dispose();
    }
  }, 30_000);
});

describe("tools added with agent.registerTool() after build", () => {
  it("a requiresApproval tool registered after build is gated", async () => {
    const asked: string[] = [];
    let ran = 0;
    const agent = await ReactiveAgents.create()
      .withName("mcp-approval-registertool")
      .withProvider("test")
      .withTestScenario([{ toolCalls: [{ name: "late_tool", args: {} }] }] as never)
      .withReasoning({ defaultStrategy: "reactive", enableStrategySwitching: false })
      .withRequiredTools({ adaptive: false })
      .withMaxIterations(2)
      .withTools()
      .withApprovalPolicy({
        mode: "block",
        onApprove: ({ toolName }) => {
          asked.push(toolName);
          return false;
        },
      })
      .build();
    await agent.registerTool(
      { name: "late_tool", description: "Registered after build.", parameters: [], riskLevel: "high", timeoutMs: 5_000, requiresApproval: true, source: "function" },
      () => Effect.sync(() => { ran += 1; return "ran"; }),
    );
    try {
      await agent.run("call late_tool");
      expect(asked).toContain("late_tool");
      expect(ran).toBe(0);
    } finally {
      await agent.dispose();
    }
  }, 30_000);
});

describe("pure seams", () => {
  it("toolNeedsApproval: flag, MCP write, MCP read-only, MCP unknown, custom write", () => {
    expect(toolNeedsApproval({ name: "a", requiresApproval: true })).toBe(true);
    expect(toolNeedsApproval({ name: "s/w", source: "mcp", mutatesExternalState: true })).toBe(true);
    expect(toolNeedsApproval({ name: "s/r", source: "mcp", mutatesExternalState: false })).toBe(false);
    expect(toolNeedsApproval({ name: "s/u", source: "mcp" })).toBe(false);
    // Custom tools keep today's rule: only the declared flag gates.
    expect(toolNeedsApproval({ name: "c", source: "function", mutatesExternalState: true })).toBe(false);
  });

  it("buildRunEnvelopeFromConfig adds gatedTools to the policy's set; no policy stays absent", () => {
    const base = defaultReactiveAgentsConfig("seam-agent");
    const config = defaultReactiveAgentsConfig("seam-agent", { approvalPolicy: { mode: "block", tools: ["x"] } });
    const env = buildRunEnvelopeFromConfig(config, { gatedTools: ["fx/wipe"] });
    expect([...(env.rails.approvalPolicy?.tools ?? [])].sort()).toEqual(["fx/wipe", "x"]);
    const none = buildRunEnvelopeFromConfig(base, { gatedTools: ["fx/wipe"] });
    expect(none.rails.approvalPolicy).toBeUndefined();
  });

  it("registeredApprovalTools: no policy means no registry read", async () => {
    expect(await Effect.runPromise(registeredApprovalTools({}))).toEqual([]);
  });
});
