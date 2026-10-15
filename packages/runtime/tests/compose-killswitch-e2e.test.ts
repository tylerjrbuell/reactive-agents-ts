// Run: bun test packages/runtime/tests/compose-killswitch-e2e.test.ts --timeout 60000
//
// Wave 6.3 — e2e builder→kernel proof per shipped compose killswitch. The
// compose package's own tests are pipeline-level (a harness double); nothing
// proved a composed killswitch actually stops a real agent run. Each arm:
// `.compose(<killswitch>)` → test-provider looping run → the TRACE's
// run-completed terminal carries the killswitch's reason (the user-visible
// `result.terminatedBy` is the closed TerminatedBy enum and cannot name a
// dynamic reason — the raw channel rides `rawTerminatedBy` → trace +
// AgentCompleted.terminationReason). Calls/wall bounded alongside.
//
// RED-ON-CUT: unregister the kernel hook call sites (iterate-pass think
// hooks, act observe hooks, runner bootstrap hooks) and the arms run to
// maxIterations with an end_turn terminal instead.
import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import { readFile } from "node:fs/promises";
import { ReactiveAgents } from "../src/index.js";
import { budgetLimit, maxIterations, requireApprovalFor, timeoutAfter, watchdog } from "@reactive-agents/compose";

const loopTool = (name: string, onCall: () => void, sleepMs = 0) => ({
  tools: [
    {
      definition: {
        name,
        description: "seam behavioral marker tool",
        parameters: [],
        riskLevel: "low" as const,
        timeoutMs: 10_000,
        requiresApproval: false,
        source: "function" as const,
      },
      handler: () => {
        onCall();
        if (sleepMs > 0) {
          return Effect.map(
            Effect.promise(() => new Promise((resolve) => setTimeout(resolve, sleepMs))),
            () => "keep going",
          );
        }
        return Effect.succeed("keep going");
      },
    },
  ],
});

async function traceTerminal(tracePath: string): Promise<{ status?: string; terminatedBy?: string }> {
  const text = await readFile(tracePath, "utf8");
  for (const line of text.trim().split("\n")) {
    try {
      const e = JSON.parse(line) as { kind?: string; status?: string; terminatedBy?: string };
      if (e.kind === "run-completed") return { status: e.status, terminatedBy: e.terminatedBy };
    } catch {
      /* skip */
    }
  }
  return {};
}

async function runArm(
  killswitch: (harness: never) => void,
  opts: { toolName?: string; maxIters?: number; sleepMs?: number } = {},
): Promise<{ calls: number; terminal: string | undefined; wallMs: number }> {
  const toolName = opts.toolName ?? "loop_tool";
  let calls = 0;
  const started = Date.now();
  const agent = await ReactiveAgents.create()
    .withName("compose-e2e")
    .withTestScenario([{ toolCalls: [{ name: toolName, args: {} }] }])
    .withReasoning({ defaultStrategy: "reactive" })
    .withMaxIterations(opts.maxIters ?? 6)
    .withTools(loopTool(toolName, () => {
      calls += 1;
    }, opts.sleepMs ?? 0))
    .compose(killswitch as never)
    .build();
  try {
    const r = await agent.run("loop forever");
    const tracePath = (r.metadata as { tracePath?: string }).tracePath;
    const terminal = tracePath ? (await traceTerminal(tracePath)).terminatedBy : undefined;
    return { calls, terminal, wallMs: Date.now() - started };
  } finally {
    await agent.dispose();
  }
}

describe("6.3 compose killswitch e2e (builder -> kernel)", () => {
  it("maxIterations stops the run at the composed cap", async () => {
    const r = await runArm(maxIterations(1));
    expect(r.calls).toBeLessThanOrEqual(1);
    expect(String(r.terminal)).toContain("max-iterations");
  });

  it("budgetLimit stops the run on token spend", async () => {
    const r = await runArm(budgetLimit({ maxTokens: 1 }));
    expect(String(r.terminal)).toContain("budget-limit");
  });

  it("timeoutAfter is wall-clock-real (fires mid-run)", async () => {
    const r = await runArm(timeoutAfter({ wallClock: "50ms" }), { sleepMs: 120 });
    expect(r.wallMs).toBeLessThan(15_000);
    expect(String(r.terminal)).toContain("timeout-after");
  });

  it("watchdog does not fire on a progressing run", async () => {
    const r = await runArm(watchdog({ noProgressFor: "5s" }), { maxIters: 3 });
    expect(String(r.terminal ?? "")).not.toContain("watchdog");
    expect(r.calls).toBeGreaterThan(0);
  });

  it("requireApprovalFor refuses the gated tool", async () => {
    const r = await runArm(requireApprovalFor({ tools: ["loop_tool"], approver: () => false }));
    expect(r.calls).toBe(0);
  });
});
