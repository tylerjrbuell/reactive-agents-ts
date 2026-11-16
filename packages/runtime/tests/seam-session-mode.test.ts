/**
 * seam: chat session MODE. A session is in `"execute"` (default) or `"plan"`;
 * every turn's run posture is DERIVED from it (plan -> `rails.posture: "plan"`,
 * execute -> absent). A per-turn `posture` option still overrides. Mode is
 * per-session state, holds across turns until changed, and is independent of
 * the `plan-execute` reasoning strategy.
 *
 * Run: bun test packages/runtime/tests/seam-session-mode.test.ts --timeout 15000
 */
import { describe, test, expect } from "bun:test";
import { Layer } from "effect";
import { LLMService, TestLLMService } from "@reactive-agents/llm-provider";
import { ChatEngine } from "../src/chat/engine.js";
import { turnPosture } from "../src/chat/session-mode.js";
import { AgentSession } from "../src/chat.js";
import { ReactiveAgents } from "../src/builder.js";
import type { RunHandle } from "../src/run-controller.js";
import type { AgentStreamEvent } from "../src/stream-types.js";
import type { AgentResult } from "../src/builder/types.js";

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
const drain = async (h: RunHandle) => { for await (const _ of h) void _; };

const make = (mode?: "plan" | "execute") => {
  const toolOpts: Record<string, unknown>[] = [];
  const streamOpts: Record<string, unknown>[] = [];
  const engine = new ChatEngine({
    complete: async () => ({ message: "d" }),
    runTask: async (_i, o) => (toolOpts.push({ ...o }), result),
    runStreamTask: (_i, o) => (streamOpts.push({ ...o }), handle()),
  }, { sessionId: "s", ...(mode ? { mode } : {}) });
  return { engine, toolOpts, streamOpts };
};

describe("seam: session mode derives the turn posture", () => {
  test("turnPosture: explicit wins (even execute), else the mode", () => {
    expect(turnPosture("plan")).toBe("plan");
    expect(turnPosture("execute")).toBe("execute");
    expect(turnPosture("plan", "execute")).toBe("execute");
    expect(turnPosture("execute", "plan")).toBe("plan");
  });

  test("default mode is execute and turns carry no posture key", async () => {
    const t = make();
    expect(t.engine.mode()).toBe("execute");
    await t.engine.turn("a", { useTools: true });
    await drain(t.engine.streamTurn("b"));
    expect("posture" in t.toolOpts[0]!).toBe(false);
    expect("posture" in t.streamOpts[0]!).toBe(false);
  });

  test("setMode(plan) -> next tool + stream turns carry plan; back to execute -> absent", async () => {
    const t = make();
    t.engine.setMode("plan");
    expect(t.engine.mode()).toBe("plan");
    await t.engine.turn("a", { useTools: true });
    await drain(t.engine.streamTurn("b"));
    expect(t.toolOpts[0]!.posture).toBe("plan");
    expect(t.streamOpts[0]!.posture).toBe("plan");
    t.engine.setMode("execute");
    await t.engine.turn("c", { useTools: true });
    await drain(t.engine.streamTurn("d"));
    expect("posture" in t.toolOpts[1]!).toBe(false);
    expect("posture" in t.streamOpts[1]!).toBe(false);
  });

  test("mode persists across turns until changed", async () => {
    const t = make("plan");
    for (const m of ["a", "b", "c"]) await t.engine.turn(m, { useTools: true });
    expect(t.toolOpts.map((o) => o.posture)).toEqual(["plan", "plan", "plan"]);
  });

  test("per-turn posture override wins over the session mode, both ways", async () => {
    const plan = make("plan");
    await plan.engine.turn("a", { useTools: true, posture: "execute" });
    expect("posture" in plan.toolOpts[0]!).toBe(false);
    const exec = make("execute");
    await exec.engine.turn("a", { useTools: true, posture: "plan" });
    expect(exec.toolOpts[0]!.posture).toBe("plan");
    expect(exec.engine.mode()).toBe("execute"); // an override never changes the mode
  });

  test("mode is isolated per session", async () => {
    const a = make(); const b = make();
    a.engine.setMode("plan");
    expect(b.engine.mode()).toBe("execute");
    await b.engine.turn("x", { useTools: true });
    expect("posture" in b.toolOpts[0]!).toBe(false);
  });

  test("a plan turn's prose plan stays in history for the next execute turn", async () => {
    const t = make("plan");
    await t.engine.turn("plan the migration", { useTools: true });
    t.engine.setMode("execute");
    await t.engine.turn("go", { useTools: true });
    expect(t.toolOpts[1]!.history).toEqual([
      expect.objectContaining({ role: "user", content: "plan the migration" }),
      expect.objectContaining({ role: "assistant", content: "ok" }),
    ]);
  });
});

describe("seam: AgentSession public mode API", () => {
  test("mode getter + setMode + SessionOptions.mode on a live agent session", async () => {
    const agent = await ReactiveAgents.create().withName("mode").withProvider("test").withModel("test-model")
      .withTestScenario([{ text: "FINAL ANSWER: ok" }]).build();
    try {
      const s = agent.session();
      expect(s.mode).toBe("execute");
      s.setMode("plan");
      expect(s.mode).toBe("plan");
      expect(agent.session({ mode: "plan" }).mode).toBe("plan");
      expect(agent.session().mode).toBe("execute"); // new session, own mode
    } finally { await agent.dispose(); }
  });

  test("legacy chatFn session: plan mode forwards posture plan; per-turn override wins", async () => {
    const seen: (string | undefined)[] = [];
    const s = new AgentSession(async (_m, _h, o) => (seen.push(o?.posture), { message: "r" }));
    s.setMode("plan");
    await s.chat("a");
    await s.chat("b", { posture: "execute" });
    expect(seen).toEqual(["plan", "execute"]);
  });
});

describe("seam: plan mode reaches the live request (empty tool surface)", () => {
  type Req = import("@reactive-agents/llm-provider").CompletionRequest;
  const run = async (mode: "plan" | "execute") => {
    const captured: Req[] = [];
    const base = TestLLMService([{ text: "FINAL ANSWER: one" }, { text: "FINAL ANSWER: two" }]);
    const layer = Layer.succeed(LLMService, LLMService.of({
      ...base, complete: (r) => (captured.push(r), base.complete(r)), stream: (r) => (captured.push(r), base.stream(r)),
    }));
    const agent = await ReactiveAgents.create().withName("mode-live").withProvider("test").withModel("test-model")
      .withReasoning().withTools().withReplayLLM(layer).withRequiredTools({ adaptive: false }).withMaxIterations(4).build();
    try {
      const s = agent.session();
      s.setMode(mode);
      await s.chat("go", { useTools: true });
    } finally { await agent.dispose(); }
    return captured;
  };
  test("plan: no tool schemas offered; execute: tools offered (vacuity guard)", async () => {
    const exec = await run("execute");
    expect(exec.some((r) => (r.tools?.length ?? 0) > 0)).toBe(true);
    const plan = await run("plan");
    expect(plan.length).toBeGreaterThan(0);
    expect(plan.every((r) => (r.tools?.length ?? 0) === 0)).toBe(true);
  }, 30000);
});
