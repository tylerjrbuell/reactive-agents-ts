// Run: bun test packages/reasoning/tests/kernel/code-execute-shell-refusal.test.ts
//
// code-execute refuses shell input with {executed:false, shellCommand:true, error}
// (tools 3f155285e). The kernel used to wrap every executed:false as
// "[Code execution failed: ...] Fix the code and retry." For a shell command
// that is a false steer: there is no code to fix. Measured in rw-7 +
// lh-debug-green: 9 of 9 code-execute calls were shell commands.
//
// The observation must say the call did not run, and name shell-execute only
// when the model can call it this run (same law as recovery-hint-availability).

import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import { executeNativeToolCall } from "../../src/kernel/capabilities/act/tool-execution.js";
import type { ToolServiceInstance } from "../../src/kernel/state/kernel-state.js";

const SHELL_ERROR = "Input looks like a shell command, not code.";

const serviceReturning = (result: unknown): ToolServiceInstance => ({
  execute: (_input) => Effect.succeed({ result, success: true }),
  getTool: (_name) => Effect.succeed({ parameters: [{ name: "code", type: "string", required: true }] }),
  // Full registry includes shell-execute; the observation must not trust it.
  listTools: () => Effect.succeed([{ name: "code-execute" }, { name: "shell-execute" }]),
});

const runCode = (result: unknown, exposed?: readonly string[]) =>
  Effect.runPromise(
    executeNativeToolCall(
      serviceReturning(result),
      { id: "c1", name: "code-execute", arguments: { code: "ls -la" } },
      "agent-1",
      "session-1",
      exposed === undefined ? {} : { exposedToolNames: new Set(exposed) },
    ),
  );

const shellRefusal = { executed: false, shellCommand: true, error: SHELL_ERROR };

describe("code-execute shell refusal observation", () => {
  it("WITH shell-execute exposed: says it did not run and names shell-execute", async () => {
    const r = await runCode(shellRefusal, ["code-execute", "shell-execute"]);
    expect(r.success).toBe(false);
    expect(r.content).toContain("code-execute did not run");
    expect(r.content).toContain(SHELL_ERROR);
    expect(r.content).toContain("Run shell commands with shell-execute.");
    expect(r.content).not.toContain("Fix the code and retry");
  });

  it("WITHOUT shell-execute exposed: never names it, says no shell tool is available", async () => {
    const r = await runCode(shellRefusal, ["code-execute"]);
    expect(r.success).toBe(false);
    expect(r.content).toContain("code-execute did not run");
    expect(r.content).not.toContain("shell-execute");
    expect(r.content).toContain("No shell tool is available in this run.");
    expect(r.content).not.toContain("Fix the code and retry");
  });

  it("registered-but-not-exposed: no exposed set supplied never names shell-execute", async () => {
    const r = await runCode(shellRefusal);
    expect(r.content).not.toContain("shell-execute");
    expect(r.content).toContain("No shell tool is available in this run.");
  });

  it("an ordinary code failure keeps today's text", async () => {
    const r = await runCode(
      { executed: false, error: "SyntaxError: Unexpected token" },
      ["code-execute", "shell-execute"],
    );
    expect(r.success).toBe(false);
    expect(r.content).toContain("[Code execution failed: SyntaxError: Unexpected token] Fix the code and retry.");
    expect(r.content).not.toContain("shell-execute");
  });
});
