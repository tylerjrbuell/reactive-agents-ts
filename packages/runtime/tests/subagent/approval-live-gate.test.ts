// Run: bun test packages/runtime/tests/subagent/approval-live-gate.test.ts --timeout 30000
//
// A sub-agent that calls a gated tool asks the SAME live human gate as its
// parent. Before, a parent `detach` policy was coerced to `block` in the child
// (runtime.ts buildLightRuntimeConfig): with no `onApprove` the child denied
// every gated call, so a person was never asked and the sub-agent failed.
//
// Now the child keeps `detach`, waits on the parent's HumanGate under the ROOT
// run's id (so `approveRun(rootRunId)` and the root stream reach it), and the
// request is labelled with the sub-agent's name. Stop/terminate of the root run
// abandons the child's wait (the controller slot is inherited by the child scope).
//
// RED-ON-CUT:
//  - restore the `"block"` coercion in buildLightRuntimeConfig: the request never
//    appears (the call is denied at once) and the approve case fails.
//  - use `ctx.runId` instead of `ctx.rootRunId` in `liveApprovalDecider`: the
//    request is filed under the child's run id and `answer(rootRunId)` finds nothing.
//  - drop the `subAgent` label: the label assertions fail.
import { describe, expect, it } from "bun:test";
import { Effect, Fiber, Schema } from "effect";
import type { Task } from "@reactive-agents/core";
import { AgentId, EventBus, childContext, generateTaskId, rootContext } from "@reactive-agents/core";
import { bindRun, childRunScope, runControllerSlot, withRunScope } from "@reactive-agents/core/internal/run-scope";
import type { RunControllerLike } from "@reactive-agents/core";
import type { TestTurn } from "@reactive-agents/llm-provider";
import { createLightRuntime } from "../../src/runtime.js";
import { ExecutionEngine } from "../../src/execution-engine.js";
import { HumanGate, makeHumanGate, type HumanGateRequest } from "../../src/engine/human-gate.js";
import { localAgentRuntimeOptions } from "../../src/builder/build-effect/local-agent-tools.js";
import type { ParentSafetyRails } from "../../src/builder/build-effect/sub-agent-executor.js";

const subAgent = { name: "helper", tools: ["file-read"], maxIterations: 6 } as const;
const childAgentId = "sub-helper-stable";
const turns: TestTurn[] = [
  { toolCall: { name: "file-read", args: { path: "package.json" } } },
  { text: "FINAL ANSWER: done" },
];

const rails: ParentSafetyRails = { parentApprovalPolicy: { tools: ["file-read"], mode: "detach" } };

type Approval = Extract<HumanGateRequest, { kind: "approval" }>;

/** Run the sub-agent under a root run, deciding its gated call with `decide`. */
const runWithGate = async (
  decide: "approve" | "deny" | "terminate",
  policy: ParentSafetyRails = rails,
) => {
  const gate = makeHumanGate();
  const root = rootContext("root-run", "parent");
  const child = childContext(root, "helper");
  const aborter = new AbortController();
  const controller: RunControllerLike = { checkpoint: async () => undefined, signal: aborter.signal };
  const ran: string[] = [];
  const seen: Approval[] = [];

  const options = localAgentRuntimeOptions(subAgent, policy, { childAgentId, systemPrompt: "helper" });
  const runtime = createLightRuntime({ ...options, testScenario: turns });
  const task: Task = {
    id: generateTaskId(),
    agentId: Schema.decodeSync(AgentId)(childAgentId),
    type: "query",
    input: { question: "Read package.json." },
    priority: "medium",
    status: "pending",
    metadata: { tags: [] },
    createdAt: new Date(),
  };

  const childRun = Effect.gen(function* () {
    const bus = yield* EventBus;
    yield* bus.on("ToolCallCompleted", (e) =>
      Effect.sync(() => {
        if (e.toolName === "file-read" && e.success) ran.push(e.callId);
      }),
    );
    const engine = yield* ExecutionEngine;
    return yield* Effect.either(engine.execute(task));
  }).pipe(
    Effect.provide(runtime),
    Effect.provideService(HumanGate, gate),
    childRunScope({ ...child, taskId: String(task.id) }),
    withRunScope(root, bindRun(runControllerSlot, controller)),
  );

  const person = Effect.gen(function* () {
    for (let i = 0; i < 400; i++) {
      const pending = (yield* gate.pending()).filter((r): r is Approval => r.kind === "approval");
      if (pending.length > 0) {
        seen.push(...pending);
        if (decide === "terminate") {
          aborter.abort();
          return;
        }
        yield* gate.answer(pending[0]!.runId, {
          kind: "approval",
          approve: decide === "approve",
          reason: decide === "deny" ? "not allowed" : undefined,
        });
        return;
      }
      yield* Effect.sleep("25 millis");
    }
  });

  const personFiber = Effect.runFork(person);
  await Effect.runPromise(childRun);
  await Effect.runPromise(Fiber.await(personFiber));
  return { ran: ran.length, seen, pendingAfter: await Effect.runPromise(gate.pending()) };
};

describe("sub-agent approval goes to the parent's live gate", () => {
  it("asks the gate under the ROOT run id, labelled with the sub-agent; approve runs the tool", async () => {
    const r = await runWithGate("approve");
    expect(r.seen).toHaveLength(1);
    expect(r.seen[0]!.toolName).toBe("file-read");
    expect(r.seen[0]!.runId).toBe("root-run");
    expect(r.seen[0]!.subAgent).toBe("helper");
    expect(r.ran).toBeGreaterThan(0);
    expect(r.pendingAfter).toHaveLength(0);
  }, 30_000);

  it("deny refuses the gated call; the tool never runs", async () => {
    const r = await runWithGate("deny");
    expect(r.seen).toHaveLength(1);
    expect(r.ran).toBe(0);
  }, 30_000);

  it("terminating the root run abandons the child's wait (denied, nothing left pending)", async () => {
    const r = await runWithGate("terminate");
    expect(r.seen).toHaveLength(1);
    expect(r.ran).toBe(0);
    expect(r.pendingAfter).toHaveLength(0);
  }, 30_000);

  it("a parent block policy still decides in process and never asks the gate", async () => {
    const r = await runWithGate("approve", {
      parentApprovalPolicy: { tools: ["file-read"], mode: "block", onApprove: () => ({ approve: false, reason: "no" }) },
    });
    expect(r.seen).toHaveLength(0);
    expect(r.ran).toBe(0);
  }, 30_000);
});
