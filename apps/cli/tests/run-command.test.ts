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
    expect(helpText).toContain("rax"); // CLI brand name
  });

  // Piped runs (stdout is not a TTY), as in CI or `rax run ... | tee`.
  const runPiped = (...flags: string[]) => {
    const proc = Bun.spawnSync(["bun", CLI_ENTRY, "run", "What is 2+2?", "--provider", "test", ...flags], {
      stdout: "pipe",
      stderr: "pipe",
    });
    return { code: proc.exitCode, out: proc.stdout.toString(), err: proc.stderr.toString() };
  };

  it("--tools enables the built-in tools (no 'no capability tools' warning)", () => {
    const r = runPiped("--tools");
    expect(r.code).toBe(0);
    expect(r.out + r.err).not.toContain("no capability tools");
  }, 30_000);

  it("--quiet prints the answer with no CLI chrome", () => {
    const r = runPiped("--quiet");
    expect(r.code).toBe(0);
    expect(r.out.trim().split("\n").at(-1)).toBe("Test response.");
    expect(r.out + r.err).not.toContain("Executing");
    expect(r.out).not.toContain("Metrics");
  }, 30_000);

  it("--verbose shows phase lines even off a TTY", () => {
    const r = runPiped("--verbose");
    expect(r.code).toBe(0);
    expect(r.out).toContain("[phase:");
  }, 30_000);

  it("default piped run prints no phase lines", () => {
    const r = runPiped();
    expect(r.code).toBe(0);
    expect(r.out).not.toContain("[phase:");
    expect(r.out).toContain("Test response.");
  }, 30_000);

  it("run usage lists --cortex", () => {
    const proc = Bun.spawnSync(["bun", CLI_ENTRY, "run"], {
      stderr: "pipe",
    });
    expect(proc.exitCode).not.toBe(0);
    const text = proc.stdout.toString() + proc.stderr.toString();
    expect(text).toContain("--cortex");
  });
});
