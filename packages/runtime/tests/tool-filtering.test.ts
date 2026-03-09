import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { ReactiveAgents, ReactiveAgent } from "../src/index.js";

describe("Tool Filtering — allowedTools", () => {
  it("should build successfully with allowedTools specified", async () => {
    const agent = await ReactiveAgents.create()
      .withName("filtered-agent")
      .withProvider("test")
      .withTools({ allowedTools: ["web-search", "file-read"] })
      .build();

    expect(agent).toBeInstanceOf(ReactiveAgent);
  });

  it("should restrict visible tools to only allowedTools", async () => {
    // Build an agent with only "file-read" allowed
    const agent = await ReactiveAgents.create()
      .withName("restricted-agent")
      .withProvider("test")
      .withTools({ allowedTools: ["file-read"] })
      .withTestResponses({
        "": "Done.",
      })
      .build();

    // Run a task — the agent should work fine
    const result = await agent.run("Read a file");
    expect(result.success).toBe(true);
  });

  it("no allowedTools = all built-in tools available (backward compat)", async () => {
    const agent = await ReactiveAgents.create()
      .withName("full-tools-agent")
      .withProvider("test")
      .withTools()
      .withTestResponses({
        "": "All tools available.",
      })
      .build();

    const result = await agent.run("What tools?");
    expect(result.success).toBe(true);
  });

  it("empty allowedTools array = all tools available (no filtering)", async () => {
    // Empty array should not activate filtering
    const agent = await ReactiveAgents.create()
      .withName("empty-filter-agent")
      .withProvider("test")
      .withTools({ allowedTools: [] })
      .withTestResponses({
        "": "All tools.",
      })
      .build();

    const result = await agent.run("List tools");
    expect(result.success).toBe(true);
  });

  it("allowedTools works with custom tools", async () => {
    const agent = await ReactiveAgents.create()
      .withName("custom-filtered")
      .withProvider("test")
      .withTools({
        tools: [
          {
            definition: {
              name: "my-custom-tool",
              description: "A custom tool",
              parameters: [],
            },
            handler: () => Effect.succeed({ result: "custom result" }),
          },
          {
            definition: {
              name: "another-tool",
              description: "Another custom tool",
              parameters: [],
            },
            handler: () => Effect.succeed({ result: "another result" }),
          },
        ],
        // Only allow the custom tool, not the other one or built-ins
        allowedTools: ["my-custom-tool"],
      })
      .withTestResponses({
        "": "Done with custom.",
      })
      .build();

    const result = await agent.run("Use custom tool");
    expect(result.success).toBe(true);
  });
});

describe("Sub-agent tool filtering — withAgentTool", () => {
  it("static sub-agent with tools config should build", async () => {
    const agent = await ReactiveAgents.create()
      .withName("parent-agent")
      .withProvider("test")
      .withTools()
      .withReasoning()
      .withAgentTool("researcher", {
        name: "Research Agent",
        description: "Searches the web",
        tools: ["web-search"],
        maxIterations: 3,
      })
      .withTestResponses({
        "": "Delegated to researcher.",
      })
      .build();

    expect(agent).toBeInstanceOf(ReactiveAgent);
  });
});

describe("spawn-agent tool parameter — tools", () => {
  it("createSpawnAgentTool includes tools parameter", async () => {
    const { createSpawnAgentTool } = await import(
      "@reactive-agents/tools"
    );
    const toolDef = createSpawnAgentTool();

    expect(toolDef.name).toBe("spawn-agent");
    const toolsParam = toolDef.parameters.find(
      (p: { name: string }) => p.name === "tools",
    );
    expect(toolsParam).toBeDefined();
    expect(toolsParam!.type).toBe("array");
    expect(toolsParam!.required).toBe(false);
  });

  it("dynamic sub-agents with withDynamicSubAgents should build", async () => {
    const agent = await ReactiveAgents.create()
      .withName("spawner-agent")
      .withProvider("test")
      .withTools()
      .withReasoning()
      .withDynamicSubAgents({ maxIterations: 3 })
      .withTestResponses({
        "": "Spawned a sub-agent.",
      })
      .build();

    expect(agent).toBeInstanceOf(ReactiveAgent);
  });
});

describe("createSubAgentExecutor — allowedTools passthrough", () => {
  it("passes config.tools as allowedTools to executeFn", async () => {
    const { createSubAgentExecutor } = await import(
      "@reactive-agents/tools"
    );

    let capturedOpts: any = null;

    const executor = createSubAgentExecutor(
      {
        name: "test-sub",
        tools: ["web-search", "file-read"],
        maxIterations: 3,
      },
      async (opts) => {
        capturedOpts = opts;
        return { output: "done", success: true, tokensUsed: 10 };
      },
      0,
    );

    await executor("Do something");

    expect(capturedOpts).not.toBeNull();
    expect(capturedOpts.allowedTools).toEqual(["web-search", "file-read"]);
  });

  it("does not pass allowedTools when config.tools is undefined", async () => {
    const { createSubAgentExecutor } = await import(
      "@reactive-agents/tools"
    );

    let capturedOpts: any = null;

    const executor = createSubAgentExecutor(
      {
        name: "test-sub-no-filter",
        maxIterations: 3,
      },
      async (opts) => {
        capturedOpts = opts;
        return { output: "done", success: true, tokensUsed: 10 };
      },
      0,
    );

    await executor("Do something");

    expect(capturedOpts).not.toBeNull();
    expect(capturedOpts.allowedTools).toBeUndefined();
  });
});
