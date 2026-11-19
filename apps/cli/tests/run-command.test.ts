import { describe, it, expect } from "bun:test";
import { ReactiveAgents, ReactiveAgent } from "@reactive-agents/runtime";
import { resolve } from "path";
import { listTemplates } from "create-reactive-agent";
import { formatCost } from "../src/ui.js";

const CLI_ENTRY = resolve(import.meta.dir, "../src/index.ts");

// Each subprocess cold-starts `bun src/index.ts` (whole workspace from src), which
// takes seconds under full-suite load. The child gets a generous kill timeout and
// the test timeout sits above it, so a slow child finishes (or fails with a clear
// timeout) instead of being killed mid-run by the test runner (`exit code null`).
const CHILD_TIMEOUT_MS = 60_000;
const TEST_TIMEOUT_MS = CHILD_TIMEOUT_MS + 30_000;

interface CliResult {
  readonly code: number | null;
  readonly signal: number | string | null;
  readonly out: string;
  readonly err: string;
}

/** Spawns the CLI asynchronously and waits for both pipes and the exit code. */
const runCli = async (args: readonly string[]): Promise<CliResult> => {
  const proc = Bun.spawn(["bun", CLI_ENTRY, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    timeout: CHILD_TIMEOUT_MS,
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, signal: proc.signalCode, out, err };
};

/** Asserts a clean exit, printing the signal and stderr when it was not. */
const expectExitZero = (r: CliResult): void => {
  expect({ code: r.code, signal: r.signal, err: r.code === 0 ? "" : r.err }).toEqual({
    code: 0,
    signal: null,
    err: "",
  });
};

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
  }, TEST_TIMEOUT_MS);

  it("should parse CLI help without errors", async () => {
    expectExitZero(await runCli(["help"]));
  }, TEST_TIMEOUT_MS);

  it("should show run command in help text", async () => {
    const r = await runCli(["help"]);
    const helpText = r.out + r.err;
    expect(helpText).toContain("run");
    expect(helpText).toContain("rax"); // CLI brand name
  }, TEST_TIMEOUT_MS);

  // Piped runs (stdout is not a TTY), as in CI or `rax run ... | tee`.
  const runPiped = (...flags: string[]) => runCli(["run", "What is 2+2?", "--provider", "test", ...flags]);

  it("--tools enables the built-in tools (no 'no capability tools' warning)", async () => {
    const r = await runPiped("--tools");
    expectExitZero(r);
    expect(r.out + r.err).not.toContain("no capability tools");
  }, TEST_TIMEOUT_MS);

  it("--quiet prints the answer with no CLI chrome", async () => {
    const r = await runPiped("--quiet");
    expectExitZero(r);
    expect(r.out.trim().split("\n").at(-1)).toBe("Test response.");
    expect(r.out + r.err).not.toContain("Executing");
    expect(r.out).not.toContain("Metrics");
  }, TEST_TIMEOUT_MS);

  it("--verbose shows phase lines even off a TTY", async () => {
    const r = await runPiped("--verbose");
    expectExitZero(r);
    expect(r.out).toContain("[phase:");
  }, TEST_TIMEOUT_MS);

  it("default piped run prints no phase lines", async () => {
    const r = await runPiped();
    expectExitZero(r);
    expect(r.out).not.toContain("[phase:");
    expect(r.out).toContain("Test response.");
  }, TEST_TIMEOUT_MS);

  it("prints the run's cost as an exact total when every call was priced", async () => {
    const r = await runPiped();
    expectExitZero(r);
    const line = r.out.split("\n").find((l) => l.includes("Cost"));
    expect(line).toContain("$0.000000");
    expect(line).not.toContain("some prices unknown");
  }, TEST_TIMEOUT_MS);

  it("formatCost marks a partial total as a lower bound, never as exact", () => {
    expect(formatCost({ usd: 0.0123, complete: true })).toBe("$0.012300");
    expect(formatCost({ usd: 0.0123, complete: false })).toBe(">= $0.012300 (some prices unknown)");
    expect(formatCost({ usd: 1, complete: true }, 5)).toBe("$1.00000");
  });

  it("run usage lists --cortex", async () => {
    const r = await runCli(["run"]);
    expect(r.code).not.toBe(0);
    expect(r.out + r.err).toContain("--cortex");
  }, TEST_TIMEOUT_MS);

  it("run usage points npm users to `rax cortex`, not the contributor `bun cortex`", async () => {
    const r = await runCli(["run"]);
    expect(r.out + r.err).toContain("rax cortex");
    expect(r.out + r.err).not.toContain("bun cortex");
  }, TEST_TIMEOUT_MS);

  it("main help lists exactly the scaffolder's init templates", async () => {
    const r = await runCli(["help"]);
    expectExitZero(r);
    const line = r.out.split("\n").find((l) => l.trim().startsWith("templates:"));
    expect(line?.trim()).toBe(`templates: ${listTemplates().map((t) => t.name).join(", ")}`);
    expect(r.out).not.toContain("minimal|standard|full");
  }, TEST_TIMEOUT_MS);
});
