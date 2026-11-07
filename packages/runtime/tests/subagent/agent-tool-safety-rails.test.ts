// Run: bun test packages/runtime/tests/subagent/agent-tool-safety-rails.test.ts --timeout 30000
//
// A `.withAgentTool()` sub-agent runs under the parent's safety rails: approval
// policy (coerced to block), task contract, fabrication guard and grounding.
// Found 2026-11-06: builder-api.md documented this, but only the dynamic
// `spawn-agent` path threaded the rails. The `.withAgentTool` child ran with
// none of them, so it could call a tool the parent gates without approval.
//
// Both paths now share `inheritedSafetyRails` (sub-agent-executor.ts). The
// `.withAgentTool` child options come from the pure `localAgentRuntimeOptions`
// seam. A `.withAgentTool` child has no scripted scenario of its own, so the
// behavioral pin feeds that seam's output into a real light runtime with a
// scenario added (the same runtime the handler builds).
//
// RED-ON-CUT: drop `...inheritedSafetyRails(deps)` from
// `localAgentRuntimeOptions` and the approval arms fail: the gate is never
// consulted and the gated call runs.
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { Effect, Schema } from "effect";
import type { Task, TaskContract } from "@reactive-agents/core";
import { AgentId, EventBus, generateTaskId } from "@reactive-agents/core";
import type { TestTurn } from "@reactive-agents/llm-provider";
import { buildLightRuntimeConfig, createLightRuntime } from "../../src/runtime.js";
import { ExecutionEngine } from "../../src/execution-engine.js";
import { localAgentRuntimeOptions } from "../../src/builder/build-effect/local-agent-tools.js";
import {
  inheritedSafetyRails,
  type ParentSafetyRails,
} from "../../src/builder/build-effect/sub-agent-executor.js";

const subAgent = { name: "helper", tools: ["file-read"], maxIterations: 6 } as const;
const call = { childAgentId: "sub-helper-1", systemPrompt: "You are a helper." } as const;

/** The child reads one file, then answers. `file-read` is the tool the parent gates. */
const childTurns: TestTurn[] = [
  { toolCall: { name: "file-read", args: { path: "package.json" } } },
  { text: "FINAL ANSWER: done" },
];

/**
 * Build the `.withAgentTool` child's runtime from the real options seam, run it,
 * and return how many `file-read` calls ran successfully. The kernel announces a
 * call (`ToolCallStarted`) before the approval gate decides, so a successful
 * `ToolCallCompleted` is the signal that the call executed.
 */
const runChild = async (rails: ParentSafetyRails): Promise<number> => {
  const options = localAgentRuntimeOptions(subAgent, rails, call);
  const runtime = createLightRuntime({ ...options, testScenario: childTurns });
  const task: Task = {
    id: generateTaskId(),
    agentId: Schema.decodeSync(AgentId)(call.childAgentId),
    type: "query",
    input: { question: "Read package.json." },
    priority: "medium",
    status: "pending",
    metadata: { tags: [] },
    createdAt: new Date(),
  };
  const ran: string[] = [];
  await Effect.runPromise(
    Effect.gen(function* () {
      const bus = yield* EventBus;
      yield* bus.on("ToolCallCompleted", (e) =>
        Effect.sync(() => {
          if (e.toolName === "file-read" && e.success) ran.push(e.callId);
        }),
      );
      const engine = yield* ExecutionEngine;
      yield* Effect.either(engine.execute(task));
    }).pipe(Effect.provide(runtime)),
  );
  return ran.length;
};

describe(".withAgentTool sub-agents inherit the parent's safety rails", () => {
  it("CONTROL: with no parent approval policy the child's file-read runs", async () => {
    // If this is 0 the probe is invalid: the scenario never dispatched.
    expect(await runChild({})).toBeGreaterThan(0);
  }, 30_000);

  it("a parent approval policy gates the child's tool (block mode, decider consulted, call refused)", async () => {
    let asked = 0;
    const ran = await runChild({
      parentApprovalPolicy: {
        tools: ["file-read"],
        mode: "detach",
        onApprove: () => {
          asked += 1;
          return { approve: false, reason: "parent says no" };
        },
      },
    });
    expect(asked).toBeGreaterThan(0);
    expect(ran).toBe(0);
  }, 30_000);

  it("a parent block policy with no onApprove denies the child's gated call (deny-by-default)", async () => {
    expect(await runChild({ parentApprovalPolicy: { tools: ["file-read"], mode: "block" } })).toBe(0);
  }, 30_000);

  it("task contract, fabrication guard and grounding reach the child config", () => {
    const contract: TaskContract = {
      prompt: "the answer",
      tools: [{ kind: "required", name: "final-answer" }],
      success: { type: "regex", pattern: "answer" },
    };
    const config = buildLightRuntimeConfig(
      localAgentRuntimeOptions(
        subAgent,
        {
          parentTaskContract: contract,
          parentFabricationGuard: "block",
          parentGrounding: { mode: "block", tolerance: 0.02 },
          parentApprovalPolicy: { tools: ["file-read"], mode: "detach" },
        },
        call,
      ),
    );
    expect(config.taskContract).toBe(contract);
    expect(config.fabricationGuard).toBe("block");
    expect(config.grounding).toEqual({ mode: "block", tolerance: 0.02 });
    expect(config.approvalPolicy?.mode).toBe("block");
    expect(config.approvalPolicy?.tools).toContain("file-read");
  });

  it("a parent with no rails gives the child none", () => {
    const config = buildLightRuntimeConfig(localAgentRuntimeOptions(subAgent, {}, call));
    expect(config.taskContract).toBeUndefined();
    expect(config.fabricationGuard).toBeUndefined();
    expect(config.grounding).toBeUndefined();
    expect(config.approvalPolicy).toBeUndefined();
    expect(inheritedSafetyRails({})).toEqual({});
  });

  it("wiring: both sub-agent kinds take the rails from one parentRails value", () => {
    // The registration call site is not scriptable end to end (a `.withAgentTool`
    // child has no scenario), so the threading is pinned at the source.
    const reg = readFileSync(new URL("../../src/builder/build-effect/tool-mcp-registrations.ts", import.meta.url), "utf8");
    expect(reg.match(/\.\.\.parentRails,/g)?.length).toBe(2);
    const local = readFileSync(new URL("../../src/builder/build-effect/local-agent-tools.ts", import.meta.url), "utf8");
    expect(local).toContain("createLightRuntime(\n          localAgentRuntimeOptions(agentCfg, deps, {");
    expect(local).toContain("...inheritedSafetyRails(deps),");
    const exec = readFileSync(new URL("../../src/builder/build-effect/sub-agent-executor.ts", import.meta.url), "utf8");
    expect(exec).toContain("...inheritedSafetyRails(deps),");
  });
});
