// Run: bun run repo test apps/cortex/server/tests/strategy-conflict-guard.test.ts
/**
 * Code Action cannot honor an approval gate on a tool its sandbox can call (the framework refuses
 * mid-run, `codeActionApprovalConflict`). Cortex builds every agent with a gate by default, so the run,
 * chat and agent routes ask the framework's predicate up front and refuse with a friendly 409 exactly
 * when the framework would; the approval policy is never dropped silently to make the run go through.
 */
import { describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { Database } from "bun:sqlite";
import { Effect, Layer } from "effect";
import { applySchema } from "../db/schema.js";
import { CortexStoreServiceLive } from "../services/store-service.js";
import { CortexRunnerService, type LaunchParams } from "../services/runner-service.js";
import { runsRouter } from "../api/runs.js";
import { strategyConflictRouter } from "../api/strategy-conflict.js";
import { approvalConflictOfConfig, callableToolNamesOf, strategyConflictBodyOf } from "../services/strategy-conflict-guard.js";

const ca = { strategy: "code-action" } as const;

describe("approvalConflictOfConfig (the framework's codeActionApprovalConflict, fed the built agent's policy and tools)", () => {
  it("the default gate alone does not block: nothing it gates is callable", () => {
    expect(approvalConflictOfConfig({ ...ca })).toBeUndefined();
    expect(approvalConflictOfConfig({ ...ca, tools: ["web-search"] })).toBeUndefined();
  });

  it("the default gate blocks once a tool the framework auto-gates is callable, naming it", () => {
    const c = approvalConflictOfConfig({ ...ca, tools: ["file-write", "web-search"] });
    expect(c?.gatedTools).toEqual(["file-write"]);
    expect(c?.message).toContain("file-write");
    expect(c?.resolutions.map((r) => r.id)).toEqual(["switch-strategy", "turn-off-approvals"]);
  });

  it("an explicit policy naming a callable tool blocks with its name and offers only a strategy switch", () => {
    const c = approvalConflictOfConfig({ ...ca, askBeforeRiskyTools: false, tools: ["web-search"], approvalPolicy: { mode: "detach", tools: ["web-search"] } });
    expect(c?.gatedTools).toEqual(["web-search"]);
    expect(c?.resolutions.map((r) => r.id)).toEqual(["switch-strategy"]);
  });

  it("an explicit policy naming a tool the agent cannot call does not block", () => {
    expect(approvalConflictOfConfig({ ...ca, askBeforeRiskyTools: false, tools: ["web-search"], approvalPolicy: { mode: "detach", tools: ["brief"] } })).toBeUndefined();
  });

  it("command rules block only while a shell tool is callable", () => {
    const policy = { mode: "detach", commands: ["git push"] };
    expect(approvalConflictOfConfig({ ...ca, askBeforeRiskyTools: false, tools: ["web-search"], approvalPolicy: policy })).toBeUndefined();
    const c = approvalConflictOfConfig({ ...ca, askBeforeRiskyTools: false, terminalTools: true, approvalPolicy: policy });
    expect(c?.gatedTools).toEqual(["shell-execute"]);
  });

  it("opted-out and tools-off configs never conflict; other strategies are untouched", () => {
    expect(approvalConflictOfConfig({ ...ca, tools: ["file-write"], askBeforeRiskyTools: false })).toBeUndefined();
    expect(approvalConflictOfConfig({ ...ca, tools: ["file-write"] }, { toolsEnabled: false })).toBeUndefined();
    expect(approvalConflictOfConfig({ strategy: "reactive", tools: ["file-write"] })).toBeUndefined();
    expect(approvalConflictOfConfig({})).toBeUndefined();
  });

  it("the 409 body carries a friendly message and a code the UI keys on", () => {
    const body = strategyConflictBodyOf({ ...ca, tools: ["file-write"] });
    expect(body?.code).toBe("strategy-approval-conflict");
    expect(body?.error).toContain("approval gate");
    expect(body?.error).not.toContain("withApprovalPolicy");
  });
});

describe("callableToolNamesOf", () => {
  it("is the build's allow-list: user tools, the host shell, kernel tools; empty with no tool layer", () => {
    expect(callableToolNamesOf({})).toEqual([]);
    const names = callableToolNamesOf({ tools: ["file-write"], terminalTools: true });
    expect(names).toEqual(expect.arrayContaining(["file-write", "shell-execute", "final-answer"]));
  });
});

describe("POST /api/strategy-conflict (what the UI note renders)", () => {
  const ask = async (body: Record<string, unknown>) => {
    const res = await new Elysia().use(strategyConflictRouter).handle(
      new Request("http://localhost/api/strategy-conflict", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    );
    return { status: res.status, json: (await res.json()) as { conflict: { gatedTools: string[] } | null } };
  };

  it("sends the same verdict the 409 uses, and null when the config can run", async () => {
    const blocked = await ask({ config: { strategy: "code-action", tools: ["file-write"] } });
    expect(blocked.json.conflict?.gatedTools).toEqual(["file-write"]);
    expect((await ask({ config: { strategy: "code-action" } })).json.conflict).toBeNull();
    expect((await ask({ config: { strategy: "code-action", tools: ["file-write"] }, toolsEnabled: false })).json.conflict).toBeNull();
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

  it("runs under the default gate when it gates nothing the sandbox can call", async () => {
    const captured = { params: null as LaunchParams | null };
    const res = await post(app(captured), { prompt: "go", provider: "test", strategy: "code-action" });
    expect(res.status).toBe(200);
    expect(captured.params?.approvalPolicy).toEqual({ mode: "detach" });
  });

  it("is refused with 409 and no run starts when a gated tool is callable", async () => {
    const captured = { params: null as LaunchParams | null };
    const res = await post(app(captured), { prompt: "go", provider: "test", strategy: "code-action", tools: ["file-write"] });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string; conflict: { gatedTools: string[] } };
    expect(body.code).toBe("strategy-approval-conflict");
    expect(body.conflict.gatedTools).toEqual(["file-write"]);
    expect(captured.params).toBeNull();
  });

  it("runs once the person turns approvals off, and the policy is only ever dropped by that choice", async () => {
    const captured = { params: null as LaunchParams | null };
    const res = await post(app(captured), { prompt: "go", provider: "test", strategy: "code-action", tools: ["file-write"], askBeforeRiskyTools: false });
    expect(res.status).toBe(200);
    expect(captured.params?.approvalPolicy).toBeUndefined();
  });

  it("another strategy still gets the default gate", async () => {
    const captured = { params: null as LaunchParams | null };
    await post(app(captured), { prompt: "go", provider: "test", strategy: "reactive" });
    expect(captured.params?.approvalPolicy).toEqual({ mode: "detach" });
  });
});
