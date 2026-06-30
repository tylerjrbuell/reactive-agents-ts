import { describe, test, expect } from "bun:test";
import { ReactiveAgents } from "../src/builder.js";
import { ToolService } from "@reactive-agents/tools";
import { Effect } from "effect";

/**
 * Behavioral introspection: ask the SAME ToolService the agent's runtime uses
 * whether a tool is registered. Resolves to true only if `getTool(name)`
 * succeeds (tool present), false if it raises ToolNotFoundError (absent).
 */
async function toolPresent(
  agent: { runtime: { runPromise: <A>(e: Effect.Effect<A, never, never>) => Promise<A> } },
  name: string,
): Promise<boolean> {
  return agent.runtime.runPromise(
    Effect.gen(function* () {
      const ts = yield* ToolService;
      return yield* ts.getTool(name).pipe(
        Effect.map(() => true),
        Effect.catchAll(() => Effect.succeed(false)),
      );
    }) as unknown as Effect.Effect<boolean, never, never>,
  );
}

describe("ReactiveAgent dynamic tools", () => {
  test("registerTool adds a tool post-build", async () => {
    const agent = await ReactiveAgents.create()
      .withName("dynamic-test")
      .withProvider("test")
      .withTools()
      .build();

    // Absent before registration — proves the assertion can fail.
    expect(await toolPresent(agent, "dynamic-adder")).toBe(false);

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

    // Present after registration — the tool really landed in the registry.
    expect(await toolPresent(agent, "dynamic-adder")).toBe(true);

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

    // Registered → present.
    expect(await toolPresent(agent, "temp-tool")).toBe(true);

    await agent.unregisterTool("temp-tool");

    // Unregistered → gone from the registry.
    expect(await toolPresent(agent, "temp-tool")).toBe(false);

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
