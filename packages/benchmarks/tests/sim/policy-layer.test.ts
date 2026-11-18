// Run: bun run repo test packages/benchmarks/tests/sim/policy-layer.test.ts
// Phase Z: the purpose-routed policy layer. Zero tokens.
import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import { LLMService, TestLLMService } from "@reactive-agents/llm-provider";
import { ReactiveAgents } from "@reactive-agents/runtime";
import { makeRng, policyLLMLayer, requestTokens } from "../../src/sim/policy-model.js";

const msgs = [{ role: "user" as const, content: "hello" }];

describe("policyLLMLayer", () => {
  it("builder: withReplayLLM(policy layer) drives a full agent run", async () => {
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
  }, 30000);

  it("a harness call never consumes the agent script (classifier-peek immunity)", async () => {
    const static_ = TestLLMService([{ text: "CLASSIFIER-EATS-ME" }, { text: "SECOND" }]);
    const eaten = await Effect.runPromise(static_.complete({ messages: msgs, purpose: "classify" }));
    expect(eaten.content).toBe("CLASSIFIER-EATS-ME"); // the static layer's defect
    const p = policyLLMLayer((_req, ctx) => ({ text: `AGENT-${ctx.agentTurn}` }), 1);
    const out = await Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        const h = yield* llm.complete({ messages: msgs, purpose: "classify" });
        const a = yield* llm.complete({ messages: msgs, purpose: "think" });
        return { h: h.content, a: a.content };
      }).pipe(Effect.provide(p.layer)),
    );
    expect(out).toEqual({ h: "{}", a: "AGENT-0" });
    expect(p.calls.map((c) => c.channel)).toEqual(["harness", "agent"]);
  });

  it("usage is derived from the request: history and tool schemas count", async () => {
    const p = policyLLMLayer(() => ({ text: "ok" }), 1);
    const small = { messages: msgs, purpose: "think" as const };
    const big = {
      messages: [...msgs, { role: "assistant" as const, content: "x".repeat(400) }],
      tools: [{ name: "t", description: "d".repeat(200), inputSchema: {} }],
      purpose: "think" as const,
    };
    const usage = await Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        return { s: (yield* llm.complete(small)).usage, b: (yield* llm.complete(big)).usage };
      }).pipe(Effect.provide(p.layer)),
    );
    const [sIn, bIn, bOut] = [usage.s.inputTokens ?? 0, usage.b.inputTokens ?? 0, usage.b.outputTokens ?? 0];
    expect(sIn).toBe(requestTokens(small));
    expect(bIn).toBe(requestTokens(big));
    expect(bIn).toBeGreaterThan(sIn + 100);
    expect(usage.b.totalTokens).toBe(bIn + bOut);
  });

  it("same seed gives an identical stream and request log; another seed differs", async () => {
    const run = async (seed: number) => {
      const p = policyLLMLayer((_req, ctx) => ({ text: `r=${ctx.rng().toFixed(6)}` }), seed);
      await Effect.runPromise(
        Effect.gen(function* () {
          const llm = yield* LLMService;
          yield* llm.complete({ messages: msgs, purpose: "think" });
          yield* llm.complete({ messages: msgs, purpose: "think" });
        }).pipe(Effect.provide(p.layer)),
      );
      return p.calls.map((c) => JSON.stringify(c.turn)).join("|");
    };
    expect(await run(5)).toBe(await run(5));
    expect(await run(5)).not.toBe(await run(6));
    expect(makeRng(9)()).toBe(makeRng(9)());
  });
});
