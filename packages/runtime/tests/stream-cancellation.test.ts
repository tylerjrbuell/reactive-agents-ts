import { describe, it, expect } from "bun:test";
import { ReactiveAgents } from "../src/builder.js";

describe("runStream cancellation", () => {
  it("accepts signal option without type error", async () => {
    const agent = await ReactiveAgents.create()
      .withName("test-agent")
      .withProvider("test")
      .withTestResponses({ ".*": "done" })
      .withKillSwitch()
      .build();
    const ctrl = new AbortController();
    // Should not throw on signature
    const stream = agent.runStream("test", { signal: ctrl.signal });
    expect(stream).toBeDefined();
    // Cleanup
    ctrl.abort();
    for await (const _ of stream) { break; }
    await agent.dispose();
  });

  it("already-aborted signal yields StreamCancelled immediately", async () => {
    const agent = await ReactiveAgents.create()
      .withName("test-agent")
      .withProvider("test")
      .withTestResponses({ ".*": "done" })
      .withKillSwitch()
      .build();
    const ctrl = new AbortController();
    ctrl.abort(); // already aborted
    const events: string[] = [];
    for await (const event of agent.runStream("test", { signal: ctrl.signal })) {
      events.push(event._tag);
    }
    expect(events).toContain("StreamCancelled");
    await agent.dispose();
  });

  it("stream without signal works normally", async () => {
    const agent = await ReactiveAgents.create()
      .withName("test-agent")
      .withProvider("test")
      .withTestResponses({ ".*": "hello" })
      .build();
    const events: string[] = [];
    for await (const event of agent.runStream("test")) {
      events.push(event._tag);
    }
    expect(events).toContain("StreamCompleted");
    await agent.dispose();
  });

  it("StreamCancelled includes iterationsCompleted field", async () => {
    const agent = await ReactiveAgents.create()
      .withName("test-agent")
      .withProvider("test")
      .withTestResponses({ ".*": "done" })
      .withKillSwitch()
      .build();
    const ctrl = new AbortController();
    ctrl.abort();
    let cancelled: any;
    for await (const event of agent.runStream("test", { signal: ctrl.signal })) {
      if (event._tag === "StreamCancelled") cancelled = event;
    }
    expect(cancelled).toBeDefined();
    expect(typeof cancelled.iterationsCompleted).toBe("number");
    await agent.dispose();
  });
});
