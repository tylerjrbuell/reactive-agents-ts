/**
 * Performance benchmarks verifying roadmap performance targets.
 * These run as part of `bun test` and fail if targets are missed.
 */
import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { EventBusLive } from "@reactive-agents/core";
import { ToolService, ToolServiceLive, makeSandbox } from "@reactive-agents/tools";
import { ReactiveAgents } from "@reactive-agents/runtime";
import { PromptService, PromptServiceLive, allBuiltinTemplates, interpolate, estimateTokens } from "@reactive-agents/prompts";

const TestToolLayer = ToolServiceLive.pipe(Layer.provide(EventBusLive));

describe("Performance Benchmarks", () => {
  it("tool lookup: < 1ms for 100 registered tools", async () => {
    const program = Effect.gen(function* () {
      const tools = yield* ToolService;

      // Register 100 tools
      for (let i = 0; i < 100; i++) {
        yield* tools.register(
          {
            name: `bench-tool-${i}`,
            description: `Benchmark tool ${i}`,
            parameters: [
              {
                name: "input",
                type: "string",
                description: "Input",
                required: true,
              },
            ],
            riskLevel: "low",
            timeoutMs: 5000,
            requiresApproval: false,
            source: "function",
          },
          (args) => Effect.succeed(args.input),
        );
      }

      // Measure lookup time
      const start = performance.now();
      for (let i = 0; i < 100; i++) {
        yield* tools.getTool(`bench-tool-${i}`);
      }
      const elapsed = performance.now() - start;
      const perLookup = elapsed / 100;

      expect(perLookup).toBeLessThan(1); // < 1ms per lookup
    });

    await Effect.runPromise(program.pipe(Effect.provide(TestToolLayer)));
  });

  it("input validation: < 2ms for complex schemas", async () => {
    const program = Effect.gen(function* () {
      const tools = yield* ToolService;

      yield* tools.register(
        {
          name: "complex-tool",
          description: "Tool with complex params",
          parameters: [
            { name: "query", type: "string", description: "Query", required: true },
            { name: "count", type: "number", description: "Count", required: true },
            { name: "verbose", type: "boolean", description: "Verbose", required: false, default: false },
            { name: "tags", type: "array", description: "Tags", required: false },
            { name: "options", type: "object", description: "Options", required: false },
            {
              name: "format",
              type: "string",
              description: "Output format",
              required: true,
              enum: ["json", "text", "csv"],
            },
          ],
          riskLevel: "low",
          timeoutMs: 5000,
          requiresApproval: false,
          source: "function",
        },
        (args) => Effect.succeed(args),
      );

      // Measure validation time (included in execute)
      const start = performance.now();
      for (let i = 0; i < 100; i++) {
        yield* tools.execute({
          toolName: "complex-tool",
          arguments: {
            query: "test",
            count: 10,
            verbose: true,
            tags: ["a", "b"],
            options: { key: "value" },
            format: "json",
          },
          agentId: "bench",
          sessionId: "bench",
        });
      }
      const elapsed = performance.now() - start;
      const perValidation = elapsed / 100;

      expect(perValidation).toBeLessThan(2); // < 2ms per validation + execute
    });

    await Effect.runPromise(program.pipe(Effect.provide(TestToolLayer)));
  });

  it("function calling format conversion: < 5ms", async () => {
    const program = Effect.gen(function* () {
      const tools = yield* ToolService;

      // Register 20 additional tools (5 built-in already registered)
      for (let i = 0; i < 20; i++) {
        yield* tools.register(
          {
            name: `fc-tool-${i}`,
            description: `FC tool ${i}`,
            parameters: [
              { name: "input", type: "string", description: "Input", required: true },
              { name: "option", type: "number", description: "Option", required: false },
            ],
            riskLevel: "low",
            timeoutMs: 5000,
            requiresApproval: false,
            source: "function",
          },
          () => Effect.succeed("ok"),
        );
      }

      // Measure conversion time
      const start = performance.now();
      const fcTools = yield* tools.toFunctionCallingFormat();
      const elapsed = performance.now() - start;

      expect(fcTools.length).toBeGreaterThanOrEqual(25); // 5 built-in + 20 registered
      expect(elapsed).toBeLessThan(5); // < 5ms
    });

    await Effect.runPromise(program.pipe(Effect.provide(TestToolLayer)));
  });

  it("sandbox execution overhead: < 5ms for immediate tool", async () => {
    const sandbox = makeSandbox();

    const iterations = 100;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      await Effect.runPromise(
        sandbox.execute(() => Effect.succeed("done"), {
          timeoutMs: 5000,
          toolName: "bench",
        }),
      );
    }
    const elapsed = performance.now() - start;
    const perExec = elapsed / iterations;

    expect(perExec).toBeLessThan(5); // < 5ms overhead per execution
  });

  it("agent.run() e2e with test provider: < 100ms", async () => {
    const agent = await ReactiveAgents.create()
      .withName("bench-agent")
      .withProvider("test")
      .withTestResponses({ default: "Benchmark response" })
      .build();

    const start = performance.now();
    const result = await agent.run("Benchmark test");
    const elapsed = performance.now() - start;

    expect(result.success).toBe(true);
    expect(elapsed).toBeLessThan(100);
  });

  it("agent.run() with all layers enabled: < 200ms", async () => {
    const agent = await ReactiveAgents.create()
      .withName("bench-full")
      .withProvider("test")
      .withTestResponses({ default: "FINAL ANSWER: Full benchmark." })
      .withReasoning()
      .withTools()
      .withGuardrails()
      .withVerification()
      .withCostTracking()
      .withObservability()
      .withMemory("1")
      .build();

    const start = performance.now();
    const result = await agent.run("Full layer benchmark");
    const elapsed = performance.now() - start;

    expect(result.success).toBe(true);
    expect(elapsed).toBeLessThan(200);
  });

  it("prompt template compilation: < 2ms average", async () => {
    const templates = allBuiltinTemplates;
    expect(templates.length).toBeGreaterThanOrEqual(20);

    const start = performance.now();
    for (const template of templates) {
      // Build dummy variables for each template
      const dummyVars: Record<string, unknown> = {};
      for (const v of template.variables) {
        if (v.type === "string") dummyVars[v.name] = "test-value";
        else if (v.type === "number") dummyVars[v.name] = 42;
        else if (v.type === "boolean") dummyVars[v.name] = true;
        else if (v.type === "array") dummyVars[v.name] = ["a", "b"];
        else if (v.type === "object") dummyVars[v.name] = { key: "value" };
      }
      await Effect.runPromise(interpolate(template, dummyVars));
    }
    const elapsed = performance.now() - start;
    const perTemplate = elapsed / templates.length;

    expect(perTemplate).toBeLessThan(2); // < 2ms average per template
  });
});
