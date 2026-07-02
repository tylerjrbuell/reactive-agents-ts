// Run: bun test packages/runtime/tests/builder-approval-policy.test.ts
//
// Durable HITL (Phase D) — builder surface + the detach-requires-durable guard.
import { describe, it, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReactiveAgents } from "../src/builder.js";

describe(".withApprovalPolicy", () => {
  it("detach mode requires .withDurableRuns()", async () => {
    const agent = ReactiveAgents.create()
      .withName("hitl-guard")
      .withTestScenario([{ text: "ok" }])
      .withReasoning()
      .withApprovalPolicy({ tools: ["docker"], mode: "detach" });
    await expect(agent.build()).rejects.toThrow(/withDurableRuns/);
  });

  it("detach mode builds when durable runs are enabled", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ra-hitl-build-"));
    const agent = await ReactiveAgents.create()
      .withName("hitl-ok")
      .withTestScenario([{ text: "ok" }])
      .withReasoning()
      .withDurableRuns({ dir })
      .withApprovalPolicy({ tools: ["docker"], mode: "detach" })
      .build();
    expect(agent).toBeDefined();
    await agent.dispose();
  });

  it("block mode does not require durable runs", async () => {
    const agent = await ReactiveAgents.create()
      .withName("hitl-block")
      .withTestScenario([{ text: "ok" }])
      .withReasoning()
      .withApprovalPolicy({ tools: ["docker"], mode: "block" })
      .build();
    expect(agent).toBeDefined();
    await agent.dispose();
  });

  // F2: the auto-feed runs at config assembly when a policy is present, with the
  // terminal shell tool enabled and a custom requiresApproval tool registered.
  it("assembles with auto-fed requiresApproval tools (terminal + custom)", async () => {
    const { Effect } = await import("effect");
    const agent = await ReactiveAgents.create()
      .withName("hitl-autofeed")
      .withTestScenario([{ text: "ok" }])
      .withReasoning()
      .withTools({
        terminal: true,
        tools: [
          {
            definition: {
              name: "danger-tool",
              description: "does something risky",
              parameters: [],
              returnType: "string",
              category: "custom",
              riskLevel: "high",
              timeoutMs: 1000,
              requiresApproval: true,
              source: "function",
            },
            handler: () => Effect.succeed("ok"),
          },
        ],
      })
      .withApprovalPolicy({ tools: [], mode: "block" })
      .build();
    expect(agent).toBeDefined();
    await agent.dispose();
  });
});
