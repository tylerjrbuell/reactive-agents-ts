/**
 * abstention-e2e.test.ts
 *
 * Integration test: verifies that result.abstention reaches the final AgentResult
 * through the full strategy→engine→runtime path when a required tool is not registered.
 *
 * C1 regression guard: before the fix, result.abstention was always undefined even
 * when terminatedBy === "abstained" (two forwarding links dropped the field).
 *
 * Requires .withReasoning() so the reasoning kernel (runner.ts §7.5 harness-forced
 * abstention) is engaged. Without it the minimal-LLM loop runs instead and the kernel
 * is never called.
 *
 * Written RED before the fix (result.abstention undefined), GREEN after.
 *
 * Run: bun test packages/runtime/tests/abstention-e2e.test.ts --timeout 20000
 */
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { ReactiveAgents } from "../src/index.js";

describe("result.abstention e2e — full strategy→engine→runtime path (C1)", () => {
  it(
    "surfaces abstention when required tool is not registered",
    async () => {
      /**
       * Agent registers "available-tool" but REQUIRES "missing-tool-xyz".
       * The harness sees allKnownTools.length > 0 and the required tool absent →
       * decideForcedAbstention fires → state.meta.abstention is set → must reach
       * result.abstention on the AgentResult.
       *
       * .withReasoning() is required to engage the reasoning kernel (runner.ts).
       * Without it the execution-engine uses the minimal-LLM loop which never
       * calls runner.ts and therefore never triggers §7.5 forced abstention.
       */
      const agent = await ReactiveAgents.create()
        .withName("abstention-e2e")
        .withTestScenario([{ text: "I need the missing tool to answer." }])
        .withReasoning({ maxIterations: 1, defaultStrategy: "reactive" })
        .withTools({
          tools: [
            {
              definition: {
                name: "available-tool",
                description: "A tool that is available (not the required one)",
                parameters: [],
                riskLevel: "low" as const,
                timeoutMs: 5_000,
                requiresApproval: false,
                source: "function" as const,
              },
              handler: () => Effect.succeed("ok"),
            },
          ],
        })
        .withRequiredTools({ tools: ["missing-tool-xyz"] })
        .build();

      const result = await agent.run("Do something that requires missing-tool-xyz");
      await agent.dispose();

      // Honest decline terminal
      expect(result.terminatedBy).toBe("abstained");
      expect(result.goalAchieved).toBe(false);

      // C1 invariant: abstention must NOT be undefined
      expect(result.abstention).toBeDefined();
      expect(result.abstention?.reason).toBeTruthy();
      expect(result.abstention?.missing).toContain("tool:missing-tool-xyz");

      // Trust receipt (Arc 1 Task 8): abstained wins over everything on the
      // kernel path too — confidence pinned at 0.95 per the verdict rules.
      expect(result.receipt?.verdict).toBe("abstained");
      expect(result.receipt?.confidence).toBe(0.95);
    },
    20_000,
  );
});
