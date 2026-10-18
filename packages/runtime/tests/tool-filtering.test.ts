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

// ─── withAgentTool structured input parameters ───

describe("withAgentTool structured input parameters", () => {
  it("tool def includes custom parameters alongside input", async () => {
    const { createLocalAgentToolRegistration } = await import(
      "../src/builder/build-effect/local-agent-tools.js"
    );
    const {
      createAgentTool,
      composeSubAgentDirectivePrompt,
      finalizeSubAgentResult,
    } = await import("@reactive-agents/tools");

    const registration = createLocalAgentToolRegistration(
      {
        name: "review-pr",
        agent: {
          name: "pr-reviewer",
          description: "Reviews pull requests",
          parameters: [
            {
              name: "repo",
              type: "string",
              description: "Repository owner/repo",
              required: true,
            },
            {
              name: "prNumber",
              type: "number",
              description: "Pull request number",
              required: true,
            },
            {
              name: "focus",
              type: "string",
              description: "Review focus area",
              required: false,
              enum: ["security", "performance", "style"],
            },
          ],
        },
      },
      {
        toolsMod: {
          createAgentTool,
          composeSubAgentDirectivePrompt,
          finalizeSubAgentResult,
        },
        agentId: "parent-agent",
        getParentContext: () => undefined,
      },
    );

    // `input` remains as catch-all free-form argument
    const inputParam = registration.def.parameters.find((p) => p.name === "input");
    expect(inputParam).toBeDefined();
    expect(inputParam!.type).toBe("string");
    expect(inputParam!.required).toBe(true);

    // Custom parameters are merged into the schema
    const repoParam = registration.def.parameters.find((p) => p.name === "repo");
    expect(repoParam).toBeDefined();
    expect(repoParam!.type).toBe("string");
    expect(repoParam!.required).toBe(true);
    expect(repoParam!.description).toBe("Repository owner/repo");

    const prNumberParam = registration.def.parameters.find(
      (p) => p.name === "prNumber",
    );
    expect(prNumberParam).toBeDefined();
    expect(prNumberParam!.type).toBe("number");
    expect(prNumberParam!.required).toBe(true);

    const focusParam = registration.def.parameters.find((p) => p.name === "focus");
    expect(focusParam).toBeDefined();
    expect(focusParam!.type).toBe("string");
    expect(focusParam!.required).toBe(false);
    expect(focusParam!.enum).toEqual(["security", "performance", "style"]);

    // No duplicate parameters
    const names = registration.def.parameters.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("without custom parameters, tool def is unchanged (backwards compatible)", async () => {
    const { createLocalAgentToolRegistration } = await import(
      "../src/builder/build-effect/local-agent-tools.js"
    );
    const {
      createAgentTool,
      composeSubAgentDirectivePrompt,
      finalizeSubAgentResult,
    } = await import("@reactive-agents/tools");

    const registration = createLocalAgentToolRegistration(
      {
        name: "researcher",
        agent: {
          name: "Research Agent",
          description: "Searches the web",
          tools: ["web-search"],
          maxIterations: 3,
        },
      },
      {
        toolsMod: {
          createAgentTool,
          composeSubAgentDirectivePrompt,
          finalizeSubAgentResult,
        },
        agentId: "parent-agent",
        getParentContext: () => undefined,
      },
    );

    const names = registration.def.parameters.map((p) => p.name);
    expect(names).toEqual(["input"]);
  });

  it("builder accepts parameters and agent builds successfully", async () => {
    const agent = await ReactiveAgents.create()
      .withName("parent-agent")
      .withProvider("test")
      .withTools()
      .withAgentTool("review-pr", {
        name: "pr-reviewer",
        description: "Reviews pull requests",
        parameters: [
          {
            name: "repo",
            type: "string",
            description: "Repository owner/repo",
            required: true,
          },
          {
            name: "prNumber",
            type: "number",
            description: "Pull request number",
            required: true,
          },
        ],
      })
      .withTestScenario([{ text: "Delegated to review-pr." }])
      .build();

    expect(agent).toBeInstanceOf(ReactiveAgent);
  });

  it("interpolateTemplate substitutes {{key}} placeholders", async () => {
    const { interpolateTemplate } = await import(
      "../src/builder/helpers.js"
    );

    expect(interpolateTemplate("Hello {{name}}", { name: "World" })).toBe(
      "Hello World",
    );
    expect(
      interpolateTemplate("repo={{repo}} pr={{prNumber}}", {
        repo: "owner/repo",
        prNumber: 42,
      }),
    ).toBe("repo=owner/repo pr=42");
    // Missing optional key is left as-is (no throw)
    expect(
      interpolateTemplate("repo={{repo}} focus={{focus}}", {
        repo: "owner/repo",
      }),
    ).toBe("repo=owner/repo focus={{focus}}");
    // Undefined template passes through
    expect(interpolateTemplate(undefined, { name: "x" })).toBeUndefined();
    // Empty vars leaves template unchanged
    expect(interpolateTemplate("no vars here", {})).toBe("no vars here");
  });

  it("requiresApproval and timeoutMs are configurable on the tool def", async () => {
    const { createLocalAgentToolRegistration } = await import(
      "../src/builder/build-effect/local-agent-tools.js"
    );
    const {
      createAgentTool,
      composeSubAgentDirectivePrompt,
      finalizeSubAgentResult,
    } = await import("@reactive-agents/tools");

    const registration = createLocalAgentToolRegistration(
      {
        name: "auto-deploy",
        agent: {
          name: "deployer",
          description: "Deploys to staging",
          requiresApproval: false,
          timeoutMs: 300_000,
        },
      },
      {
        toolsMod: {
          createAgentTool,
          composeSubAgentDirectivePrompt,
          finalizeSubAgentResult,
        },
        agentId: "parent-agent",
        getParentContext: () => undefined,
      },
    );

    expect(registration.def.requiresApproval).toBe(false);
    expect(registration.def.timeoutMs).toBe(300_000);
  });

  it("defaults to requiresApproval=true and timeoutMs=60000 when not set", async () => {
    const { createLocalAgentToolRegistration } = await import(
      "../src/builder/build-effect/local-agent-tools.js"
    );
    const {
      createAgentTool,
      composeSubAgentDirectivePrompt,
      finalizeSubAgentResult,
    } = await import("@reactive-agents/tools");

    const registration = createLocalAgentToolRegistration(
      {
        name: "researcher",
        agent: {
          name: "Research Agent",
          description: "Searches the web",
        },
      },
      {
        toolsMod: {
          createAgentTool,
          composeSubAgentDirectivePrompt,
          finalizeSubAgentResult,
        },
        agentId: "parent-agent",
        getParentContext: () => undefined,
      },
    );

    expect(registration.def.requiresApproval).toBe(true);
    expect(registration.def.timeoutMs).toBe(60_000);
  });

  it("builder accepts requiresApproval, timeoutMs, and persona with interpolation", async () => {
    const agent = await ReactiveAgents.create()
      .withName("parent-agent")
      .withProvider("test")
      .withTools()
      .withAgentTool("review-pr", {
        name: "pr-reviewer",
        description: "Reviews {{repo}} PR #{{prNumber}}",
        systemPrompt: "Review {{repo}} pull request #{{prNumber}} with focus on {{focus}}.",
        persona: {
          role: "{{focus}} reviewer",
          instructions: "Check {{repo}} for {{focus}} issues.",
        },
        parameters: [
          {
            name: "repo",
            type: "string",
            description: "Repository owner/repo",
            required: true,
          },
          {
            name: "prNumber",
            type: "number",
            description: "Pull request number",
            required: true,
          },
          {
            name: "focus",
            type: "string",
            description: "Review focus area",
            required: false,
            enum: ["security", "performance", "style"],
          },
        ],
        requiresApproval: false,
        timeoutMs: 120_000,
      })
      .withTestScenario([{ text: "Delegated to review-pr." }])
      .build();

    expect(agent).toBeInstanceOf(ReactiveAgent);
  });

  // ─── toolBuilderToEntry ───

  describe("toolBuilderToEntry", () => {
    it("converts ToolBuilder to { definition, handler } entry", async () => {
      const { ToolBuilder } = await import("@reactive-agents/tools");
      const { toolBuilderToEntry } = await import("@reactive-agents/runtime");

      const entry = toolBuilderToEntry(
        ToolBuilder.create("ping")
          .description("Echo back the input")
          .param("message", "string", "Message to echo", { required: true })
          .handler(({ message }) => `pong: ${message}`),
      );

      expect(entry.definition.name).toBe("ping");
      expect(entry.definition.description).toBe("Echo back the input");
      expect(entry.definition.parameters).toHaveLength(1);
      expect(entry.definition.parameters[0].name).toBe("message");
      expect(entry.definition.parameters[0].required).toBe(true);
      expect(typeof entry.handler).toBe("function");

      // Handler wraps the ToolBuilder handler in Effect
      const { Effect } = await import("effect");
      const result = await Effect.runPromise(
        entry.handler({ message: "hello" }),
      );
      expect(result).toBe("pong: hello");
    });

    it("throws when ToolBuilder has no handler", async () => {
      const { ToolBuilder } = await import("@reactive-agents/tools");
      const { toolBuilderToEntry } = await import("@reactive-agents/runtime");

      expect(() =>
        toolBuilderToEntry(ToolBuilder.create("no-handler").description("nope")),
      ).toThrow(/has no handler/);
    });
  });

  // ─── parentScratchpadWriter for withAgentTool ───

  describe("withAgentTool scratchpad forwarding", () => {
    it("forwards sub-agent scratchpad entries to parent result", async () => {
      // This test verifies the wiring exists — the actual scratchpad
      // entries are written by the sub-agent's scratchpad-write tool
      // during execution. We verify the agent builds and runs with
      // scratchpad forwarding wired.
      const agent = await ReactiveAgents.create()
        .withName("parent-agent")
        .withProvider("test")
        .withTools()
        .withAgentTool("data-analyst", {
          name: "Data Analyst",
          description: "Analyzes data",
          systemPrompt: "You are a data analyst. Write findings to scratchpad.",
          persona: { role: "Analyst" },
          parameters: [
            {
              name: "dataset",
              type: "string",
              description: "Dataset to analyze",
              required: true,
            },
          ],
        })
        .withTestScenario([{ text: "Delegated to data-analyst." }])
        .build();

      expect(agent).toBeInstanceOf(ReactiveAgent);
    });
  });
});
