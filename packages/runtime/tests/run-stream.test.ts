import { describe, it, expect } from "bun:test";
import { ReactiveAgents } from "../src/builder.js";
import type { AgentStreamEvent } from "../src/stream-types.js";

describe("ReactiveAgent.runStream", () => {
  it("yields StreamCompleted with the final output", async () => {
    const agent = await ReactiveAgents.create()
      .withProvider("test")
      .withTestResponses({ hello: "FINAL ANSWER: streaming works" })
      .build();

    const events: AgentStreamEvent[] = [];
    for await (const event of agent.runStream("hello")) {
      events.push(event);
    }

    const tags = events.map((e) => e._tag);
    expect(tags).toContain("StreamCompleted");
    const completed = events.find((e) => e._tag === "StreamCompleted");
    expect((completed as any).output).toContain("streaming works");

    await agent.dispose();
  });

  it("last event is always a terminal event", async () => {
    const agent = await ReactiveAgents.create()
      .withProvider("test")
      .withTestResponses({ test: "FINAL ANSWER: done" })
      .build();

    const events: AgentStreamEvent[] = [];
    for await (const event of agent.runStream("test")) {
      events.push(event);
    }

    const last = events[events.length - 1];
    expect(["StreamCompleted", "StreamError"]).toContain(last?._tag);

    await agent.dispose();
  });

  it("run() still works alongside runStream()", async () => {
    const agent = await ReactiveAgents.create()
      .withProvider("test")
      .withTestResponses({ collect: "FINAL ANSWER: collected" })
      .build();

    const result = await agent.run("collect");
    expect(result.output).toContain("collected");
    expect(result.success).toBe(true);

    await agent.dispose();
  });

  it("emits TextDelta events with reasoning enabled", async () => {
    const agent = await ReactiveAgents.create()
      .withProvider("test")
      .withTestResponses({ greet: "FINAL ANSWER: hello world" })
      .withReasoning()
      .build();

    const deltas: string[] = [];
    for await (const event of agent.runStream("greet")) {
      if (event._tag === "TextDelta") {
        deltas.push(event.text);
      }
    }

    // With reasoning enabled, react-kernel streams tokens via StreamingTextCallback
    expect(deltas.length).toBeGreaterThan(0);

    await agent.dispose();
  });

  it("concurrent streams do not interfere", async () => {
    const agent = await ReactiveAgents.create()
      .withProvider("test")
      .withTestResponses({
        first: "FINAL ANSWER: alpha",
        second: "FINAL ANSWER: beta",
      })
      .build();

    const collect = async (input: string) => {
      const events: AgentStreamEvent[] = [];
      for await (const event of agent.runStream(input)) {
        events.push(event);
      }
      return events;
    };

    const [stream1, stream2] = await Promise.all([
      collect("first"),
      collect("second"),
    ]);

    // Both should complete independently
    expect(stream1.some((e) => e._tag === "StreamCompleted")).toBe(true);
    expect(stream2.some((e) => e._tag === "StreamCompleted")).toBe(true);

    await agent.dispose();
  });
});
