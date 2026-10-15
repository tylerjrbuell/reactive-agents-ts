// Run: bun test packages/reasoning/src/kernel/capabilities/act/delegation-envelope-live-path.test.ts --timeout 15000
//
// Wave 5.3 live-path pin: a delegation tool result (`spawn-agent` returning a
// SubAgentResult with a stamped envelope) must reach the observation step's
// metadata through the PRODUCTION primitive (`executeToolAndObserve` →
// `executeNativeToolCall`), not just through `executeToolCall` (which has no
// production callers). Cut the `childEnvelopes` threading from either seam
// and the parent terminal never sees the child — delegation laundering
// reopens while every unit pin stays green.
import { describe, expect, it } from "bun:test";
import { Effect, Option } from "effect";
import { executeToolAndObserve } from "./tool-observe.js";
import type { ToolServiceInstance } from "../../state/kernel-state.js";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";

const scenario = () => TestLLMServiceLayer([{ text: "ok" }]);

// Narrow structural double of the kernel's ToolServiceInstance (no Layer,
// no casts — the interface is small enough to implement directly).
const svcReturning = (result: unknown): ToolServiceInstance => ({
  execute: () => Effect.succeed({ success: true, result }),
  getTool: () => Effect.succeed({ parameters: [] }),
  listTools: () => Effect.succeed([]),
});

describe("5.3 live path — delegation envelopes reach the observation step", () => {
  it("stamps childEnvelopes on the obsStep via executeToolAndObserve", async () => {
    const svc = svcReturning({
      subAgentName: "researcher",
      success: false,
      summary: "ran out of budget",
      tokensUsed: 100,
      completionStatus: "partial",
      budgetTerminalPartial: true,
    });
    const result = await Effect.runPromise(
      executeToolAndObserve(
        Option.some(svc),
        { toolName: "spawn-agent", args: { task: "research" } },
        { iteration: 0, phase: "act", strategy: "reactive", state: {} as never, callId: "c1" },
        {},
      ).pipe(Effect.provide(scenario())),
    );
    const stamped = result.obsStep.metadata?.observationResult?.childEnvelopes;
    expect(stamped).toBeDefined();
    expect(stamped).toEqual([{ completionStatus: "partial", budgetTerminalPartial: true }]);
  });

  it("ordinary tools leave childEnvelopes absent (byte-identical)", async () => {
    const svc = svcReturning({ data: "x" });
    const result = await Effect.runPromise(
      executeToolAndObserve(
        Option.some(svc),
        { toolName: "file-read", args: {} },
        { iteration: 0, phase: "act", strategy: "reactive", state: {} as never, callId: "c2" },
        {},
      ).pipe(Effect.provide(scenario())),
    );
    expect(result.obsStep.metadata?.observationResult?.childEnvelopes).toBeUndefined();
  });
});
