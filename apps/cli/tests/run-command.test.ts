import { describe, it, expect } from "bun:test";
import { ReactiveAgents, ReactiveAgent } from "@reactive-agents/runtime";
import { resolve } from "path";

const CLI_ENTRY = resolve(import.meta.dir, "../src/index.ts");

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
    const proc = Bun.spawnSync(["bun", CLI_ENTRY, "help"], {
      stderr: "pipe",
    });
    expect(proc.exitCode).toBe(0);
  });

  it("should show run command in help text", () => {
    const proc = Bun.spawnSync(["bun", CLI_ENTRY, "help"], {
      stderr: "pipe",
    });
    const helpText = proc.stdout.toString() + proc.stderr.toString();
    expect(helpText).toContain("run");
    expect(helpText).toContain("rax");  // CLI brand name
  });
});
