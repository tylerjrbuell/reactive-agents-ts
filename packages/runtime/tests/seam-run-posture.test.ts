/**
 * seam: run posture (plan-mode P1). `posture: "plan"` is carried per turn through
 * the ChatEngine (tool + stream paths), the session send options, the task context
 * and `buildRunEnvelopeFromConfig` onto `envelope.rails.posture`. Absent/"execute"
 * ⇒ the key is ABSENT everywhere (request bytes identical to today).
 *
 * Run: bun test packages/runtime/tests/seam-run-posture.test.ts --timeout 15000
 */
import { describe, test, expect } from "bun:test";
import { Context, Layer, ManagedRuntime } from "effect";
import { LLMService, TestLLMService } from "@reactive-agents/llm-provider";
import type { RunPosture } from "@reactive-agents/core";
import { ChatEngine } from "../src/chat/engine.js";
import { buildRunEnvelopeFromConfig } from "../src/engine/run-envelope-config.js";
import { turnCarryMetadata, readPosture, planPosture } from "../src/chat/todo-seed.js";
import { makeSessionRunTask } from "../src/agent/chat-capabilities.js";
import { Effect, Schema } from "effect";
import { AgentId, TaskId, type Task, type TaskResult } from "@reactive-agents/core";
import { buildRunTaskEffect } from "../src/agent/run-task-effect.js";
import { ReactiveAgents } from "../src/builder.js";
import type { RunHandle } from "../src/run-controller.js";
import type { AgentStreamEvent } from "../src/stream-types.js";
import type { AgentResult } from "../src/builder/types.js";
import type { ReactiveAgentsConfig } from "../src/types.js";

const DummyTag = Context.GenericTag<{ readonly unused: true }>("PostureSeamDummy");
const railsOf = (e: ReturnType<typeof buildRunEnvelopeFromConfig>): Record<string, unknown> => ({ ...e.rails });
const cfg = {} as ReactiveAgentsConfig;

const result: AgentResult = {
  output: "ok", success: true, taskId: "t", agentId: "a",
  metadata: { duration: 0, cost: 0, tokensUsed: 1, stepsCount: 1 },
};
function handle(): RunHandle {
  async function* g(): AsyncGenerator<AgentStreamEvent> {
    yield { _tag: "StreamCompleted", output: "ok", taskId: "t", metadata: { duration: 0, cost: 0, tokensUsed: 1, stepsCount: 1 } };
  }
  return Object.assign(g(), {
    pause: () => {}, resume: () => {}, stop: () => {}, terminate: () => {}, status: () => "running", inspect: () => undefined,
  });
}

describe("seam: run posture carrier", () => {
  test("planPosture / turnCarryMetadata / readPosture round-trip; execute+absent carry nothing", () => {
    expect(planPosture("plan")).toEqual({ posture: "plan" });
    expect(planPosture("execute")).toEqual({});
    expect(planPosture(undefined)).toEqual({});
    const planTask = { metadata: { tags: [], ...turnCarryMetadata({ posture: "plan" }) } };
    expect(readPosture(planTask)).toBe("plan");
    for (const posture of [undefined, "execute" as RunPosture]) {
      const m = turnCarryMetadata({ posture });
      expect(m).toEqual({});
      expect(readPosture({ metadata: { tags: [], ...m } })).toBeUndefined();
    }
  });

  test("envelope: plan reaches rails.posture (vacuity guard); execute/absent ⇒ key absent, envelope identical", () => {
    const base = buildRunEnvelopeFromConfig(cfg);
    expect(railsOf(buildRunEnvelopeFromConfig(cfg, { posture: "plan" })).posture).toBe("plan");
    expect(buildRunEnvelopeFromConfig(cfg, { posture: "plan", environmentUpdate: "env" }).rails).toMatchObject({ posture: "plan", environmentUpdate: "env" });
    for (const posture of [undefined, "execute" as RunPosture]) {
      const e = buildRunEnvelopeFromConfig(cfg, { posture });
      expect("posture" in railsOf(e)).toBe(false);
      expect(e).toEqual(base);
    }
  });
});

describe("seam: ChatEngine threads posture per turn", () => {
  const make = () => {
    const toolOpts: Record<string, unknown>[] = [];
    const streamOpts: Record<string, unknown>[] = [];
    const completes: unknown[] = [];
    const engine = new ChatEngine({
      complete: async (p) => (completes.push(p), { message: "d" }),
      runTask: async (_i, o) => (toolOpts.push({ ...o }), result),
      runStreamTask: (_i, o) => (streamOpts.push({ ...o }), handle()),
    }, { sessionId: "s" });
    return { engine, toolOpts, streamOpts, completes };
  };
  const drain = async (h: RunHandle) => { for await (const _ of h) void _; };

  test("tool + stream: plan arrives (vacuity guard); execute/absent ⇒ key absent", async () => {
    const t = make();
    await t.engine.turn("a", { useTools: true, posture: "plan" });
    await drain(t.engine.streamTurn("b", { posture: "plan" }));
    expect(t.toolOpts[0]!.posture).toBe("plan");
    expect(t.streamOpts[0]!.posture).toBe("plan");
    for (const posture of [undefined, "execute" as const]) {
      const u = make();
      await u.engine.turn("a", { useTools: true, posture });
      await drain(u.engine.streamTurn("b", { posture }));
      expect("posture" in u.toolOpts[0]!).toBe(false);
      expect("posture" in u.streamOpts[0]!).toBe(false);
    }
  });

  test("direct path has no kernel run: posture accepted, request identical to absent", async () => {
    const a = make(); const b = make();
    await a.engine.turn("hi", { useTools: false, posture: "plan" });
    await b.engine.turn("hi", { useTools: false });
    expect(a.completes).toEqual(b.completes);
  });

  test("makeSessionRunTask forwards plan to run(); omits otherwise", async () => {
    const seen: Record<string, unknown>[] = [];
    const rt = makeSessionRunTask(async (_i, o) => (seen.push({ ...o }), result));
    await rt("x", { history: [], posture: "plan" });
    await rt("x", { history: [], posture: "execute" });
    expect(seen[0]!.posture).toBe("plan");
    expect("posture" in seen[1]!).toBe(false);
  });
});

describe("seam: posture reaches the live run envelope (session send options)", () => {
  type Req = import("@reactive-agents/llm-provider").CompletionRequest;
  const run = async (posture: RunPosture | undefined, stream: boolean) => {
    const captured: Req[] = [];
    const base = TestLLMService([{ text: "FINAL ANSWER: one" }, { text: "FINAL ANSWER: two" }]);
    const layer = Layer.succeed(LLMService, LLMService.of({
      ...base, complete: (r) => (captured.push(r), base.complete(r)), stream: (r) => (captured.push(r), base.stream(r)),
    }));
    const agent = await ReactiveAgents.create().withName("posture").withProvider("test").withModel("test-model")
      .withReasoning().withReplayLLM(layer).withRequiredTools({ adaptive: false }).withMaxIterations(4).build();
    try {
      const s = agent.session();
      if (stream) for await (const _ of s.runStream("go", { density: "full", ...(posture ? { posture } : {}) })) void _;
      else await s.chat("go", { useTools: true, ...(posture ? { posture } : {}) });
    } finally { await agent.dispose(); }
    return JSON.stringify(captured.map((r) => [r.messages, r.systemPrompt]));
  };
  for (const stream of [true, false]) {
    test(`${stream ? "stream" : "tool"} path: execute === absent request bytes`, async () => {
      expect(await run("execute", stream)).toBe(await run(undefined, stream));
    }, 30000);
  }
});

describe("seam: run() task context carries posture (tool path -> envelope source)", () => {
  const taskOf = async (posture?: RunPosture): Promise<Task> => {
    let seen: Task | undefined;
    const tr: TaskResult = {
      taskId: Schema.decodeSync(TaskId)("t"), agentId: Schema.decodeSync(AgentId)("a"), output: "x", success: true,
      metadata: { duration: 0, cost: 0, tokensUsed: 0 }, completedAt: new Date(),
    };
    const runtime: ManagedRuntime.ManagedRuntime<any, never> = ManagedRuntime.make(Layer.succeed(DummyTag, { unused: true }));
    await Effect.runPromise(buildRunTaskEffect({
      agentId: "a", engine: { execute: (t: Task) => (seen = t, Effect.succeed(tr)) }, runtime,
      config: {}, enableTools: false, pendingDebriefs: new Set(), setLastDebrief: () => {},
      setLastRunObservations: () => {}, setLastReasoningSteps: () => {}, buildSchemaSteering: () => "",
    }, "in", posture ? { posture } : undefined));
    return seen!;
  };
  test("plan lands in task.metadata.context and is read back; execute/absent leave no context", async () => {
    const plan = await taskOf("plan");
    expect(plan.metadata?.context?.posture).toBe("plan");
    expect(readPosture(plan)).toBe("plan");
    for (const p of [undefined, "execute" as RunPosture]) {
      const t = await taskOf(p);
      expect(t.metadata?.context).toBeUndefined();
      expect(readPosture(t)).toBeUndefined();
    }
  });
});

describe("seam: plan posture strips contract required tools at the envelope", () => {
  const contract: NonNullable<ReactiveAgentsConfig["taskContract"]> = {
    prompt: "p",
    tools: [
      { kind: "required", name: "web-search" },
      { kind: "available", name: "file-read" },
      { kind: "forbidden", name: "shell-execute" },
    ],
    success: { type: "regex", pattern: "." },
  };
  const c = { taskContract: contract } as ReactiveAgentsConfig;

  test("plan: no required entries reach policy.taskContract; others kept", () => {
    const tc = buildRunEnvelopeFromConfig(c, { posture: "plan" }).policy.taskContract;
    expect(tc?.tools).toEqual([
      { kind: "available", name: "file-read" },
      { kind: "forbidden", name: "shell-execute" },
    ]);
    expect(tc?.prompt).toBe("p");
  });
  test("execute/absent: contract passed through untouched (same reference)", () => {
    for (const posture of [undefined, "execute" as RunPosture]) {
      expect(buildRunEnvelopeFromConfig(c, { posture }).policy.taskContract).toBe(contract);
    }
  });
});

describe("seam: every envelope build site carries the turn posture", () => {
  const dir = new URL("../src/engine/phases/agent-loop/", import.meta.url);
  for (const f of ["reasoning-think.ts", "reasoning-harness-hooks.ts", "verification-think-retry.ts"]) {
    test(`${f} passes readPosture(task) into buildRunEnvelopeFromConfig`, async () => {
      const src = await Bun.file(new URL(f, dir)).text();
      const call = src.slice(src.indexOf("buildRunEnvelopeFromConfig(config"));
      expect(call.slice(0, 600)).toContain("posture: readPosture(task)");
    });
  }
});
