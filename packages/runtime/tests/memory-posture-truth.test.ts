// Run: bun test packages/runtime/tests/memory-posture-truth.test.ts --timeout 15000
//
// Wave 6.5 — memory posture truth: the capability registry's memory row
// claimed `defaultOn: true` (GH #122 history) while the builder default
// (`_enableMemory: false`) builds stateless agents. The registry is audit
// metadata; when it disagrees with behavior, every audit report built on it
// lies. This pins registry and behavior to the same truth (stateless unless
// opted in) so the two cannot drift apart again.
//
// RED-ON-CUT: flip either side (registry defaultOn back to true, or the
// builder default to memory-on) and an arm fails.
import { describe, expect, it } from "bun:test";
import { ReactiveAgents } from "../src/index.js";
import { bootstrapEntries } from "../src/capabilities/registry.js";

describe("6.5 memory posture truth", () => {
  it("registry memory row agrees with the builder default (stateless)", () => {
    const memory = bootstrapEntries.find((e) => e.name === "memory");
    expect(memory).toBeDefined();
    expect(memory?.defaultOn).toBe(false);
  });

  it("bare build carries no memory layer (run-observable)", async () => {
    const agent = await ReactiveAgents.create()
      .withName("posture-truth")
      .withProvider("test")
      .withTestScenario([{ text: "FINAL ANSWER: done" }])
      .withReasoning({ defaultStrategy: "reactive" })
      .build();
    try {
      const result = await agent.run("simple task");
      expect(result.success).toBe(true);
      expect(result.debrief).toBeUndefined();
    } finally {
      await agent.dispose();
    }
  });

  it("explicit opt-in still enables memory (run-observable)", async () => {
    const agent = await ReactiveAgents.create()
      .withName("posture-truth-optin")
      .withProvider("test")
      .withTestScenario([{ text: "FINAL ANSWER: done" }])
      .withReasoning({ defaultStrategy: "reactive" })
      .withMemory()
      .build();
    try {
      const result = await agent.run("simple task");
      expect(result.success).toBe(true);
      expect(result.debrief).toBeDefined();
    } finally {
      await agent.dispose();
    }
  });
});
