// Run: bun test packages/llm-provider/tests/harness-calls-do-not-eat-agent-turns.test.ts
//
// The deterministic provider serves two different callers out of one scenario,
// and they must not take each other's turns.
//
// WHY THIS EXISTS. A harness-internal LLM call — above all the tool-relevance
// classifier, which runs BEFORE the agent's first think and retries on a parse
// failure — used to share the agent's single turn cursor. A classifier attempt
// cannot answer a `toolCall` turn (it reads back as `empty content
// (stopReason=tool_use)` and fails schema decode), but it still CONSUMED one.
// Against any tool-calling scenario the classifier ate the script before the
// agent saw it: `think` reached the trailing text turn, the run terminated
// `end_turn` at a single step having called nothing.
//
// The damage was not a flaky test. It was read as a measurement — "scripted
// tool calls execute on the inline path and not on the kernel path" — and
// written up as a structural kernel defect that made all of Waves D/E/F
// (guards, RunAssessment, Projector, control plane) untestable by deterministic
// cells, sending their verification to expensive, noisy, tier-dependent live
// sweeps. There was no kernel defect. The instrument was eating the script.
//
// So this pins the property directly, at the provider, where the mistake was.
import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import { TestLLMService } from "../src/testing.js";
import type { CompletionRequest } from "../src/types.js";

const AGENT_SCRIPT = [
  { toolCall: { name: "file-write", args: { path: "./a.md", content: "alpha" } } },
  { toolCall: { name: "file-write", args: { path: "./b.md", content: "beta" } } },
  { text: "Done." },
];

const ask = (
  svc: ReturnType<typeof TestLLMService>,
  purpose: CompletionRequest["purpose"],
) =>
  Effect.runPromise(
    svc.complete({
      messages: [{ role: "user", content: "do the work" }],
      ...(purpose ? { purpose } : {}),
    }),
  );

describe("deterministic provider: agent and harness channels", () => {
  it("a harness call does not consume the agent's first tool call", async () => {
    const svc = TestLLMService([...AGENT_SCRIPT]);

    // The classifier fires first, exactly as it does in a real kernel run.
    const classify = await ask(svc, "classify");
    expect(classify.toolCalls ?? []).toEqual([]);

    // The agent's first turn must still be its FIRST scripted tool call. Before
    // the channel split this returned the SECOND one — the classifier had taken
    // `./a.md` and nothing said so.
    const think = await ask(svc, "think");
    expect(think.toolCalls?.[0]?.name).toBe("file-write");
    expect(think.toolCalls?.[0]?.input).toEqual({ path: "./a.md", content: "alpha" });
  });

  it("survives a classifier that retries — the real failure shape", async () => {
    const svc = TestLLMService([...AGENT_SCRIPT]);

    // extractStructuredOutput retries on a decode failure, so the classifier is
    // not one call but several. Each retry used to eat another turn, which is
    // how an entire scenario disappeared before the agent's first think.
    for (let i = 0; i < 3; i++) await ask(svc, "classify");

    const think = await ask(svc, "think");
    expect(think.toolCalls?.[0]?.input).toEqual({ path: "./a.md", content: "alpha" });
  });

  it("the agent still consumes its own turns in order", async () => {
    const svc = TestLLMService([...AGENT_SCRIPT]);

    const first = await ask(svc, "think");
    const second = await ask(svc, "think");
    const third = await ask(svc, "think");

    // The split must not cost the agent its ordinary sequential consumption.
    expect(first.toolCalls?.[0]?.input).toEqual({ path: "./a.md", content: "alpha" });
    expect(second.toolCalls?.[0]?.input).toEqual({ path: "./b.md", content: "beta" });
    expect(third.content).toBe("Done.");
  });

  it("an un-mediated call (no purpose) is the agent — the inline path", async () => {
    const svc = TestLLMService([...AGENT_SCRIPT]);

    // The inline execution path does not go through the kernel gateway, so its
    // requests carry no purpose. Treating those as harness calls would break
    // every inline scenario in the suite.
    const inline = await ask(svc, undefined);
    expect(inline.toolCalls?.[0]?.input).toEqual({ path: "./a.md", content: "alpha" });
  });

  it("a harness call CONSUMES the turn written for it", async () => {
    // The other half of the contract. Skipping agent-only turns must not turn
    // into "harness calls never consume anything" — a scenario that opens with
    // the classifier's own `json` turn has to hand it over and move on, or two
    // successive harness calls would both read it.
    const svc = TestLLMService([
      { json: { required: [], relevant: ["file-write"] } },
      ...AGENT_SCRIPT,
    ]);

    const classify = await ask(svc, "classify");
    expect(JSON.parse(classify.content)).toEqual({ required: [], relevant: ["file-write"] });

    // Consumed: the agent's first turn is still its own first tool call.
    const think = await ask(svc, "think");
    expect(think.toolCalls?.[0]?.input).toEqual({ path: "./a.md", content: "alpha" });
  });
});
