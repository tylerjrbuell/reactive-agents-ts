import { describe, it, expect } from "bun:test";
import { ReactiveAgents } from "../src/builder.js";
import type { AgentStreamEvent } from "../src/stream-types.js";

describe("Streaming integration", () => {
  it("runStream() output matches run() output", async () => {
    const agent = await ReactiveAgents.create()
      .withTestScenario([{ match: "compute", text: "FINAL ANSWER: 42" }])
      .build();

    const runResult = await agent.run("compute");

    const events: AgentStreamEvent[] = [];
    for await (const event of agent.runStream("compute")) {
      events.push(event);
    }
    await agent.dispose();

    const completed = events.find((e) => e._tag === "StreamCompleted");
    expect(completed).toBeDefined();
    expect((completed as any).output).toBe(runResult.output);
  });

  it("stream ends with StreamCompleted on success", async () => {
    const agent = await ReactiveAgents.create()
      .withTestScenario([{ match: "done", text: "FINAL ANSWER: done" }])
      .build();

    const events: AgentStreamEvent[] = [];
    for await (const event of agent.runStream("done")) {
      events.push(event);
    }
    await agent.dispose();

    expect(events.length).toBeGreaterThan(0);
    expect(events[events.length - 1]?._tag).toBe("StreamCompleted");
  });

  it("for-await-of consumes all events", async () => {
    const agent = await ReactiveAgents.create()
      .withTestScenario([{ match: "iter", text: "FINAL ANSWER: works" }])
      .build();

    const events: AgentStreamEvent[] = [];
    for await (const event of agent.runStream("iter")) {
      events.push(event);
    }
    await agent.dispose();

    const completed = events.find((e) => e._tag === "StreamCompleted") as any;
    expect(completed?.output).toContain("works");
  });

  it("withStreaming() sets default density", async () => {
    const agent = await ReactiveAgents.create()
      .withTestScenario([{ match: "x", text: "FINAL ANSWER: y" }])
      .withStreaming({ density: "tokens" })
      .build();

    const events: AgentStreamEvent[] = [];
    for await (const event of agent.runStream("x")) {
      events.push(event);
    }
    await agent.dispose();

    const tags = new Set(events.map((e) => e._tag));
    expect(tags.has("StreamCompleted")).toBe(true);
  });

  it("concurrent runStream calls are independent", async () => {
    // Each agent gets its own scenario cursor, so concurrent calls are truly independent
    const agentA = await ReactiveAgents.create()
      .withTestScenario([{ text: "FINAL ANSWER: alpha" }])
      .build();
    const agentB = await ReactiveAgents.create()
      .withTestScenario([{ text: "FINAL ANSWER: beta" }])
      .build();

    const collect = async (agent: any, input: string) => {
      const all: AgentStreamEvent[] = [];
      for await (const e of agent.runStream(input)) {
        all.push(e);
      }
      return all;
    };

    const [eventsA, eventsB] = await Promise.all([
      collect(agentA, "a"),
      collect(agentB, "b"),
    ]);
    await agentA.dispose();
    await agentB.dispose();

    const completedA = eventsA.find((e) => e._tag === "StreamCompleted") as any;
    const completedB = eventsB.find((e) => e._tag === "StreamCompleted") as any;
    expect(completedA?.output).toContain("alpha");
    expect(completedB?.output).toContain("beta");
  });

  it("TextDelta events arrive with reasoning enabled", async () => {
    const agent = await ReactiveAgents.create()
      .withTestScenario([{ match: "greet", text: "FINAL ANSWER: hello world" }])
      .withReasoning()
      .build();

    const deltas: string[] = [];
    for await (const event of agent.runStream("greet")) {
      if (event._tag === "TextDelta") {
        deltas.push(event.text);
      }
    }
    await agent.dispose();

    // With reasoning, react-kernel streams tokens via StreamingTextCallback
    expect(deltas.length).toBeGreaterThan(0);
  });

  it("StreamCompleted metadata contains taskId and agentId", async () => {
    const agent = await ReactiveAgents.create()
      .withTestScenario([{ match: "meta", text: "FINAL ANSWER: metadata" }])
      .build();

    let completed: AgentStreamEvent | undefined;
    for await (const event of agent.runStream("meta")) {
      if (event._tag === "StreamCompleted") completed = event;
    }
    await agent.dispose();

    expect(completed).toBeDefined();
    expect((completed as any).taskId).toBeDefined();
    expect((completed as any).agentId).toBeDefined();
    expect(typeof (completed as any).taskId).toBe("string");
  });
});
