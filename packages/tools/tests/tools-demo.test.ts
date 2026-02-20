import { expect, describe, it } from "bun:test";
import { Effect, Layer } from "effect";
import {
  ToolService,
  ToolServiceLive,
  fileReadTool,
  fileReadHandler,
} from "@reactive-agents/tools";
import { EventBusLive } from "@reactive-agents/core";

describe("Tools Integration", () => {
  it("should register and execute a file-read tool", async () => {
    const program = Effect.gen(function* () {
      const tools = yield* ToolService;

      // Register a simple test tool
      yield* tools.register(
        {
          name: "test-tool",
          description: "A test tool that returns a fixed message",
          parameters: [
            {
              name: "message",
              type: "string",
              description: "Message to echo",
              required: true,
            },
          ],
          category: "custom",
          riskLevel: "low",
          timeoutMs: 5000,
          requiresApproval: false,
          source: "function",
        },
        (args) => Effect.succeed(`Echo: ${args.message}`),
      );

      // List registered tools
      const toolList = yield* tools.listTools();
      console.log(`\n📋 Registered ${toolList.length} tool(s):`);
      toolList.forEach((t) => {
        console.log(`   - ${t.name} (${t.source}, risk: ${t.riskLevel})`);
      });

      // Execute the tool
      const result = yield* tools.execute({
        toolName: "test-tool",
        arguments: { message: "Hello from tool!" },
        agentId: "test-agent",
        sessionId: "test-session",
      });

      console.log(`\n✅ Tool Execution Result:`);
      console.log(`   Tool: ${result.toolName}`);
      console.log(`   Success: ${result.success}`);
      console.log(`   Output: ${result.result}`);
      console.log(`   Time: ${result.executionTimeMs}ms`);

      expect(result.success).toBe(true);
      expect(result.result).toBe("Echo: Hello from tool!");
    });

    const TestLayer = ToolServiceLive.pipe(Layer.provide(EventBusLive));
    await Effect.runPromise(program.pipe(Effect.provide(TestLayer)));
  });

  it("should register multiple tools and list them by category", async () => {
    const program = Effect.gen(function* () {
      const tools = yield* ToolService;

      // Register multiple tools
      yield* tools.register(
        {
          name: "math-add",
          description: "Add two numbers",
          parameters: [
            {
              name: "a",
              type: "number",
              description: "First number",
              required: true,
            },
            {
              name: "b",
              type: "number",
              description: "Second number",
              required: true,
            },
          ],
          category: "code",
          riskLevel: "low",
          timeoutMs: 5000,
          requiresApproval: false,
          source: "function",
        },
        (args) =>
          Effect.succeed((args.a as number) + (args.b as number)),
      );

      yield* tools.register(
        {
          name: "string-concat",
          description: "Concatenate two strings",
          parameters: [
            {
              name: "a",
              type: "string",
              description: "First string",
              required: true,
            },
            {
              name: "b",
              type: "string",
              description: "Second string",
              required: true,
            },
          ],
          category: "data",
          riskLevel: "low",
          timeoutMs: 5000,
          requiresApproval: false,
          source: "function",
        },
        (args) => Effect.succeed(`${args.a}${args.b}`),
      );

      // List all tools
      const allTools = yield* tools.listTools();
      console.log(`\n🔧 Total Tools Registered: ${allTools.length}`);

      // List by category
      const codeTools = yield* tools.listTools({ category: "code" });
      console.log(`\n📊 Code Tools: ${codeTools.length}`);
      codeTools.forEach((t) => {
        console.log(`   - ${t.name}: ${t.description}`);
      });

      // Test math tool
      const mathResult = yield* tools.execute({
        toolName: "math-add",
        arguments: { a: 5, b: 7 },
        agentId: "test-agent",
        sessionId: "test-session",
      });

      console.log(`\n✅ Math Tool (5 + 7):`);
      console.log(`   Result: ${mathResult.result}`);

      // Test string tool
      const stringResult = yield* tools.execute({
        toolName: "string-concat",
        arguments: { a: "Hello ", b: "World!" },
        agentId: "test-agent",
        sessionId: "test-session",
      });

      console.log(`\n✅ String Tool ("Hello " + "World!"):`);
      console.log(`   Result: ${stringResult.result}`);

      // Get tool definitions
      const mathTool = yield* tools.getTool("math-add");
      console.log(`\n📖 Math Tool Definition:`);
      console.log(`   Name: ${mathTool.name}`);
      console.log(`   Category: ${mathTool.category}`);
      console.log(`   Params: ${mathTool.parameters.length}`);

      expect(allTools.length).toBeGreaterThanOrEqual(2);
      expect(mathResult.result).toBe(12);
      expect(stringResult.result).toBe("Hello World!");
    });

    const TestLayer = ToolServiceLive.pipe(Layer.provide(EventBusLive));
    await Effect.runPromise(program.pipe(Effect.provide(TestLayer)));
  });
});
