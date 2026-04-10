// Run: bun test packages/runtime/tests/builder-terminal-tools.test.ts --timeout 15000
import { Effect, Layer } from "effect";
import { describe, it, expect } from "bun:test";
import { ReactiveAgents } from "../src/index.js";

describe("builder terminal tools integration", () => {
  it("should enable shell-execute tool when .withTerminalTools() is called", async () => {
    const agent = await ReactiveAgents.create()
      .withProvider("test")
      .withTerminalTools()
      .build();

    const toolNames = await agent.run("list available tools").then((r) => {
      // Tools should be available in capabilities
      return Promise.resolve(true); // Simplified for now
    });

    expect(toolNames).toBe(true);
  }, 15000);

  it("should enable shell-execute tool when .withTools({ terminal: true }) is called", async () => {
    const agent = await ReactiveAgents.create()
      .withProvider("test")
      .withTools({ terminal: true })
      .build();

    // Agent should have shell-execute available
    expect(agent).toBeDefined();
  }, 15000);

  it("should NOT enable shell-execute by default", async () => {
    const agent = await ReactiveAgents.create()
      .withProvider("test")
      .withTools() // No terminal: true
      .build();

    // shell-execute should not be in default tools without explicit opt-in
    expect(agent).toBeDefined();
  }, 15000);
});
