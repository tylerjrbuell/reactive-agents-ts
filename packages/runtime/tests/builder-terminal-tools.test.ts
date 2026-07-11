// Run: bun test packages/runtime/tests/builder-terminal-tools.test.ts --timeout 15000
import { Effect, Layer } from "effect";
import { describe, it, expect } from "bun:test";
import { ReactiveAgents } from "../src/index.js";
import { shellExecuteTool, ToolService } from "@reactive-agents/tools";

/**
 * Introspect the SAME ToolService the agent's runtime uses: resolves true only
 * if `getTool(name)` succeeds (tool registered), false on ToolNotFoundError.
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

describe("builder terminal tools integration", () => {
  it("should enable shell-execute tool when .withTools({ terminal: true }) is called", async () => {
    const agent = await ReactiveAgents.create()
      .withProvider("test")
      .withTools({ terminal: true })
      .build();

    // shell-execute must be registered in the resolved tool registry.
    expect(await toolPresent(agent, "shell-execute")).toBe(true);

    await agent.dispose();
  }, 15000);

  it("should enable shell-execute tool when .withTools({ terminal: true }) is called", async () => {
    const agent = await ReactiveAgents.create()
      .withProvider("test")
      .withTools({ terminal: true })
      .build();

    // shell-execute must be registered when terminal:true is set.
    expect(await toolPresent(agent, "shell-execute")).toBe(true);

    await agent.dispose();
  }, 15000);

  it("should NOT enable shell-execute by default", async () => {
    const agent = await ReactiveAgents.create()
      .withProvider("test")
      .withTools() // No terminal: true
      .build();

    // shell-execute must be ABSENT without explicit terminal opt-in.
    expect(await toolPresent(agent, "shell-execute")).toBe(false);

    await agent.dispose();
  }, 15000);

  it("should execute shell-execute when terminal tools are enabled", async () => {
    const agent = await ReactiveAgents.create()
      .withProvider("test")
      .withReasoning({ defaultStrategy: "reactive" })
      .withTestScenario([
        { toolCall: { name: "shell-execute", args: { command: "echo terminal-ok" } } },
        { text: "terminal-ok" },
      ])
      .withTools({ terminal: true })
      .withMaxIterations(3)
      .build();

    const result = await agent.run("Call shell-execute with command 'echo terminal-ok' and return the output.");

    expect(String(result.output)).toContain("terminal-ok");

    await agent.dispose();
  }, 15000);

  it("should pass terminal config (additionalCommands) to shell-execute", async () => {
    const agent = await ReactiveAgents.create()
      .withProvider("test")
      .withReasoning({ defaultStrategy: "reactive" })
      .withTestScenario([
        { toolCall: { name: "shell-execute", args: { command: "env" } } },
        { text: "done" },
      ])
      .withTools({
        terminal: {
          additionalCommands: ["env"],
        },
      })
      .build();

    try {
      const result = await agent.run("Run env");
      expect(result.success).toBe(true);
      expect(String(result.output)).toContain("done");
    } finally {
      await agent.dispose();
    }
  }, 15000);

  it("should pass additionalCommands when using withTools(allowedTools) then withTools({ terminal }) (Cortex wiring)", async () => {
    const agent = await ReactiveAgents.create()
      .withProvider("test")
      .withReasoning({ defaultStrategy: "reactive" })
      .withTestScenario([
        { toolCall: { name: "shell-execute", args: { command: "env" } } },
        { text: "done" },
      ])
      .withTools({ allowedTools: ["shell-execute", "web-search"] })
      .withTools({ terminal: { additionalCommands: ["env"] } })
      .build();

    try {
      const result = await agent.run("Run env");
      expect(result.success).toBe(true);
      expect(String(result.output)).toContain("done");
    } finally {
      await agent.dispose();
    }
  }, 15000);

  it("should not overwrite custom shell-execute when terminal is also enabled", async () => {
    let customCalled = false;

    const agent = await ReactiveAgents.create()
      .withProvider("test")
      .withTestScenario([
        {
          toolCall: {
            name: "shell-execute",
            args: { command: "echo from-custom-handler" },
          },
        },
        { text: "done" },
      ])
      .withTools({
        terminal: true,
        tools: [
          {
            definition: {
              ...shellExecuteTool,
            },
            handler: (args) =>
              Effect.sync(() => {
                customCalled = true;
                return {
                  executed: true,
                  output: `custom:${String(args.command ?? "")}`,
                  stderr: "",
                  exitCode: 0,
                  truncated: false,
                  stderrTruncated: false,
                };
              }),
          },
        ],
      })
      .build();

    try {
      const result = await agent.run("Run shell command");
      expect(result.success).toBe(true);
      expect(customCalled).toBe(true);
    } finally {
      await agent.dispose();
    }
  }, 15000);

  it("should preserve terminal registration across multiple withTools calls", async () => {
    const agent = await ReactiveAgents.create()
      .withProvider("test")
      .withReasoning({ defaultStrategy: "reactive" })
      .withTestScenario([
        { toolCall: { name: "shell-execute", args: { command: "echo terminal-still-registered" } } },
        { text: "terminal-still-registered" },
      ])
      .withTools({
        terminal: {
          additionalCommands: ["echo"],
        },
      })
      .withTools({ adaptive: true })
      .build();

    try {
      const result = await agent.run("Call shell-execute and return terminal-still-registered");
      expect(result.success).toBe(true);
      expect(String(result.output)).toContain("terminal-still-registered");
    } finally {
      await agent.dispose();
    }
  }, 15000);
});
