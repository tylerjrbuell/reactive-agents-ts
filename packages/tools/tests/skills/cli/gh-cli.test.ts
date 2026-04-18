import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { ghCliTool, makeGhCliHandler } from "../../../src/skills/cli/gh-cli.js";
import { ToolExecutionError } from "../../../src/errors.js";
import type { CliRunner } from "../../../src/skills/cli/cli-runner.js";

function mockRunner(stdout: string, stderr = "", exitCode = 0): CliRunner {
  return async (_cmd, _args, _timeout) => ({ stdout, stderr, exitCode });
}

describe("ghCliTool definition", () => {
  it("has name gh-cli", () => {
    expect(ghCliTool.name).toBe("gh-cli");
  });

  it("has a command parameter", () => {
    const names = ghCliTool.parameters.map((p) => p.name);
    expect(names).toContain("command");
  });

  it("is medium risk", () => {
    expect(ghCliTool.riskLevel).toBe("medium");
  });

  it("is in the vcs category", () => {
    expect(ghCliTool.category).toBe("vcs");
  });
});

describe("makeGhCliHandler", () => {
  it("returns stdout and exitCode on success", async () => {
    const prJson = JSON.stringify([{ number: 42, title: "Fix bug", state: "open" }]);
    const result = await Effect.runPromise(
      makeGhCliHandler(mockRunner(prJson))({ command: "pr list --json number,title,state" }),
    );

    expect(result.stdout).toContain("Fix bug");
    expect(result.exitCode).toBe(0);
    expect(result.command).toBe("gh pr list --json number,title,state");
  });

  it("splits multi-word command into args correctly", async () => {
    let capturedArgs: string[] = [];
    const runner: CliRunner = async (_cmd, args) => {
      capturedArgs = args;
      return { stdout: "", stderr: "", exitCode: 0 };
    };

    await Effect.runPromise(makeGhCliHandler(runner)({ command: "issue list --state open" }));

    expect(capturedArgs).toEqual(["issue", "list", "--state", "open"]);
  });

  it("includes durationMs in result", async () => {
    const result = await Effect.runPromise(
      makeGhCliHandler(mockRunner(""))({ command: "repo view" }),
    );

    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("returns ToolExecutionError on non-zero exit code", async () => {
    const runner: CliRunner = async () => ({
      stdout: "",
      stderr: "pull request not found",
      exitCode: 1,
    });

    const err = await Effect.runPromise(
      makeGhCliHandler(runner)({ command: "pr view 99" }).pipe(Effect.flip),
    );

    expect(err).toBeInstanceOf(ToolExecutionError);
    expect(err.message).toContain("exit 1");
  });

  it("returns ToolExecutionError when subprocess throws", async () => {
    const runner: CliRunner = async () => { throw new Error("gh: command not found"); };

    const err = await Effect.runPromise(
      makeGhCliHandler(runner)({ command: "pr list" }).pipe(Effect.flip),
    );

    expect(err).toBeInstanceOf(ToolExecutionError);
    expect(err.message).toContain("gh: command not found");
  });

  it("rejects empty command", async () => {
    const err = await Effect.runPromise(
      makeGhCliHandler(mockRunner(""))({ command: "" }).pipe(Effect.flip),
    );

    expect(err).toBeInstanceOf(ToolExecutionError);
  });

  it("truncates very long output and adds a note", async () => {
    const longOutput = "x".repeat(50_000);
    const result = await Effect.runPromise(
      makeGhCliHandler(mockRunner(longOutput))({ command: "run list" }),
    );

    expect(result.stdout.length).toBeLessThan(longOutput.length);
    expect(result.truncated).toBe(true);
  });
}, { timeout: 15000 });
