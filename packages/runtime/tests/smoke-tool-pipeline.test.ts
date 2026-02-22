import { describe, it, expect } from "bun:test";
import { ReactiveAgents } from "../src/index.js";
import { Effect } from "effect";

describe("Smoke: Tool Pipeline", () => {
  it("registers custom tool and builds successfully", async () => {
    const agent = await ReactiveAgents.create()
      .withName("tool-pipeline")
      .withProvider("test")
      .withTools({
        tools: [{
          definition: {
            name: "echo",
            description: "Echo a message back",
            parameters: [{ name: "message", type: "string" as const, description: "Message to echo", required: true }],
            riskLevel: "low" as const,
            timeoutMs: 5_000,
            requiresApproval: false,
            source: "function" as const,
          },
          handler: (args) => Effect.succeed(`Echo: ${args.message}`),
        }],
      })
      .build();

    const result = await agent.run("Hello");
    expect(result.success).toBe(true);
  });

  it("tool not found produces graceful error observation", async () => {
    // Agent with tools enabled but no custom tools — uses built-in
    const agent = await ReactiveAgents.create()
      .withName("tool-not-found")
      .withProvider("test")
      .withTools()
      .build();

    // This should complete without crashing even if a tool isn't found
    const result = await agent.run("Hello");
    expect(result.success).toBe(true);
  });

  it("multiple custom tools register without conflict", async () => {
    const agent = await ReactiveAgents.create()
      .withName("multi-tool")
      .withProvider("test")
      .withTools({
        tools: [
          {
            definition: {
              name: "tool-a",
              description: "First tool",
              parameters: [{ name: "input", type: "string" as const, description: "Input", required: true }],
              riskLevel: "low" as const,
              timeoutMs: 5_000,
              requiresApproval: false,
              source: "function" as const,
            },
            handler: (args) => Effect.succeed(`A: ${args.input}`),
          },
          {
            definition: {
              name: "tool-b",
              description: "Second tool",
              parameters: [{ name: "input", type: "string" as const, description: "Input", required: true }],
              riskLevel: "low" as const,
              timeoutMs: 5_000,
              requiresApproval: false,
              source: "function" as const,
            },
            handler: (args) => Effect.succeed(`B: ${args.input}`),
          },
        ],
      })
      .build();

    const result = await agent.run("Hello");
    expect(result.success).toBe(true);
  });
});
