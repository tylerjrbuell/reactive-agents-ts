// Run: bun test packages/runtime/tests/subagent/inheritance-dispatch.test.ts --timeout 30000
//
// Cross-cutting inheritance (2026-07-23) — end-to-end smoke test that a parent
// carrying the judgment + safety constraints (fabricationGuard, contract,
// grounding, approvalPolicy) still dispatches a sub-agent cleanly through the
// REAL spawn path. The config-mapping detail is unit-pinned in
// `sub-agent-light-config.test.ts`; this guards that the threading additions
// (SubAgentExecutorDeps → createLightRuntime) do not break the live dispatch,
// and that a detach parent policy does NOT strand the child (block coercion).
import { describe, expect, it } from "bun:test";
import type { AgentEvent } from "@reactive-agents/core";
import { ReactiveAgents } from "../../src/index.js";

describe("sub-agent cross-cutting inheritance — live dispatch", () => {
  it("a parent with fabricationGuard + block approval still spawns a child that runs", async () => {
    const childEvents: string[] = [];

    const parent = await ReactiveAgents.create()
      .withName("inherit-parent")
      .withProvider("test")
      .withModel("test-model")
      .withDynamicSubAgents({ maxIterations: 2 })
      .withTools()
      .withFabricationGuard("block")
      .withApprovalPolicy({ tools: ["danger_tool"], mode: "block" })
      .withTestScenario([
        { toolCall: { name: "spawn-agent", args: { task: "summarize the topic", name: "worker" } } },
        { text: "Done." },
      ])
      .build();

    await parent.subscribe((e: AgentEvent) => {
      const withParent = e as AgentEvent & { parentAgentId?: string };
      if (withParent.parentAgentId !== undefined) childEvents.push(e._tag);
    });

    const result = await parent.run("Delegate a summary to a sub-agent.");
    await parent.dispose();

    // The parent completed and the child actually ran on the shared bus — the
    // inheritance threading did not break the detached-runtime dispatch, and the
    // detach→block coercion did not strand the child mid-run.
    expect(result.success).toBe(true);
    expect(childEvents.length).toBeGreaterThan(0);
  }, 30_000);

  it("a DETACH parent policy is coerced so the child does not strand", async () => {
    // The parent uses detach (durable). The child has no durable store; without
    // block coercion it would return a pause sentinel with no resume path and
    // hang the parent's spawn call. This asserts the parent run still completes.
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "ra-inherit-detach-"));

    const parent = await ReactiveAgents.create()
      .withName("inherit-detach-parent")
      .withProvider("test")
      .withModel("test-model")
      .withDynamicSubAgents({ maxIterations: 2 })
      .withTools()
      .withDurableRuns({ dir })
      .withApprovalPolicy({ tools: ["danger_tool"], mode: "detach" })
      .withTestScenario([
        { toolCall: { name: "spawn-agent", args: { task: "summarize", name: "worker" } } },
        { text: "Done." },
      ])
      .build();

    const result = await parent.run("Delegate to a sub-agent.");
    await parent.dispose();

    expect(result.success).toBe(true);
  }, 30_000);
});
