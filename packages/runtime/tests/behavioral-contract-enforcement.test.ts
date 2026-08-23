/**
 * Behavioral Contract Enforcement Tests
 *
 * Verifies that `.withBehavioralContracts({...})` is genuinely enforced by
 * the REAL production kernel arm — not the (now-deleted) inline direct-LLM
 * loop.
 *
 * REDESIGN NOTE (2026-08-23, Move 1 dead-arm removal follow-up): the prior
 * version of this file drove `BehavioralContractService.checkToolCall` /
 * `checkIteration` directly by exercising the dead inline agent loop (via a
 * mocked bare `LLMService` + `ExecutionEngine.execute()`). Since Move 1
 * (2026-08-13) that arm never runs in production — `ExecutionEngineLive`
 * always routes through the kernel arm when a `ReasoningService` is
 * available (which every real `.build()`'d agent provides). The old
 * assertions therefore proved nothing about production behavior.
 *
 * `checkToolCall`/`checkIteration`/`checkOutput` are no longer called
 * directly from the agent loop at all. Instead
 * `engine/phases/agent-loop/behavioral-contract-bridge.ts` translates each
 * contract field into a mechanism the kernel ALREADY natively enforces
 * (tool allow/deny policy, the iteration cap, the kill switch) or — for
 * `checkOutput`, which has no kernel-native analog — calls the service
 * directly once in the shared post-arm code that sees the final output
 * regardless of which arm ran. This file exercises the REAL kernel arm
 * end-to-end via `.withTestScenario()` + `.withTools()`, proving actual
 * enforcement (not just that a method was called).
 */

import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { ReactiveAgents } from "../src/builder.js";

function makeToolDef(name: string) {
  return {
    name,
    description: `Tool ${name}`,
    parameters: [
      {
        name: "input",
        type: "string" as const,
        description: "Input",
        required: true,
      },
    ],
    riskLevel: "low" as const,
    timeoutMs: 5_000,
    requiresApproval: false,
    source: "function" as const,
  };
}

/** N scripted tool-call turns, each with a DISTINCT arg — the kernel's
 * repetition guard would otherwise cut off identical-args tool-call loops
 * before the behavior under test can be observed. */
function varyingToolTurns(name: string, n: number) {
  return Array.from({ length: n }, (_, i) => ({
    toolCall: { name, args: { input: `call-${i + 1}` } },
  }));
}

function makeTrackedTool(name: string, calls: string[]) {
  return {
    definition: makeToolDef(name),
    handler: (args: Record<string, unknown>) => {
      calls.push(args.input as string);
      return Effect.succeed(`${name} ok: ${args.input}`);
    },
  };
}

describe("Behavioral Contract Enforcement (real kernel arm)", () => {
  describe("deniedTools", () => {
    it("blocks a denied tool call — the tool never silently executes", async () => {
      const calls: string[] = [];
      const agent = await ReactiveAgents.create()
        .withName("bc-denied-tool")
        .withBehavioralContracts({ deniedTools: ["custom-writer"] })
        .withTestScenario(varyingToolTurns("custom-writer", 3))
        .withTools({ tools: [makeTrackedTool("custom-writer", calls)] })
        .build();

      try {
        await agent.run("write a file");
      } finally {
        await agent.dispose();
      }

      // The denied tool is merged into `config.forbiddenTools` (excluded from
      // the prompt-visible schema — the model never even sees it as callable)
      // AND `config.taskContract` (the kernel's own `evaluateToolPolicy` hard
      // gate, defense-in-depth if it were ever attempted anyway). Either
      // mechanism firing means the same observable outcome: the tool must
      // NEVER actually execute — no silent success.
      expect(calls.length).toBe(0);
    }, 15000);

    it("negative: an undenied tool call succeeds normally under the same contract", async () => {
      const calls: string[] = [];
      const agent = await ReactiveAgents.create()
        .withName("bc-denied-tool-negative")
        .withBehavioralContracts({ deniedTools: ["some-other-tool"] })
        .withTestScenario([
          { toolCall: { name: "custom-writer", args: { input: "call-1" } } },
          { text: "FINAL ANSWER: done." },
        ])
        .withTools({ tools: [makeTrackedTool("custom-writer", calls)] })
        .build();

      let result: Awaited<ReturnType<typeof agent.run>> | undefined;
      try {
        result = await agent.run("write a file");
      } finally {
        await agent.dispose();
      }

      expect(result?.success).toBe(true);
      expect(calls.length).toBe(1);
    }, 15000);
  });

  describe("maxIterations (contract tighter than builder cap)", () => {
    function makeFailingLoopTool(name: string, calls: string[]) {
      return {
        definition: makeToolDef(name),
        handler: (args: Record<string, unknown>) => {
          calls.push(args.input as string);
          return Effect.fail(new Error(`${name} always fails`));
        },
      };
    }

    it("the tighter contract cap wins over the builder's own .withMaxIterations()", async () => {
      const calls: string[] = [];
      const agent = await ReactiveAgents.create()
        .withName("bc-max-iter-tighter")
        // Builder cap is generous (5) — the contract's cap of 1 must be the
        // one that actually terminates the run.
        .withMaxIterations(5)
        .withBehavioralContracts({ maxIterations: 1 })
        .withTestScenario(varyingToolTurns("loop-tool", 5))
        .withTools({ tools: [makeFailingLoopTool("loop-tool", calls)] })
        .build();

      let result: Awaited<ReturnType<typeof agent.run>> | undefined;
      let threw = false;
      try {
        result = await agent.run("call the broken tool repeatedly");
      } catch {
        threw = true;
      } finally {
        await agent.dispose();
      }

      // A bare builder throws on terminatedBy:"max_iterations" (pre-Move-1
      // contract, unchanged) — either shape proves the tighter cap fired well
      // before the 5 scripted turns / builder cap would have allowed.
      if (!threw) {
        expect(result!.success).toBe(false);
        expect((result as unknown as { terminatedBy?: string }).terminatedBy).toBe(
          "max_iterations",
        );
      } else {
        expect(threw).toBe(true);
      }
      // The tighter cap (1) must have stopped the run well short of the 5
      // scripted turns / builder cap of 5.
      expect(calls.length).toBeLessThan(5);
    }, 15000);

    it("negative: a run that completes within the tighter cap still succeeds", async () => {
      const agent = await ReactiveAgents.create()
        .withName("bc-max-iter-negative")
        .withMaxIterations(5)
        .withBehavioralContracts({ maxIterations: 1 })
        .withTestScenario([{ text: "FINAL ANSWER: done in one shot." }])
        .build();

      let result: Awaited<ReturnType<typeof agent.run>> | undefined;
      try {
        result = await agent.run("say hello");
      } finally {
        await agent.dispose();
      }

      expect(result?.success).toBe(true);
    }, 15000);
  });

  describe("maxToolCalls (kill-switch bridge)", () => {
    it("aborts partway through via the kill switch — not after unlimited calls", async () => {
      const calls: string[] = [];
      const agent = await ReactiveAgents.create()
        .withName("bc-max-tool-calls")
        // Deliberately NOT calling .withKillSwitch() — the contract must
        // auto-provide it (runtime.ts killSwitchOptLayer widen). If that
        // wiring regresses, this test degrades to "never aborts" and fails
        // via the loop simply exhausting scripted turns without a kill.
        .withMaxIterations(10)
        .withBehavioralContracts({ maxToolCalls: 2 })
        .withTestScenario(varyingToolTurns("counter-tool", 6))
        .withTools({ tools: [makeTrackedTool("counter-tool", calls)] })
        .build();

      let threw = false;
      let message = "";
      try {
        await agent.run("call the tool repeatedly");
      } catch (e) {
        threw = true;
        message = (e as Error).message ?? String(e);
      } finally {
        await agent.dispose();
      }

      expect(threw).toBe(true);
      expect(message.length).toBeGreaterThan(0);
      // Aborted partway — strictly fewer than the 6 scripted calls actually
      // executed. (>= maxToolCalls since the guard trips AFTER the Nth
      // ToolCallCompleted, but well short of unlimited.)
      expect(calls.length).toBeLessThan(6);
    }, 15000);

    it("negative: a run within the cap succeeds normally", async () => {
      const calls: string[] = [];
      const agent = await ReactiveAgents.create()
        .withName("bc-max-tool-calls-negative")
        .withBehavioralContracts({ maxToolCalls: 10 })
        .withTestScenario([
          { toolCall: { name: "counter-tool", args: { input: "call-1" } } },
          { text: "FINAL ANSWER: done." },
        ])
        .withTools({ tools: [makeTrackedTool("counter-tool", calls)] })
        .build();

      let result: Awaited<ReturnType<typeof agent.run>> | undefined;
      try {
        result = await agent.run("call the tool once");
      } finally {
        await agent.dispose();
      }

      expect(result?.success).toBe(true);
      expect(calls.length).toBe(1);
    }, 15000);
  });

  describe("checkOutput (maxOutputLength)", () => {
    it("blocks a final answer that violates the contract — not a clean success", async () => {
      const agent = await ReactiveAgents.create()
        .withName("bc-max-output-length")
        .withBehavioralContracts({ maxOutputLength: 5 })
        .withTestScenario([
          { text: "FINAL ANSWER: this response is far longer than five characters." },
        ])
        .build();

      let threw = false;
      let message = "";
      try {
        await agent.run("say something");
      } catch (e) {
        threw = true;
        message = (e as Error).message ?? String(e);
      } finally {
        await agent.dispose();
      }

      expect(threw).toBe(true);
      expect(message.length).toBeGreaterThan(0);
    }, 15000);

    it("negative: a short final answer within the limit succeeds", async () => {
      const agent = await ReactiveAgents.create()
        .withName("bc-max-output-length-negative")
        .withBehavioralContracts({ maxOutputLength: 500 })
        .withTestScenario([{ text: "FINAL ANSWER: short." }])
        .build();

      let result: Awaited<ReturnType<typeof agent.run>> | undefined;
      try {
        result = await agent.run("say something short");
      } finally {
        await agent.dispose();
      }

      expect(result?.success).toBe(true);
    }, 15000);
  });

  it("normal execution without contracts succeeds (regression guard)", async () => {
    const agent = await ReactiveAgents.create()
      .withName("no-contract-agent")
      .withTestScenario([{ match: "test", text: "Hello from the agent" }])
      .build();

    let result: Awaited<ReturnType<typeof agent.run>> | undefined;
    try {
      result = await agent.run("test task");
    } finally {
      await agent.dispose();
    }
    expect(result?.success).toBe(true);
    expect(result?.output).toBeTruthy();
  }, 15000);
});
