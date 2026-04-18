import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { gwsCliTool, makeGwsCliHandler } from "../../../src/skills/cli/gws-cli.js";
import { ToolExecutionError } from "../../../src/errors.js";
import type { CliRunner } from "../../../src/skills/cli/cli-runner.js";

function mockRunner(stdout: string, stderr = "", exitCode = 0): CliRunner {
  return async (_cmd, _args, _timeout) => ({ stdout, stderr, exitCode });
}

describe("gwsCliTool definition", () => {
  it("has name gws-cli", () => {
    expect(gwsCliTool.name).toBe("gws-cli");
  });

  it("has a command parameter", () => {
    const names = gwsCliTool.parameters.map((p) => p.name);
    expect(names).toContain("command");
  });

  it("is medium risk", () => {
    expect(gwsCliTool.riskLevel).toBe("medium");
  });

  it("is in the productivity category", () => {
    expect(gwsCliTool.category).toBe("productivity");
  });
});

describe("makeGwsCliHandler", () => {
  it("returns stdout and exitCode on success", async () => {
    const calendarJson = JSON.stringify([{ summary: "Team Standup", start: "2026-04-17T10:00:00Z" }]);
    const result = await Effect.runPromise(
      makeGwsCliHandler(mockRunner(calendarJson))({ command: "calendar events list" }),
    );

    expect(result.stdout).toContain("Team Standup");
    expect(result.exitCode).toBe(0);
    expect(result.command).toBe("gws calendar events list");
  });

  it("splits multi-word command into args correctly", async () => {
    let capturedArgs: string[] = [];
    const runner: CliRunner = async (_cmd, args) => {
      capturedArgs = args;
      return { stdout: "", stderr: "", exitCode: 0 };
    };

    await Effect.runPromise(
      makeGwsCliHandler(runner)({ command: "drive files list --query name='report'" }),
    );

    expect(capturedArgs[0]).toBe("drive");
    expect(capturedArgs[1]).toBe("files");
    expect(capturedArgs[2]).toBe("list");
  });

  it("includes durationMs in result", async () => {
    const result = await Effect.runPromise(
      makeGwsCliHandler(mockRunner(""))({ command: "calendar events list" }),
    );

    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("returns ToolExecutionError on non-zero exit code", async () => {
    const runner: CliRunner = async () => ({
      stdout: "",
      stderr: "Error 403: insufficient permissions",
      exitCode: 1,
    });

    const err = await Effect.runPromise(
      makeGwsCliHandler(runner)({ command: "gmail messages list" }).pipe(Effect.flip),
    );

    expect(err).toBeInstanceOf(ToolExecutionError);
    expect(err.message).toContain("exit 1");
  });

  it("returns ToolExecutionError when subprocess throws", async () => {
    const runner: CliRunner = async () => { throw new Error("gws: command not found"); };

    const err = await Effect.runPromise(
      makeGwsCliHandler(runner)({ command: "calendar events list" }).pipe(Effect.flip),
    );

    expect(err).toBeInstanceOf(ToolExecutionError);
    expect(err.message).toContain("gws: command not found");
  });

  it("rejects empty command", async () => {
    const err = await Effect.runPromise(
      makeGwsCliHandler(mockRunner(""))({ command: "" }).pipe(Effect.flip),
    );

    expect(err).toBeInstanceOf(ToolExecutionError);
  });

  it("truncates very long output and adds a note", async () => {
    const longOutput = "x".repeat(50_000);
    const result = await Effect.runPromise(
      makeGwsCliHandler(mockRunner(longOutput))({ command: "gmail messages list" }),
    );

    expect(result.stdout.length).toBeLessThan(longOutput.length);
    expect(result.truncated).toBe(true);
  });
}, { timeout: 15000 });
