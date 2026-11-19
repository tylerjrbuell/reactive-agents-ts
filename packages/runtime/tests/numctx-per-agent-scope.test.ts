// Run: bun test packages/runtime/tests/numctx-per-agent-scope.test.ts --timeout 20000
/**
 * `.withModel(model, { numCtx })` is scoped to the agent that declared it.
 *
 * The builder used to write the declared window into the process-wide
 * capability registry (`registerUserSuppliedCapability`). Nothing cleared that
 * row, so every later agent on the same (provider, model) inherited the first
 * agent's window: in a long-lived server one agent's numCtx resized another's
 * context, and in the root `bun test` process it added ContextPressure chunks
 * to an unrelated stream fixture. These pins hold that:
 *  - agent A (numCtx 8000) streams ContextPressure against an 8000 window,
 *  - agent B (same model id, no numCtx) streams none (fallback window),
 *  - building A leaves no `source: "user"` row in the registry.
 */
import { afterAll, describe, expect, it } from "bun:test";
import { _resetProbedRegistryForTesting, resolveCapability } from "@reactive-agents/llm-provider";
import { ReactiveAgents } from "../src/builder.js";
import type { AgentStreamEvent } from "../src/stream-types.js";

const MODEL = "numctx-per-agent-scope-model";

afterAll(() => _resetProbedRegistryForTesting());

type Pressure = Extract<AgentStreamEvent, { _tag: "ContextPressure" }>;

const buildAgent = (numCtx: number | undefined) =>
  ReactiveAgents.create()
    .withTestScenario([{ text: "FINAL ANSWER: ok" }])
    .withModel(MODEL, numCtx === undefined ? {} : { numCtx })
    .withReasoning({ defaultStrategy: "reactive" })
    .withMaxIterations(2)
    .build();

const pressureChunks = async (numCtx: number | undefined): Promise<Pressure[]> => {
  const agent = await buildAgent(numCtx);
  try {
    const out: Pressure[] = [];
    for await (const e of agent.runStream("numCtx scope", { density: "full" })) {
      if (e._tag === "ContextPressure") out.push(e);
    }
    return out;
  } finally {
    await agent.dispose();
  }
};

describe(".withModel({ numCtx }) is per-agent, never process-global", () => {
  it("agent A sees its own 8000 window; agent B on the same model id does not inherit it", async () => {
    const a = await pressureChunks(8000);
    expect(a.length).toBeGreaterThan(0);
    for (const p of a) expect(p.tokensUsed + p.tokensAvailable).toBe(8000);

    const b = await pressureChunks(undefined);
    expect(b).toEqual([]);
  }, 30000);

  it("building an agent with numCtx writes no user row to the capability registry", async () => {
    const agent = await buildAgent(8000);
    await agent.dispose();
    expect(resolveCapability("test", MODEL).source).not.toBe("user");
  });
});
