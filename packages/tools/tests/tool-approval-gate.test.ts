import { describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import { EventBusLive } from "@reactive-agents/core";
import { ToolService, ToolServiceLive } from "../src/tool-service.js";
import { ToolApprovalGate } from "../src/governance/tool-approval-gate.js";
import type { ToolDefinition } from "../src/types.js";

// Hotfix 0.5-3 (2026-07-07): ToolService.execute never enforced
// requiresApproval — only the kernel HITL gate did, and only on its path.
// The ToolApprovalGate is the service-layer choke every execute path shares;
// opt-in (serviceOption), so unprovided = today's documented no-enforcement
// contract (see requires-approval-enforcement.test.ts).

const handler = () => Effect.succeed("executed");

const approvalDef: ToolDefinition = {
  name: "danger-op",
  description: "a tool that needs approval",
  parameters: [],
  riskLevel: "high",
  timeoutMs: 5_000,
  requiresApproval: true,
};

const safeDef: ToolDefinition = {
  name: "safe-op",
  description: "no approval needed",
  parameters: [],
  riskLevel: "low",
  timeoutMs: 5_000,
  requiresApproval: false,
};

const baseLayer = ToolServiceLive.pipe(Layer.provide(EventBusLive));

const run = <A, E>(
  eff: Effect.Effect<A, E, ToolService>,
  gateLayer?: Layer.Layer<ToolApprovalGate>,
) => {
  const layer = gateLayer ? Layer.provideMerge(baseLayer, gateLayer) : baseLayer;
  return Effect.runPromise(eff.pipe(Effect.provide(layer)) as Effect.Effect<A, E, never>);
};

const register = Effect.gen(function* () {
  const svc = yield* ToolService;
  yield* svc.register(approvalDef, handler);
  yield* svc.register(safeDef, handler);
  return svc;
});

describe("ToolApprovalGate enforcement", () => {
  test("no gate provided → requiresApproval tool executes (contract preserved)", async () => {
    const out = await run(
      Effect.gen(function* () {
        const svc = yield* register;
        return yield* svc.execute({ toolName: "danger-op", arguments: {}, agentId: "a", sessionId: "s" });
      }),
    );
    expect(out.success).toBe(true);
  });

  test("gate denies → ToolAuthorizationError", async () => {
    const denyGate = Layer.succeed(ToolApprovalGate, {
      authorize: () => Effect.succeed({ approved: false, reason: "policy: high-risk denied" }),
    });
    const result = await run(
      Effect.gen(function* () {
        const svc = yield* register;
        return yield* svc
          .execute({ toolName: "danger-op", arguments: {}, agentId: "a", sessionId: "s" })
          .pipe(Effect.either);
      }),
      denyGate,
    );
    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect((result.left as { _tag: string })._tag).toBe("ToolAuthorizationError");
    }
  });

  test("gate approves → tool executes", async () => {
    const allowGate = Layer.succeed(ToolApprovalGate, {
      authorize: () => Effect.succeed({ approved: true }),
    });
    const out = await run(
      Effect.gen(function* () {
        const svc = yield* register;
        return yield* svc.execute({ toolName: "danger-op", arguments: {}, agentId: "a", sessionId: "s" });
      }),
      allowGate,
    );
    expect(out.success).toBe(true);
  });

  test("gate is NOT consulted for tools that do not require approval", async () => {
    const denyGate = Layer.succeed(ToolApprovalGate, {
      authorize: () => Effect.succeed({ approved: false, reason: "should not be consulted" }),
    });
    const out = await run(
      Effect.gen(function* () {
        const svc = yield* register;
        return yield* svc.execute({ toolName: "safe-op", arguments: {}, agentId: "a", sessionId: "s" });
      }),
      denyGate,
    );
    expect(out.success).toBe(true);
  });
});
