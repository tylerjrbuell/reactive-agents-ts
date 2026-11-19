// Run: bun run repo test apps/cortex/server/tests/strategy-conflict-guard.test.ts
/**
 * Code Action cannot run behind an approval gate (the framework refuses mid-run). Cortex builds every
 * agent with a gate by default, so the run route, the chat routes and the agent routes refuse up front
 * with a friendly 409, and the approval policy is never dropped silently to make the run go through.
 */
import { describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { Database } from "bun:sqlite";
import { Effect, Layer } from "effect";
import { applySchema } from "../db/schema.js";
import { CortexStoreServiceLive } from "../services/store-service.js";
import { CortexRunnerService, type LaunchParams } from "../services/runner-service.js";
import { runsRouter } from "../api/runs.js";
import { approvalConflictOfConfig, strategyConflictBodyOf } from "../services/strategy-conflict-guard.js";

describe("approvalConflictOfConfig", () => {
  it("code-action with the default gate is a conflict; every other strategy is not", () => {
    expect(approvalConflictOfConfig({ strategy: "code-action" })?.resolutions.map((r) => r.id)).toEqual(["switch-strategy", "turn-off-approvals"]);
    expect(approvalConflictOfConfig({ strategy: "reactive" })).toBeUndefined();
    expect(approvalConflictOfConfig({})).toBeUndefined();
  });

  it("the gate is judged as the agent is built: opted-out and tools-off configs are not conflicts", () => {
    expect(approvalConflictOfConfig({ strategy: "code-action", askBeforeRiskyTools: false })).toBeUndefined();
    expect(approvalConflictOfConfig({ strategy: "code-action" }, { toolsEnabled: false })).toBeUndefined();
  });

  it("an explicit policy is a conflict that offers only a strategy switch (rules are never dropped for the user)", () => {
    const c = approvalConflictOfConfig({ strategy: "code-action", askBeforeRiskyTools: false, approvalPolicy: { mode: "detach", tools: ["shell-execute"] } });
    expect(c?.resolutions.map((r) => r.id)).toEqual(["switch-strategy"]);
  });

  it("the 409 body carries a friendly message and a code the UI keys on", () => {
    const body = strategyConflictBodyOf({ strategy: "code-action" });
    expect(body?.code).toBe("strategy-approval-conflict");
    expect(body?.error).toContain("approval gate");
    expect(body?.error).not.toContain("withApprovalPolicy");
  });
});

describe("POST /api/runs with code-action", () => {
  const app = (captured: { params: LaunchParams | null }) => {
    const db = new Database(":memory:");
    applySchema(db);
    const runner = Layer.succeed(CortexRunnerService, {
      resumeCrashed: () => Effect.succeed({ agentId: "a", runId: "r" }),
      start: (p) => {
        captured.params = p;
        return Effect.succeed({ agentId: "a", runId: "r" });
      },
      pause: () => Effect.succeed("not-live" as const),
      resume: () => Effect.void,
      stop: () => Effect.succeed("not-live" as const),
      terminate: () => Effect.void,
      getActive: () => Effect.succeed(new Map()),
      listPendingApprovals: () => Effect.succeed([]),
      approveApproval: () => Effect.void,
      denyApproval: () => Effect.void,
      listPendingInteractions: () => Effect.succeed([]),
      respondToInteraction: () => Effect.succeed({ success: true, output: "" }),
    });
    return new Elysia().use(runsRouter(CortexStoreServiceLive(db), runner));
  };
  const post = (a: ReturnType<typeof app>, body: Record<string, unknown>) =>
    a.handle(new Request("http://localhost/api/runs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));

  it("is refused with 409 and no run starts", async () => {
    const captured = { params: null as LaunchParams | null };
    const res = await post(app(captured), { prompt: "go", provider: "test", strategy: "code-action" });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe("strategy-approval-conflict");
    expect(captured.params).toBeNull();
  });

  it("runs once the person turns approvals off, and the policy is only ever dropped by that choice", async () => {
    const captured = { params: null as LaunchParams | null };
    const res = await post(app(captured), { prompt: "go", provider: "test", strategy: "code-action", askBeforeRiskyTools: false });
    expect(res.status).toBe(200);
    expect(captured.params?.approvalPolicy).toBeUndefined();
  });

  it("another strategy still gets the default gate", async () => {
    const captured = { params: null as LaunchParams | null };
    await post(app(captured), { prompt: "go", provider: "test", strategy: "reactive" });
    expect(captured.params?.approvalPolicy).toEqual({ mode: "detach" });
  });
});
