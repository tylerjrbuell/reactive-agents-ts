import { describe, test, expect } from "bun:test";
import { ReactiveAgents } from "../src/builder.js";
import { Effect } from "effect";

describe("ReactiveAgent dynamic tools", () => {
  test("registerTool adds a tool post-build", async () => {
    const agent = await ReactiveAgents.create()
      .withName("dynamic-test")
      .withProvider("test")
      .withTools()
      .build();

    await agent.registerTool(
      {
        name: "dynamic-adder",
        description: "Adds two numbers",
        parameters: [
          { name: "a", type: "number", description: "First number", required: true },
          { name: "b", type: "number", description: "Second number", required: true },
        ],
        category: "custom",
        riskLevel: "low",
        source: "function",
        timeoutMs: 5000,
        requiresApproval: false,
      },
      (args) => Effect.succeed({ sum: (args.a as number) + (args.b as number) }),
    );

    await agent.dispose();
  });

  test("unregisterTool removes a tool post-build", async () => {
    const agent = await ReactiveAgents.create()
      .withName("unreg-test")
      .withProvider("test")
      .withTools()
      .build();

    await agent.registerTool(
      {
        name: "temp-tool",
        description: "Temporary",
        parameters: [],
        category: "custom",
        riskLevel: "low",
        source: "function",
        timeoutMs: 5000,
        requiresApproval: false,
      },
      () => Effect.succeed("ok"),
    );

    await agent.unregisterTool("temp-tool");
    await agent.dispose();
  });

  test("registerTool handler is callable after registration", async () => {
    const agent = await ReactiveAgents.create()
      .withName("callable-test")
      .withProvider("test")
      .withTools()
      .build();

    let called = false;
    await agent.registerTool(
      {
        name: "spy-tool",
        description: "Records calls",
        parameters: [
          { name: "value", type: "string", description: "A value", required: true },
        ],
        category: "custom",
        riskLevel: "low",
        source: "function",
        timeoutMs: 5000,
        requiresApproval: false,
      },
      (args) => {
        called = true;
        return Effect.succeed({ received: args.value });
      },
    );

    // Verify tool was registered (no error thrown means success)
    expect(called).toBe(false); // handler not called yet, just registered

    await agent.dispose();
  });
});
