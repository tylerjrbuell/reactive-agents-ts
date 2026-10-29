/**
 * B1: `agent.session({ environment })` wires the ChatEngine's environment
 * capabilities. A change between turns publishes exactly one `EnvironmentChanged`
 * on the agent's EventBus and the notice reaches the run (stream AND tool-chat paths).
 *
 * Run: bun test packages/runtime/tests/session-environment-updates.test.ts --timeout 15000
 */
import { describe, test, expect } from "bun:test";
import { Layer } from "effect";
import { LLMService, TestLLMService } from "@reactive-agents/llm-provider";
import type { AgentEvent } from "@reactive-agents/core";
import { ReactiveAgents } from "../src/builder.js";
import { ENVIRONMENT_UPDATE_HEADER } from "../src/chat/environment-snapshot.js";
import type { SessionOptions } from "../src/chat.js";

type Req = import("@reactive-agents/llm-provider").CompletionRequest;

const build = (captured: Req[]) => {
  const base = TestLLMService([{ text: "FINAL ANSWER: one" }, { text: "FINAL ANSWER: two" }, { text: "FINAL ANSWER: three" }]);
  const layer = Layer.succeed(
    LLMService,
    LLMService.of({ ...base, complete: (r) => (captured.push(r), base.complete(r)), stream: (r) => (captured.push(r), base.stream(r)) }),
  );
  return ReactiveAgents.create().withName("session-env").withProvider("test").withModel("test-model")
    .withReasoning().withReplayLLM(layer).withRequiredTools({ adaptive: false }).withMaxIterations(4).build();
};

const drain = async (s: ReturnType<Awaited<ReturnType<typeof build>>["session"]>, msg: string) => {
  for await (const _ of s.runStream(msg, { density: "full" })) void _;
};
const sawNotice = (rs: Req[]) => rs.some((r) => JSON.stringify([r.messages, r.systemPrompt]).includes(ENVIRONMENT_UPDATE_HEADER));

async function harness(opts: (model: { v: string }) => SessionOptions) {
  const captured: Req[] = [];
  const agent = await build(captured);
  const published: AgentEvent[] = [];
  await agent.subscribe("EnvironmentChanged", (e) => void published.push(e));
  const model = { v: "model-a" };
  return { agent, captured, published, model, session: agent.session(opts(model)) };
}

describe("session({ environment }) — B1 wiring", () => {
  test("model change between turns: one EnvironmentChanged on the bus + notice reaches the run", async () => {
    const h = await harness((m) => ({ environment: () => ({ model: m.v }) }));
    try {
      await drain(h.session, "first");
      expect(h.published).toHaveLength(0);
      const before = h.captured.length;
      h.model.v = "model-b";
      await drain(h.session, "second");
      expect(h.published).toHaveLength(1);
      expect(h.published[0]!._tag).toBe("EnvironmentChanged");
      expect(sawNotice(h.captured.slice(0, before))).toBe(false);
      expect(sawNotice(h.captured.slice(before))).toBe(true);
      await drain(h.session, "third"); // unchanged since turn 2 commit
      expect(h.published).toHaveLength(1);
    } finally { await h.agent.dispose(); }
  }, 30000);

  test("tool-chat path (runTask adapter) delivers the notice too", async () => {
    const h = await harness((m) => ({ environment: () => ({ model: m.v }) }));
    try {
      await h.session.chat("first", { useTools: true });
      const before = h.captured.length;
      h.model.v = "model-b";
      await h.session.chat("second", { useTools: true });
      expect(h.published).toHaveLength(1);
      expect(sawNotice(h.captured.slice(before))).toBe(true);
    } finally { await h.agent.dispose(); }
  }, 30000);

  test("unchanged environment: no event, no notice", async () => {
    const h = await harness((m) => ({ environment: () => ({ model: m.v }) }));
    try {
      await drain(h.session, "first");
      await drain(h.session, "second");
      expect(h.published).toHaveLength(0);
      expect(sawNotice(h.captured)).toBe(false);
    } finally { await h.agent.dispose(); }
  }, 30000);

  test("environmentUpdates:false opts out; no environment source is inert", async () => {
    const h = await harness((m) => ({ environment: () => ({ model: m.v }), environmentUpdates: false }));
    const n = await harness(() => ({}));
    try {
      for (const x of [h, n]) { await drain(x.session, "first"); x.model.v = "model-b"; await drain(x.session, "second"); }
      expect(h.published).toHaveLength(0);
      expect(sawNotice(h.captured)).toBe(false);
      expect(n.published).toHaveLength(0);
    } finally { await h.agent.dispose(); await n.agent.dispose(); }
  }, 30000);

  test("host publishEnvironment overrides the EventBus default", async () => {
    const seen: string[] = [];
    const h = await harness((m) => ({ environment: () => ({ model: m.v }), publishEnvironment: async (e) => void seen.push(e._tag) }));
    try {
      await drain(h.session, "first"); h.model.v = "model-b"; await drain(h.session, "second");
      expect(seen).toEqual(["EnvironmentChanged"]);
      expect(h.published).toHaveLength(0);
    } finally { await h.agent.dispose(); }
  }, 30000);
});
