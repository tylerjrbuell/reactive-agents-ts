// Run: bun test packages/runtime/tests/approval-resume-semantic-cache.test.ts
//
// A paused run is NOT an answer — the semantic cache must neither serve it nor
// store it.
//
// Defect (2026-07-22, found dogfooding FORGE): `.withCostTracking()` enables the
// semantic cache. The first run pauses at the approval gate and its pause
// SENTINEL ("Run paused — awaiting human approval.") was cached under the task
// text. `approveRun()` re-executes the SAME task text, so the resume hit the
// cache, skipped reasoning entirely, and returned the stale sentinel — the
// approved tool never ran, and the caller was told the run was finished.
// Reproduced deterministically: with `.withCostTracking()` the gated handler
// executed 0 times after approval; without it, once.
//
// Second consequence of the same store: any later run of the same prompt was
// served the pause sentinel as a completed answer, with no gate at all.
import { describe, it, expect, afterAll } from "bun:test";
import { Effect, Layer } from "effect";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ApprovalDecisionRef } from "@reactive-agents/core";
import { CostService } from "@reactive-agents/cost";
import { ReactiveAgents } from "../src/builder.js";
import { checkSemanticCache } from "../src/engine/phases/agent-loop/cache-check.js";
import type { ExecutionContext, ReactiveAgentsConfig } from "../src/types.js";

const dir = mkdtempSync(join(tmpdir(), "ra-hitl-cache-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function makeAgent(
  onExecute: () => void,
  scenario: unknown[] = [
    { toolCall: { name: "risky-tool", args: { input: "go" } } },
    { text: "Done — the risky thing is done." },
  ],
) {
  return ReactiveAgents.create()
    .withName("hitl-cache")
    .withProvider("test")
    .withTestScenario(scenario as never)
    .withTools({
      tools: [
        {
          definition: {
            name: "risky-tool",
            description: "Mutates state — requires approval.",
            parameters: [
              { name: "input", type: "string" as const, description: "Input", required: true },
            ],
            riskLevel: "high" as const,
            requiresApproval: true,
            timeoutMs: 5_000,
            source: "function" as const,
          },
          handler: () =>
            Effect.sync(() => {
              onExecute();
              return "ran";
            }),
        },
      ],
    })
    .withReasoning({ defaultStrategy: "reactive", enableStrategySwitching: false })
    .withRequiredTools({ adaptive: false })
    // The trigger: cost tracking is what turns the semantic cache on.
    .withCostTracking({ perSession: 0.5, daily: 2 })
    .withMaxIterations(6)
    .withDurableRuns({ dir, checkpointEvery: 1 })
    .withApprovalPolicy({ tools: ["risky-tool"], mode: "detach" })
    .build();
}

describe("durable HITL + semantic cache", () => {
  it("approveRun executes the gated call instead of replaying a cached pause", async () => {
    let executions = 0;
    const agent = await makeAgent(() => {
      executions += 1;
    });

    const paused = await agent.run("do the risky thing");
    expect(paused.status).toBe("awaiting-approval");
    expect(executions).toBe(0);

    const resumed = await agent.approveRun(paused.pendingApproval!.runId);

    // The approved call ran exactly once, and the run no longer reports a pause.
    expect(executions).toBe(1);
    expect(resumed.status).not.toBe("awaiting-approval");
    expect(resumed.output).not.toContain("Run paused");
  }, 30_000);

  it("never serves a stored pause sentinel as a completed answer", async () => {
    let executions = 0;
    // One turn, repeated: both runs answer with the gated call, so the only way
    // the second run can skip the gate is a cache hit on the first run's pause.
    const agent = await makeAgent(
      () => {
        executions += 1;
      },
      [{ toolCall: { name: "risky-tool", args: { input: "go" } } }],
    );

    await agent.run("do the very risky thing");
    // Same prompt again: the gate must fire again, not return the cached pause
    // text as this run's finished answer.
    const second = await agent.run("do the very risky thing");

    expect(executions).toBe(0);
    expect(second.status).toBe("awaiting-approval");
    expect(second.pendingApproval?.toolName).toBe("risky-tool");
  }, 30_000);

  // The store-side guard above keeps a PAUSE out of the cache. This pins the
  // other half at the phase seam: a resume must not consult the cache at all,
  // whatever is in it — with embeddings wired the cache matches on similarity,
  // so a resume can otherwise be served some earlier, merely-similar prompt's
  // answer and never re-enter the kernel.
  describe("cache-check phase — resume bypass", () => {
    const alwaysHit = Layer.succeed(CostService, {
      checkCache: () => Effect.succeed("a previously cached answer"),
      cacheResponse: () => Effect.void,
    } as unknown as typeof CostService.Service);

    const params = {
      config: { enableCostTracking: true } as ReactiveAgentsConfig,
      task: { input: "do the risky thing" } as never,
      ctx: { metadata: {} } as ExecutionContext,
      obs: null,
      isNormal: false,
    };

    it("serves a cache hit on a normal run", async () => {
      const result = await Effect.runPromise(
        checkSemanticCache(params).pipe(Effect.provide(alwaysHit)),
      );
      expect(result.cacheHit).toBe(true);
    });

    it("ignores the cache while an approval decision is being resumed", async () => {
      const result = await Effect.runPromise(
        checkSemanticCache(params).pipe(
          Effect.provide(alwaysHit),
          Effect.locally(ApprovalDecisionRef, {
            gateId: "gate-1",
            status: "approved" as const,
          }),
        ),
      );
      expect(result.cacheHit).toBe(false);
    });
  });
});
