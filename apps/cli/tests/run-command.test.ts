import { describe, it, expect } from "bun:test";
import { ReactiveAgents, ReactiveAgent } from "@reactive-agents/runtime";

describe("CLI Run Command — Agent Integration", () => {
  it("should build and run an agent via test provider", async () => {
    const agent = await ReactiveAgents.create()
      .withName("cli-test-agent")
      .withProvider("test")
      .withModel("test-model")
      .build();

    expect(agent).toBeInstanceOf(ReactiveAgent);

    const result = await agent.run("What is 2+2?");
    expect(result.success).toBe(true);
    expect(result.agentId).toContain("cli-test-agent");
    expect(typeof result.metadata.duration).toBe("number");
  });

  it("should parse CLI help without errors", () => {
    // Test that the main function correctly handles the help command
    const { main } = require("../src/index.js");
    // help just logs — no throw
    expect(() => main(["help"])).not.toThrow();
  });

  it("should show run command in help text", () => {
    const { main } = require("../src/index.js");
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));
    main(["help"]);
    console.log = origLog;

    const helpText = logs.join("\n");
    expect(helpText).toContain("run <prompt>");
    expect(helpText).toContain("rax");  // CLI brand name
  });
});
