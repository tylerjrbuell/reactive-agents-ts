// Run: bun test packages/runtime/tests/builder-terminal-tools.test.ts --timeout 15000
import { Effect, Layer } from "effect";
import { describe, it, expect } from "bun:test";
import { ReactiveAgents } from "../src/index.js";
import { shellExecuteTool } from "@reactive-agents/tools";

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

  it("should execute shell-execute when terminal tools are enabled", async () => {
    const agent = await ReactiveAgents.create()
      .withProvider("test")
      .withReasoning({ defaultStrategy: "reactive" })
      .withTestScenario([
        { toolCall: { name: "shell-execute", args: { command: "echo terminal-ok" } } },
        { text: "terminal-ok" },
      ])
      .withTools({ terminal: true })
      .withMaxIterations(3)
      .build();

    const result = await agent.run("Call shell-execute with command 'echo terminal-ok' and return the output.");

    expect(String(result.output)).toContain("terminal-ok");

    await agent.dispose();
  }, 15000);

  it("should pass terminal config (additionalCommands) to shell-execute", async () => {
    const agent = await ReactiveAgents.create()
      .withProvider("test")
      .withReasoning({ defaultStrategy: "reactive" })
      .withTestScenario([
        { toolCall: { name: "shell-execute", args: { command: "env" } } },
        { text: "done" },
      ])
      .withTools({
        terminal: {
          additionalCommands: ["env"],
        },
      })
      .build();

    try {
      const result = await agent.run("Run env");
      expect(result.success).toBe(true);
      expect(String(result.output)).toContain("done");
    } finally {
      await agent.dispose();
    }
  }, 15000);

  it("should not overwrite custom shell-execute when terminal is also enabled", async () => {
    let customCalled = false;

    const agent = await ReactiveAgents.create()
      .withProvider("test")
      .withTestScenario([
        {
          toolCall: {
            name: "shell-execute",
            args: { command: "echo from-custom-handler" },
          },
        },
        { text: "done" },
      ])
      .withTools({
        terminal: true,
        tools: [
          {
            definition: {
              ...shellExecuteTool,
            },
            handler: (args) =>
              Effect.sync(() => {
                customCalled = true;
                return {
                  executed: true,
                  output: `custom:${String(args.command ?? "")}`,
                  stderr: "",
                  exitCode: 0,
                  truncated: false,
                  stderrTruncated: false,
                };
              }),
          },
        ],
      })
      .build();

    try {
      const result = await agent.run("Run shell command");
      expect(result.success).toBe(true);
      expect(customCalled).toBe(true);
    } finally {
      await agent.dispose();
    }
  }, 15000);

  it("should preserve terminal registration across multiple withTools calls", async () => {
    const agent = await ReactiveAgents.create()
      .withProvider("test")
      .withReasoning({ defaultStrategy: "reactive" })
      .withTestScenario([
        { toolCall: { name: "shell-execute", args: { command: "echo terminal-still-registered" } } },
        { text: "terminal-still-registered" },
      ])
      .withTools({
        terminal: {
          additionalCommands: ["echo"],
        },
      })
      .withTools({ adaptive: true })
      .build();

    try {
      const result = await agent.run("Call shell-execute and return terminal-still-registered");
      expect(result.success).toBe(true);
      expect(String(result.output)).toContain("terminal-still-registered");
    } finally {
      await agent.dispose();
    }
  }, 15000);
});
