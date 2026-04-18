import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { gitCliTool, makeGitCliHandler } from "../../../src/skills/cli/git-cli.js";
import { ToolExecutionError } from "../../../src/errors.js";
import type { CliRunner } from "../../../src/skills/cli/cli-runner.js";

function mockRunner(stdout: string, stderr = "", exitCode = 0): CliRunner {
  return async (_cmd, _args, _timeout) => ({ stdout, stderr, exitCode });
}

function failingRunner(message: string): CliRunner {
  return async () => { throw new Error(message); };
}

describe("gitCliTool definition", () => {
  it("has name git-cli", () => {
    expect(gitCliTool.name).toBe("git-cli");
  });

  it("has a command parameter", () => {
    const names = gitCliTool.parameters.map((p) => p.name);
    expect(names).toContain("command");
  });

  it("is medium risk", () => {
    expect(gitCliTool.riskLevel).toBe("medium");
  });

  it("requires no approval (read-default, write guarded by agent)", () => {
    expect(gitCliTool.requiresApproval).toBe(false);
  });

  it("is in the vcs category", () => {
    expect(gitCliTool.category).toBe("vcs");
  });
});

describe("makeGitCliHandler", () => {
  it("returns stdout and exitCode on success", async () => {
    const handler = makeGitCliHandler(mockRunner("On branch main\nnothing to commit"));

    const result = await Effect.runPromise(
      handler({ command: "status" }),
    );

    expect(result.stdout).toContain("On branch main");
    expect(result.exitCode).toBe(0);
    expect(result.command).toBe("git status");
  });

  it("splits multi-word command into args correctly", async () => {
    let capturedArgs: string[] = [];
    const runner: CliRunner = async (_cmd, args) => {
      capturedArgs = args;
      return { stdout: "", stderr: "", exitCode: 0 };
    };

    await Effect.runPromise(makeGitCliHandler(runner)({ command: "log --oneline -5" }));

    expect(capturedArgs).toEqual(["log", "--oneline", "-5"]);
  });

  it("includes durationMs in result", async () => {
    const result = await Effect.runPromise(
      makeGitCliHandler(mockRunner(""))({ command: "status" }),
    );

    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("returns ToolExecutionError on non-zero exit code", async () => {
    const runner: CliRunner = async () => ({
      stdout: "",
      stderr: "fatal: not a git repository",
      exitCode: 128,
    });

    const err = await Effect.runPromise(
      makeGitCliHandler(runner)({ command: "status" }).pipe(Effect.flip),
    );

    expect(err).toBeInstanceOf(ToolExecutionError);
    expect(err.message).toContain("exit 128");
  });

  it("returns ToolExecutionError when subprocess throws", async () => {
    const err = await Effect.runPromise(
      makeGitCliHandler(failingRunner("git not found"))({ command: "status" }).pipe(Effect.flip),
    );

    expect(err).toBeInstanceOf(ToolExecutionError);
    expect(err.message).toContain("git not found");
  });

  it("rejects empty command", async () => {
    const err = await Effect.runPromise(
      makeGitCliHandler(mockRunner(""))({ command: "" }).pipe(Effect.flip),
    );

    expect(err).toBeInstanceOf(ToolExecutionError);
  });

  it("truncates very long output and adds a note", async () => {
    const longOutput = "x".repeat(50_000);
    const result = await Effect.runPromise(
      makeGitCliHandler(mockRunner(longOutput))({ command: "log" }),
    );

    expect(result.stdout.length).toBeLessThan(longOutput.length);
    expect(result.truncated).toBe(true);
  });
}, { timeout: 15000 });
