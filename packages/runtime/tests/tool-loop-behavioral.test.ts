/**
 * Behavioral tests for the ReAct tool loop using withTestScenario.
 *
 * These tests were previously impossible because the test provider always
 * completed in one iteration without calling tools. With TestTurn scenarios
 * returning stopReason: "tool_use", these paths are now exercisable.
 */
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { ReactiveAgents } from "../src/builder.js";

function makeToolDef(name: string) {
  return {
    name,
    description: `Tool ${name}`,
    parameters: [
      {
        name: "input",
        type: "string" as const,
        description: "Input",
        required: true,
      },
    ],
    riskLevel: "low" as const,
    timeoutMs: 5_000,
    requiresApproval: false,
    source: "function" as const,
  };
}

describe("tool loop behavioral tests", () => {
  it("agent successfully calls a tool via native tool_use path", async () => {
    const toolCalls: string[] = [];

    const agent = await ReactiveAgents.create()
      .withName("tool-loop-test")
      .withTestScenario([
        { toolCall: { name: "echo-tool", args: { input: "hello" } } },
        { text: "The tool returned the value." },
      ])
      .withTools({
        tools: [
          {
            definition: makeToolDef("echo-tool"),
            handler: (args) => {
              toolCalls.push(args.input as string);
              return Effect.succeed(`echoed: ${args.input}`);
            },
          },
        ],
      })
      .build();

    let result;
    try {
      result = await agent.run("echo hello");
    } finally {
      await agent.dispose();
    }

    expect(result.success).toBe(true);
    expect(toolCalls).toContain("hello");
  });

  it("agent calls two tools across sequential turns", async () => {
    const calls: string[] = [];

    const agent = await ReactiveAgents.create()
      .withName("multi-tool-test")
      .withTestScenario([
        { toolCall: { name: "tool-a", args: { input: "first" } } },
        { toolCall: { name: "tool-b", args: { input: "second" } } },
        { text: "Both tools complete." },
      ])
      .withTools({
        tools: [
          {
            definition: makeToolDef("tool-a"),
            handler: (args) => {
              calls.push(`a:${args.input}`);
              return Effect.succeed("a done");
            },
          },
          {
            definition: makeToolDef("tool-b"),
            handler: (args) => {
              calls.push(`b:${args.input}`);
              return Effect.succeed("b done");
            },
          },
        ],
      })
      .build();

    try {
      await agent.run("use both tools");
    } finally {
      await agent.dispose();
    }

    expect(calls).toContain("a:first");
    expect(calls).toContain("b:second");
  });

  it("agent exceeds max iterations when tool calls never terminate", async () => {
    let threw = false;
    let errorMessage = "";

    const agent = await ReactiveAgents.create()
      .withName("max-iter-test")
      .withMaxIterations(3)
      .withTestScenario([
        // Always returns a tool call — agent loops until max iterations
        { toolCall: { name: "loop-tool", args: { input: "loop" } } },
      ])
      .withTools({
        tools: [
          {
            definition: makeToolDef("loop-tool"),
            handler: () => Effect.succeed("keep going"),
          },
        ],
      })
      .build();

    try {
      await agent.run("loop forever");
    } catch (e) {
      threw = true;
      errorMessage = (e as Error).message;
    } finally {
      await agent.dispose();
    }

    expect(threw).toBe(true);
    // Error message should reference iterations or limit
    expect(errorMessage.toLowerCase()).toMatch(/iteration|max|limit|exceed/);
  });

  it("error turn causes agent.run() to throw", async () => {
    let threw = false;

    const agent = await ReactiveAgents.create()
      .withName("error-turn-test")
      .withTestScenario([{ error: "provider_unavailable" }])
      .build();

    try {
      await agent.run("any prompt");
    } catch {
      threw = true;
    } finally {
      await agent.dispose();
    }

    expect(threw).toBe(true);
  });

  it("withErrorHandler fires when error turn is reached", async () => {
    let handlerFired = false;

    const agent = await ReactiveAgents.create()
      .withName("error-handler-test")
      .withTestScenario([{ error: "rate_limit_exceeded" }])
      .withErrorHandler(() => {
        handlerFired = true;
      })
      .build();

    try {
      await agent.run("test");
    } catch {
      // expected — run() rethrows after handler
    } finally {
      await agent.dispose();
    }

    expect(handlerFired).toBe(true);
  });

  it("withTestScenario auto-sets provider — no withProvider needed", async () => {
    const agent = await ReactiveAgents.create()
      .withName("auto-provider-test")
      .withTestScenario([{ text: "auto provider works" }])
      .build();

    let result;
    try {
      result = await agent.run("anything");
    } finally {
      await agent.dispose();
    }

    expect(result.success).toBe(true);
  });
});
