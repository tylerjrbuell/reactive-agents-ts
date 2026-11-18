// Run: bun run repo test packages/benchmarks/tests/sim-spike.test.ts
// S6 spike (wiki/Research/Spikes-2026-11-18-measurement/S6.md). Zero tokens.
import { afterAll, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Effect } from "effect";
import { TestLLMService, LLMService } from "@reactive-agents/llm-provider";
import { ReactiveAgents } from "@reactive-agents/runtime";
import { withFileRoot } from "@reactive-agents/tools";
import { loadRecordedRun } from "@reactive-agents/replay";
import { policyLLMLayer, requestTokens } from "../src/sim/policy-model.js";
import { prefixForkLayer } from "../src/sim/prefix-fork.js";
import { NAMED, UNNAMED, runArm, type ArmResult } from "./sim-spike-shape.js";

const LEAN = "lean_final_turn";

function verdict(off: ArmResult, on: ArmResult): "helps" | "hurts" | "neutral" | "inert" {
  if (on.guardFired === 0) return "inert";
  if (on.solved && !off.solved) return "helps";
  if (!on.solved && off.solved) return "hurts";
  return "neutral";
}

describe("Q1: how a custom LLM layer reaches the harness", () => {
  it("builder: withReplayLLM(policy layer) drives a full agent run (withTestScenario is static only)", async () => {
    const policy = policyLLMLayer(() => ({ text: "The answer is forty-two." }), 1);
    const agent = await ReactiveAgents.create()
      .withProvider("test")
      .withModel("policy")
      .withReasoning({ defaultStrategy: "reactive" })
      .withReplayLLM(policy.layer)
      .build();
    const res = await agent.run("What is the answer?");
    await agent.dispose();
    expect(String(res.output)).toContain("forty-two");
    expect(policy.agentCalls().length).toBeGreaterThan(0);
    // eslint-disable-next-line no-console
    console.log("Q1 builder calls by purpose:", policy.calls.map((c) => c.purpose ?? "none").join(","));
  }, 30000);
});

describe("Q3: classifier peek vs a text-first script", () => {
  it("static TestLLMService: a harness (classify) call eats the first text turn", async () => {
    const svc = TestLLMService([
      { text: "CLASSIFIER-EATS-ME" },
      { toolCall: { name: "gather", args: { q: "x" } } },
      { text: "FINAL" },
    ]);
    const msgs = [{ role: "user" as const, content: "hello" }];
    const harness = await Effect.runPromise(svc.complete({ messages: msgs, purpose: "classify" }));
    const agent = await Effect.runPromise(svc.complete({ messages: msgs, purpose: "think" }));
    expect(harness.content).toBe("CLASSIFIER-EATS-ME");
    // The agent never sees the text-first turn the author scripted for it.
    expect(agent.content).not.toBe("CLASSIFIER-EATS-ME");
    expect(agent.toolCalls?.[0]?.name).toBe("gather");
  });

  it("policy layer: the same harness call gets the harness turn; the agent script is untouched", async () => {
    const p = policyLLMLayer((_req, ctx) => ({ text: `AGENT-${ctx.agentTurn}` }), 1);
    const msgs = [{ role: "user" as const, content: "hello" }];
    const out = await Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        const h = yield* llm.complete({ messages: msgs, purpose: "classify" });
        const a = yield* llm.complete({ messages: msgs, purpose: "think" });
        return { h: h.content, a: a.content };
      }).pipe(Effect.provide(p.layer)),
    );
    expect(out).toEqual({ h: "{}", a: "AGENT-0" });
  });
});

describe("Q2 + Q5: one shape, mechanism off vs on, deterministic", () => {
  it("named inputs: lean turn fires only after both files are read; neutral on outcome, cheaper on tokens", async () => {
    const off = await runArm(NAMED, {}, 7, LEAN);
    const on = await runArm(NAMED, { leanFinalTurn: true }, 7, LEAN);
    // eslint-disable-next-line no-console
    console.log("Q2 named", verdict(off, on), JSON.stringify({ off, on }, (k, v) => (k === "trace" ? undefined : v)));
    expect(off.solved).toBe(true);
    expect(on.solved).toBe(true);
    expect(verdict(off, on)).toBe("neutral");
    expect(on.executed).toEqual(["a.json", "b.json"]); // the gate held the lean turn until both were read
    expect(on.agentInputTokens).toBeLessThan(off.agentInputTokens); // request-derived: tool schemas dropped
  }, 30000);

  it("unnamed inputs: the gate cannot see them, the lean turn fires and the partial reply decides the run", async () => {
    const off = await runArm(UNNAMED, {}, 7, LEAN);
    const on = await runArm(UNNAMED, { leanFinalTurn: true }, 7, LEAN);
    // eslint-disable-next-line no-console
    console.log("Q2 unnamed", verdict(off, on), JSON.stringify({ off, on }, (k, v) => (k === "trace" ? undefined : v)));
    expect(off.solved).toBe(true);
    expect(verdict(off, on)).toBe("hurts");
    expect(on.solved).toBe(false);
    expect(on.guardFired).toBeGreaterThan(0);
    expect(on.toollessAgentTurns).toBeGreaterThan(off.toollessAgentTurns);
    // Request-derived token counts include history and tool schemas.
    expect(off.agentInputTokens).toBeGreaterThan(0);
  }, 30000);

  it("Q5: same seed twice gives an identical request log; Q2 token count reads tool schemas", async () => {
    const a = await runArm(UNNAMED, { leanFinalTurn: true }, 11, LEAN);
    const b = await runArm(UNNAMED, { leanFinalTurn: true }, 11, LEAN);
    expect(a.trace).toBe(b.trace);
    expect(a.output).toBe(b.output);
    const req = { messages: [{ role: "user" as const, content: "x".repeat(40) }] };
    const withTools = { ...req, tools: [{ name: "t", description: "d".repeat(80), inputSchema: {} }] };
    expect(requestTokens(withTools)).toBeGreaterThan(requestTokens(req));
  }, 30000);
});

describe("Q4: prefix-fork from a golden trace", () => {
  const ROOT = join(import.meta.dir, "..", ".bench-run-s6");
  afterAll(() => rmSync(ROOT, { recursive: true, force: true }));

  it("replays call 0 from the recording, substitutes call 1 with a policy; live tools run", async () => {
    rmSync(ROOT, { recursive: true, force: true });
    mkdirSync(ROOT, { recursive: true });
    const run = await loadRecordedRun(join(import.meta.dir, "..", "golden", "tool-write.jsonl"));
    const recordedCalls = run.trace.events.filter((e) => e.kind === "llm-exchange").length;
    const fork = prefixForkLayer(
      run.trace.events,
      1,
      policyLLMLayer(() => ({ text: "SUBSTITUTED: the note is written and done." }), 3).layer,
    );
    const agent = await ReactiveAgents.create()
      .withProvider("test")
      .withModel("fork")
      .withTools({ builtins: ["file-write"], fileRoot: ROOT })
      .withRequiredTools({ tools: ["file-write"] })
      .withReasoning({ defaultStrategy: "reactive" })
      .withMaxIterations(4)
      .withReplayLLM(fork.layer)
      .build();
    const res = await withFileRoot(ROOT, () => agent.run(run.task));
    await agent.dispose();
    const c = fork.counts();
    // eslint-disable-next-line no-console
    console.log("Q4", { recordedCalls, ...c, output: String(res.output), files: readdirSync(ROOT) });
    expect(c.replayed).toBe(1);
    expect(c.substituted).toBeGreaterThan(0);
    expect(String(res.output)).toContain("SUBSTITUTED");
    expect(existsSync(join(ROOT, "note.md"))).toBe(true);
  }, 30000);
});
