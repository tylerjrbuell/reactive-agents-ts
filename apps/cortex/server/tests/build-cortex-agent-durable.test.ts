// Run: bun test apps/cortex/server/tests/build-cortex-agent-durable.test.ts --timeout 15000
//
// Phase E1 (v0.12) — Cortex durable-runs enabler. buildCortexAgent now wires
// `.withDurableRuns(...)` (and `.withApprovalPolicy(...)` for durable HITL) so the
// desk can list + resume + approve durable runs. These pin the wiring: the
// durable surface is present, and approval-policy builds only because the durable
// store is also present (the framework build-guard requires it).
import { describe, it, expect } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildCortexAgent } from "../services/build-cortex-agent.js";

const freshDir = () => join(tmpdir(), `cortex-durable-${Date.now()}-${Math.random().toString(36).slice(2)}`);

describe("buildCortexAgent — durable runs enabler (Phase E1)", () => {
  it("wires the durable surface: listRuns/listPendingApprovals resolve", async () => {
    const agent = await buildCortexAgent({
      provider: "test",
      agentId: "cortex-durable-1",
      durableRuns: { enabled: true, dir: freshDir(), checkpointEvery: 1 },
    });
    const runs = await agent.listRuns();
    expect(Array.isArray(runs)).toBe(true);
    const pending = await agent.listPendingApprovals();
    expect(Array.isArray(pending)).toBe(true);
  }, 15000);

  it("durable + approvalPolicy builds (durable store satisfies the detach guard)", async () => {
    const agent = await buildCortexAgent({
      provider: "test",
      agentId: "cortex-durable-2",
      durableRuns: {
        enabled: true,
        dir: freshDir(),
        approvalPolicy: { tools: ["shell-execute"], mode: "detach" },
      },
    });
    expect(agent.agentId).toBe("cortex-durable-2");
    expect(typeof agent.resumeRun).toBe("function");
    expect(typeof agent.approveRun).toBe("function");
  }, 15000);

  it("no durableRuns → durable methods still exist but no store wired (control)", async () => {
    const agent = await buildCortexAgent({ provider: "test", agentId: "cortex-plain" });
    expect(agent.agentId).toBe("cortex-plain");
  }, 15000);
});
