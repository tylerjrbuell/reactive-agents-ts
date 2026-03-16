import { describe, test, expect } from "bun:test";

// ─── 1. Re-exports work ───

describe("Umbrella re-exports", () => {
  test("primary API exports are accessible from main entry", async () => {
    const mod = await import("../src/index.js");

    // Builder
    expect(mod.ReactiveAgents).toBeDefined();
    expect(mod.ReactiveAgentBuilder).toBeDefined();
    expect(mod.ReactiveAgent).toBeDefined();
    expect(typeof mod.ReactiveAgents.create).toBe("function");

    // Runtime composition
    expect(mod.createRuntime).toBeDefined();
    expect(typeof mod.createRuntime).toBe("function");

    // Execution engine
    expect(mod.ExecutionEngine).toBeDefined();
    expect(mod.ExecutionEngineLive).toBeDefined();

    // Lifecycle hooks
    expect(mod.LifecycleHookRegistry).toBeDefined();
    expect(mod.LifecycleHookRegistryLive).toBeDefined();

    // Config
    expect(mod.defaultReactiveAgentsConfig).toBeDefined();

    // Streaming
    expect(mod.AgentStream).toBeDefined();

    // Deployment
    expect(mod.registerShutdownHandlers).toBeDefined();
    expect(typeof mod.registerShutdownHandlers).toBe("function");
  });

  test("core service exports are accessible", async () => {
    const mod = await import("../src/index.js");

    // Services
    expect(mod.AgentService).toBeDefined();
    expect(mod.AgentServiceLive).toBeDefined();
    expect(mod.TaskService).toBeDefined();
    expect(mod.TaskServiceLive).toBeDefined();
    expect(mod.EventBus).toBeDefined();
    expect(mod.EventBusLive).toBeDefined();
    expect(mod.ContextWindowManager).toBeDefined();
    expect(mod.ContextWindowManagerLive).toBeDefined();
    expect(mod.CoreServicesLive).toBeDefined();

    // ID generators
    expect(typeof mod.generateAgentId).toBe("function");
    expect(typeof mod.generateTaskId).toBe("function");
    expect(typeof mod.generateMessageId).toBe("function");
  });

  test("LLM provider exports are accessible", async () => {
    const mod = await import("../src/index.js");

    expect(mod.LLMService).toBeDefined();
    expect(mod.createLLMProviderLayer).toBeDefined();
    expect(typeof mod.createLLMProviderLayer).toBe("function");
    expect(mod.TestLLMServiceLayer).toBeDefined();
  });

  test("layer factory exports are accessible", async () => {
    const mod = await import("../src/index.js");

    expect(typeof mod.createMemoryLayer).toBe("function");
    expect(typeof mod.createReasoningLayer).toBe("function");
    expect(typeof mod.createToolsLayer).toBe("function");
    expect(typeof mod.createGuardrailsLayer).toBe("function");
    expect(typeof mod.createVerificationLayer).toBe("function");
    expect(typeof mod.createCostLayer).toBe("function");
    expect(typeof mod.createIdentityLayer).toBe("function");
    expect(typeof mod.createObservabilityLayer).toBe("function");
    expect(typeof mod.createInteractionLayer).toBe("function");
    expect(typeof mod.createOrchestrationLayer).toBe("function");
    expect(typeof mod.createPromptLayer).toBe("function");
    expect(typeof mod.createEvalLayer).toBe("function");
    expect(typeof mod.createA2AServerLayer).toBe("function");
    expect(typeof mod.createA2AClientLayer).toBe("function");
  });

  test("ID generators produce valid IDs", async () => {
    const { generateAgentId, generateTaskId, generateMessageId } = await import(
      "../src/index.js"
    );

    const agentId = generateAgentId();
    const taskId = generateTaskId();
    const messageId = generateMessageId();

    expect(typeof agentId).toBe("string");
    expect(agentId.length).toBeGreaterThan(0);
    expect(typeof taskId).toBe("string");
    expect(taskId.length).toBeGreaterThan(0);
    expect(typeof messageId).toBe("string");
    expect(messageId.length).toBeGreaterThan(0);
  });
});

// ─── 2. Basic agent build ───

describe("Basic agent build via umbrella imports", () => {
  test("minimal agent can be built with test provider", async () => {
    const { ReactiveAgents, ReactiveAgent } = await import("../src/index.js");

    const agent = await ReactiveAgents.create()
      .withName("umbrella-test")
      .withProvider("test")
      .withTestScenario([{ text: "Hello from test" }])
      .build();

    expect(agent).toBeInstanceOf(ReactiveAgent);
    expect(agent.agentId).toContain("umbrella-test");

    await agent.dispose();
  });

  test("agent can be built without explicit name", async () => {
    const { ReactiveAgents } = await import("../src/index.js");

    const agent = await ReactiveAgents.create()
      .withProvider("test")
      .withTestScenario([{ text: "ok" }])
      .build();

    expect(agent).toBeDefined();
    expect(agent.agentId).toBeTruthy();

    await agent.dispose();
  });
});

// ─── 3. Agent run ───

describe("Agent run via umbrella imports", () => {
  test("agent.run() returns AgentResult with expected shape", async () => {
    const { ReactiveAgents } = await import("../src/index.js");

    const agent = await ReactiveAgents.create()
      .withName("run-test")
      .withTestScenario([{ text: "The answer is 42." }])
      .build();

    const result = await agent.run("What is the answer?");

    expect(result.success).toBe(true);
    expect(result.output).toContain("42");
    expect(result.agentId).toContain("run-test");

    // Metadata shape
    expect(result.metadata).toBeDefined();
    expect(typeof result.metadata.duration).toBe("number");
    expect(result.metadata.duration).toBeGreaterThanOrEqual(0);
    expect(typeof result.metadata.stepsCount).toBe("number");
    expect(typeof result.metadata.tokensUsed).toBe("number");
    expect(typeof result.metadata.cost).toBe("number");

    await agent.dispose();
  });

  test("agent.run() with reasoning enabled returns result", async () => {
    const { ReactiveAgents } = await import("../src/index.js");

    const agent = await ReactiveAgents.create()
      .withName("reasoning-run")
      .withTestScenario([{ text: "FINAL ANSWER: reasoned result" }])
      .withReasoning()
      .build();

    const result = await agent.run("Think about this");

    expect(result.success).toBe(true);
    expect(result.output).toBeTruthy();

    await agent.dispose();
  });

  test("agent.run() with match guard selects correct response", async () => {
    const { ReactiveAgents } = await import("../src/index.js");

    const agent = await ReactiveAgents.create()
      .withName("match-test")
      .withTestScenario([
        { match: "first", text: "Response A" },
        { match: "second", text: "Response B" },
      ])
      .build();

    const resultA = await agent.run("first question");
    expect(resultA.output).toContain("Response A");

    const resultB = await agent.run("second question");
    expect(resultB.output).toContain("Response B");

    await agent.dispose();
  });
});

// ─── 4. Builder methods chain ───

describe("Builder method chaining via umbrella imports", () => {
  test("all key builder methods are chainable", async () => {
    const { ReactiveAgents, ReactiveAgentBuilder } = await import("../src/index.js");

    const builder = ReactiveAgents.create();
    expect(builder).toBeInstanceOf(ReactiveAgentBuilder);

    // Each method should return the builder for chaining
    const chained = builder
      .withName("chain-test")
      .withProvider("test")
      .withModel("test-model")
      .withReasoning()
      .withTools()
      .withMemory()
      .withGuardrails()
      .withStreaming()
      .withObservability()
      .withHealthCheck()
      .withTimeout(30_000)
      .withMaxIterations(10)
      .withStrictValidation()
      .withRetryPolicy({ maxRetries: 2, backoffMs: 500 })
      .withCacheTimeout(600_000);

    expect(chained).toBeInstanceOf(ReactiveAgentBuilder);
  });

  test("chained builder produces a working agent", async () => {
    const { ReactiveAgents } = await import("../src/index.js");

    const agent = await ReactiveAgents.create()
      .withName("full-chain")
      .withTestScenario([{ text: "chain result" }])
      .withReasoning()
      .withTools()
      .withMemory()
      .withGuardrails()
      .withHealthCheck()
      .withTimeout(30_000)
      .withMaxIterations(10)
      .build();

    expect(agent).toBeDefined();

    const result = await agent.run("test chaining");
    expect(result.success).toBe(true);

    await agent.dispose();
  });

  test("withErrorHandler accepts a callback", async () => {
    const { ReactiveAgents } = await import("../src/index.js");

    const errors: unknown[] = [];
    const agent = await ReactiveAgents.create()
      .withName("error-handler-test")
      .withTestScenario([{ text: "ok" }])
      .withErrorHandler((err) => {
        errors.push(err);
      })
      .build();

    expect(agent).toBeDefined();
    await agent.dispose();
  });

  test("withFallbacks accepts provider list", async () => {
    const { ReactiveAgents } = await import("../src/index.js");

    const builder = ReactiveAgents.create()
      .withProvider("test")
      .withFallbacks({ providers: ["test"], errorThreshold: 3 });

    expect(builder).toBeDefined();
  });

  test("withLogging accepts configuration", async () => {
    const { ReactiveAgents } = await import("../src/index.js");

    const agent = await ReactiveAgents.create()
      .withTestScenario([{ text: "ok" }])
      .withLogging({ level: "info" })
      .build();

    expect(agent).toBeDefined();
    await agent.dispose();
  });
});

// ─── 5. Streaming works ───

describe("Streaming via umbrella imports", () => {
  test("runStream() yields events with expected tags", async () => {
    const { ReactiveAgents } = await import("../src/index.js");

    const agent = await ReactiveAgents.create()
      .withName("stream-test")
      .withTestScenario([{ text: "FINAL ANSWER: streamed output" }])
      .build();

    const tags: string[] = [];
    for await (const event of agent.runStream("stream this")) {
      tags.push(event._tag);
    }

    // Must have a terminal event
    expect(tags).toContain("StreamCompleted");
    // Last event should be terminal
    const lastTag = tags[tags.length - 1];
    expect(["StreamCompleted", "StreamError"]).toContain(lastTag);

    await agent.dispose();
  });

  test("StreamCompleted event contains the output", async () => {
    const { ReactiveAgents } = await import("../src/index.js");

    const agent = await ReactiveAgents.create()
      .withName("stream-output")
      .withTestScenario([{ text: "FINAL ANSWER: hello stream" }])
      .build();

    let completedEvent: any = null;
    for await (const event of agent.runStream("get output")) {
      if (event._tag === "StreamCompleted") {
        completedEvent = event;
      }
    }

    expect(completedEvent).not.toBeNull();
    expect(completedEvent.output).toContain("hello stream");

    await agent.dispose();
  });

  test("runStream() with reasoning emits TextDelta events", async () => {
    const { ReactiveAgents } = await import("../src/index.js");

    const agent = await ReactiveAgents.create()
      .withName("stream-reasoning")
      .withTestScenario([{ text: "FINAL ANSWER: reasoned stream" }])
      .withReasoning()
      .build();

    const deltas: string[] = [];
    for await (const event of agent.runStream("reason and stream")) {
      if (event._tag === "TextDelta") {
        deltas.push(event.text);
      }
    }

    expect(deltas.length).toBeGreaterThan(0);

    await agent.dispose();
  });
});

// ─── 6. Health check ───

describe("Health check via umbrella imports", () => {
  test("agent.health() returns healthy status", async () => {
    const { ReactiveAgents } = await import("../src/index.js");

    const agent = await ReactiveAgents.create()
      .withName("health-test")
      .withTestScenario([{ text: "ok" }])
      .withHealthCheck()
      .build();

    const health = await agent.health();
    expect(health.status).toBe("healthy");
    expect(Array.isArray(health.checks)).toBe(true);

    await agent.dispose();
  });
});
