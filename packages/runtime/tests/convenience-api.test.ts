import { describe, it, expect } from "bun:test";
import { ReactiveAgents } from "../src/index.js";

describe("Convenience API", () => {
  describe("agent.on()", () => {
    it("should subscribe to events with a plain callback", async () => {
      const events: string[] = [];

      const agent = await ReactiveAgents.create()
        .withName("on-agent")
        .withProvider("test")
        .withTestScenario([{ text: "Hello there!" }])
        .build();

      await agent.on("AgentStarted", (event) => {
        events.push(event.agentId);
      });

      await agent.run("Say hello");
      expect(events.length).toBeGreaterThan(0);
    });

    it("should return an unsubscribe function", async () => {
      let callCount = 0;

      const agent = await ReactiveAgents.create()
        .withName("unsub-agent")
        .withProvider("test")
        .withTestScenario([{ text: "First" }])
        .build();

      const unsub = await agent.on("AgentStarted", () => {
        callCount++;
      });

      await agent.run("First run");
      const countAfterFirst = callCount;
      expect(countAfterFirst).toBeGreaterThan(0);

      unsub();
      // After unsub, handler should not fire again
    });
  });
});
