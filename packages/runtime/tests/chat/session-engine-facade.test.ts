import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { ReactiveAgents } from "../../src/builder.js";
import { LLMService } from "@reactive-agents/llm-provider";
import { TestLLMService } from "@reactive-agents/llm-provider";
import type { CompletionRequest } from "@reactive-agents/llm-provider";
import type { ChatMessage } from "../../src/chat.js";
import type { SessionOptions } from "../../src/chat.js";
import type { RunHandle } from "../../src/run-controller.js";
import type { AgentStreamEvent } from "../../src/stream-types.js";

type Req = CompletionRequest;

function makeCapturing(captured: Req[]) {
  const base = TestLLMService([{ text: "chat reply" }]);
  return Layer.succeed(
    LLMService,
    LLMService.of({
      ...base,
      complete: (r: Req) => {
        captured.push(r);
        return base.complete(r);
      },
      stream: (r: Req) => {
        captured.push(r);
        return base.stream(r);
      },
    }),
  );
}

describe("session engine facade (engine plan Task 6)", () => {
  it("session({persist:true, id}) round-trips through engine save/load", async () => {
    const agent = await ReactiveAgents.create()
      .withName("rt")
      .withProvider("test")
      .withModel("test-model")
      .withMemory()
      .withReplayLLM(makeCapturing([]))
      .build();
    const s1 = agent.session({ persist: true, id: "custom-rt" });
    const r1 = await s1.chat("hello");
    expect(r1.message).toBeDefined();
    await s1.end();

    const s2 = agent.session({ persist: true, id: "custom-rt" });
    await s2.chat("second");
    const h = s2.history();
    expect(h.length).toBeGreaterThanOrEqual(4);
    expect(h.some((m: ChatMessage) => m.content === "hello")).toBe(true);
    await agent.dispose();
  });

  it("45-turn persisted session windows prompt, no summary, history keeps all", async () => {
    const captured: Req[] = [];
    const agent = await ReactiveAgents.create()
      .withName("win")
      .withProvider("test")
      .withModel("test-model")
      .withMemory()
      .withReplayLLM(makeCapturing(captured))
      .build();
    const sid = "win-sess";
    const s1 = agent.session({ persist: true, id: sid });
    for (let i = 0; i < 45; i++) {
      await s1.chat(`turn ${i}`);
    }
    await s1.end();

    const s2 = agent.session({ persist: true, id: sid });
    captured.length = 0;
    await s2.chat("summarize");
    const req = captured.find((r) =>
      r.messages?.[r.messages.length - 1]?.content?.toString().includes("summarize"),
    );
    const msgs = req?.messages ?? [];
    expect(msgs.length).toBeLessThanOrEqual(41);
    expect(
      msgs.some((m) => String(m.content).startsWith("Summary of earlier conversation:")),
    ).toBe(false);
    const h = s2.history();
    expect(h.length).toBe(92);
    await agent.dispose();
  });

  it("session.runStream yields StreamCompleted and records+persists", async () => {
    const agent = await ReactiveAgents.create()
      .withName("rs")
      .withProvider("test")
      .withModel("test-model")
      .withMemory()
      .withTestScenario([{ text: "streamed reply" }])
      .withReplayLLM(makeCapturing([]))
      .build();
    const sid = "rs-sess";
    const session = agent.session({ persist: true, id: sid });
    const events: AgentStreamEvent[] = [];
    for await (const ev of session.runStream("task", { density: "full" })) {
      events.push(ev);
    }
    expect(events.some((e) => e._tag === "StreamCompleted")).toBe(true);
    expect(session.history().length).toBe(2);

    const s2 = agent.session({ persist: true, id: sid });
    await s2.chat("ping");
    expect(s2.history().length).toBeGreaterThanOrEqual(4);
    await agent.dispose();
  });

  it("onOverflow splicing works through session.chat", async () => {
    const captured: Req[] = [];
    const agent = await ReactiveAgents.create()
      .withName("of")
      .withProvider("test")
      .withModel("test-model")
      .withReplayLLM(makeCapturing(captured))
      .build();
    const overflowCalls: number[] = [];
    const session = agent.session({
      onOverflow: async (dropped) => {
        overflowCalls.push(dropped.length);
        return "summary text";
      },
    });
    for (let i = 0; i < 25; i++) {
      await session.chat(`turn ${i}`);
    }
    captured.length = 0;
    await session.chat("summarize");
    const req = captured.find((r) =>
      r.messages?.[r.messages.length - 1]?.content?.toString().includes("summarize"),
    );
    const msgs = req?.messages ?? [];
    expect(
      msgs.some((m) => String(m.content).startsWith("Summary of earlier conversation:")),
    ).toBe(true);
    expect(overflowCalls.length).toBeGreaterThan(0);
    expect(session.history().length).toBe(52);
    await agent.dispose();
  });

  it("SessionOptions has no persistOnEnd (type pin)", () => {
    // @ts-expect-error — persistOnEnd was removed from SessionOptions
    const opts: SessionOptions = { persistOnEnd: true };
    void opts;
  });
});