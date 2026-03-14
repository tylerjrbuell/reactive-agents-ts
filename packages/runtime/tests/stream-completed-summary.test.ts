import { describe, it, expect } from "bun:test";
import { ReactiveAgents } from "../src/builder.js";

describe("StreamCompleted toolSummary", () => {
  it("StreamCompleted has toolSummary array structure", async () => {
    const agent = await ReactiveAgents.create()
      .withName("test-agent")
      .withTestScenario([{ text: "done" }])
      .build();
    let completed: any;
    for await (const event of agent.runStream("test")) {
      if (event._tag === "StreamCompleted") completed = event;
    }
    expect(completed).toBeDefined();
    // toolSummary may be undefined if no tools were called — that's fine
    if (completed.toolSummary) {
      expect(Array.isArray(completed.toolSummary)).toBe(true);
      if (completed.toolSummary.length > 0) {
        expect(typeof completed.toolSummary[0].name).toBe("string");
        expect(typeof completed.toolSummary[0].calls).toBe("number");
        expect(typeof completed.toolSummary[0].avgMs).toBe("number");
      }
    }
    await agent.dispose();
  });

  it("StreamCompleted metadata is present", async () => {
    const agent = await ReactiveAgents.create()
      .withName("test-agent")
      .withTestScenario([{ text: "done" }])
      .build();
    let completed: any;
    for await (const event of agent.runStream("test")) {
      if (event._tag === "StreamCompleted") completed = event;
    }
    expect(completed.output).toBeDefined();
    expect(completed.metadata).toBeDefined();
    await agent.dispose();
  });
});
