// Run: bun test packages/runtime/tests/sub-agent-light-config.test.ts
//
// Cross-cutting inheritance for sub-agents (2026-07-23). A TRUE sub-agent runs
// under the parent's judgment + safety constraints — its answer is judged
// against the same contract / fabrication guard / grounding, and a gated tool it
// calls is refused rather than executed unattended. Before this, the child built
// by `createLightRuntime` inherited NONE of the seven cross-cutting fields
// (DEBT-REGISTER §3): `SubAgentExecutorDeps` enumerated infra only.
//
// These pin the config mapping directly (the pure `buildLightRuntimeConfig`), so
// the inheritance is deterministic and drift-visible. The end-to-end path is a
// smoke test in `sub-agent-inheritance.test.ts`; block-mode gate BEHAVIOR is
// pinned in `approval-block-mode-gate.test.ts`.
import { describe, it, expect } from "bun:test";
import { buildLightRuntimeConfig } from "../src/runtime.js";
import type { TaskContract } from "@reactive-agents/core";

const baseOpts = { agentId: "child-1", provider: "test" as const };

describe("buildLightRuntimeConfig — cross-cutting inheritance", () => {
  it("carries taskContract / fabricationGuard / grounding verbatim", () => {
    const contract: TaskContract = {
      deliverables: [{ kind: "answer", description: "the answer" }],
    } as unknown as TaskContract;
    const config = buildLightRuntimeConfig({
      ...baseOpts,
      taskContract: contract,
      fabricationGuard: "block",
      grounding: { mode: "block", tolerance: 0.02 },
    });
    expect(config.taskContract).toBe(contract);
    expect(config.fabricationGuard).toBe("block");
    expect(config.grounding).toEqual({ mode: "block", tolerance: 0.02 });
  });

  it("omits the fields when the parent set none (no inherited constraints)", () => {
    const config = buildLightRuntimeConfig(baseOpts);
    expect(config.taskContract).toBeUndefined();
    expect(config.fabricationGuard).toBeUndefined();
    expect(config.grounding).toBeUndefined();
    expect(config.approvalPolicy).toBeUndefined();
  });

  it("COERCES an inherited approval policy to block mode (a child cannot detach)", () => {
    // The parent may be detach; the child has no durable store, so detach would
    // strand it. Coercion to block is the whole safety story.
    const config = buildLightRuntimeConfig({
      ...baseOpts,
      approvalPolicy: { tools: ["danger_tool"], mode: "detach" },
    });
    expect(config.approvalPolicy?.mode).toBe("block");
    expect(config.approvalPolicy?.tools).toContain("danger_tool");
  });

  it("runs the F2 autofeed so requiresApproval built-ins gate in the child too", () => {
    // Even with an EMPTY named-tools list, the child must gate its dangerous
    // built-ins (shell-execute / code-execute / file-write / docker-execute) —
    // robustness must not depend on the parent having named them.
    const config = buildLightRuntimeConfig({
      ...baseOpts,
      approvalPolicy: { tools: [], mode: "block" },
    });
    const gated = config.approvalPolicy?.tools ?? [];
    // At least one known requiresApproval built-in was folded in.
    expect(gated.length).toBeGreaterThan(0);
    expect(gated).toContain("code-execute");
  });

  it("preserves the parent's onApprove + requireFor through coercion", () => {
    const onApprove = () => true;
    const requireFor = () => true;
    const config = buildLightRuntimeConfig({
      ...baseOpts,
      approvalPolicy: { tools: ["danger_tool"], mode: "detach", onApprove, requireFor },
    });
    expect(config.approvalPolicy?.onApprove).toBe(onApprove);
    expect(config.approvalPolicy?.requireFor).toBe(requireFor);
    expect(config.approvalPolicy?.mode).toBe("block");
  });
});
