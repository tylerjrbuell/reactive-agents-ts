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
    // Behavioral proof: two custom tools are REGISTERED, but only one is in
    // allowedTools. The model (scripted) calls BOTH. The allowedTools execution
    // gate must let the allowed one run and BLOCK the other — gutting the gate
    // to a no-op would let `blocked-probe` run and turn this test RED.
    let allowedRan = false;
    let blockedRan = false;

    const agent = await ReactiveAgents.create()
      .withName("restricted-agent")
      .withProvider("test")
      .withTools({
        tools: [
          {
            definition: {
              name: "allowed-probe",
              description: "An allowed probe tool",
              parameters: [],
              source: "function",
              requiresApproval: false,
              riskLevel: "low",
              timeoutMs: 5000,
            } as any,
            handler: () =>
              Effect.sync(() => {
                allowedRan = true;
                return { ok: "allowed-ran" };
              }),
          },
          {
            definition: {
              name: "blocked-probe",
              description: "A disallowed probe tool",
              parameters: [],
              source: "function",
              requiresApproval: false,
              riskLevel: "low",
              timeoutMs: 5000,
            } as any,
            handler: () =>
              Effect.sync(() => {
                blockedRan = true;
                return { ok: "blocked-ran" };
              }),
          },
        ],
        // Only the allowed probe is permitted.
        allowedTools: ["allowed-probe"],
      })
      .withTestScenario([
        { toolCall: { name: "allowed-probe", args: {} } },
        { toolCall: { name: "blocked-probe", args: {} } },
        { text: "Done." },
      ])
      .withMaxIterations(4)
      .build();

    const result = await agent.run("Use both probes");

    // The allowed tool actually executed; the disallowed tool was gated.
    expect(allowedRan).toBe(true);
    expect(blockedRan).toBe(false);
    expect(result.success).toBe(true);

    await agent.dispose();
  });

  it("no allowedTools = all built-in tools available (backward compat)", async () => {
    const agent = await ReactiveAgents.create()
      .withName("full-tools-agent")
      .withTools()
      .withTestScenario([{ text: "All tools available." }])
      .build();

    const result = await agent.run("What tools?");
    expect(result.success).toBe(true);
  });

  it("empty allowedTools array = all tools available (no filtering)", async () => {
    // Empty array should not activate filtering
    const agent = await ReactiveAgents.create()
      .withName("empty-filter-agent")
      .withTools({ allowedTools: [] })
      .withTestScenario([{ text: "All tools." }])
      .build();

    const result = await agent.run("List tools");
    expect(result.success).toBe(true);
  });

  it("allowedTools works with custom tools", async () => {
    const agent = await ReactiveAgents.create()
      .withName("custom-filtered")
      .withTools({
        tools: [
          {
            definition: {
              name: "my-custom-tool",
              description: "A custom tool",
              parameters: [],
              source: "function",
              requiresApproval: false,
              riskLevel: "low",
              timeoutMs: 5000,
            } as any,
            handler: () => Effect.succeed({ result: "custom result" }),
          },
          {
            definition: {
              name: "another-tool",
              description: "Another custom tool",
              parameters: [],
              source: "function",
              requiresApproval: false,
              riskLevel: "low",
              timeoutMs: 5000,
            } as any,
            handler: () => Effect.succeed({ result: "another result" }),
          },
        ],
        // Only allow the custom tool, not the other one or built-ins
        allowedTools: ["my-custom-tool"],
      })
      .withTestScenario([{ text: "Done with custom." }])
      .build();

    const result = await agent.run("Use custom tool");
    expect(result.success).toBe(true);
  });
});

describe("Sub-agent tool filtering — withAgentTool", () => {
  it("static sub-agent with tools config should build", async () => {
    const agent = await ReactiveAgents.create()
      .withName("parent-agent")
      .withTools()
      .withReasoning()
      .withAgentTool("researcher", {
        name: "Research Agent",
        description: "Searches the web",
        tools: ["web-search"],
        maxIterations: 3,
      })
      .withTestScenario([{ text: "Delegated to researcher." }])
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
      .withTools()
      .withReasoning()
      .withDynamicSubAgents({ maxIterations: 3 })
      .withTestScenario([{ text: "Spawned a sub-agent." }])
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
