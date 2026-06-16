import { describe, it, expect } from "bun:test";
import { cortexRunsPostBody } from "./cortex-runs-post-body.js";
import { defaultConfig } from "./types/agent-config.js";

describe("cortexRunsPostBody", () => {
  it("includes taskContext when non-empty", () => {
    const cfg = {
      ...defaultConfig(),
      taskContext: { project: "acme", environment: "staging" },
    };
    const body = cortexRunsPostBody("do the thing", cfg) as { prompt: string; taskContext?: Record<string, string> };
    expect(body.prompt).toBe("do the thing");
    expect(body.taskContext).toEqual({ project: "acme", environment: "staging" });
  });

  it("omits taskContext when empty", () => {
    const body = cortexRunsPostBody("x", defaultConfig()) as { taskContext?: unknown };
    expect(body.taskContext).toBeUndefined();
  });

  it("includes runtimeVerification and terminalTools only when enabled", () => {
    const off = cortexRunsPostBody("x", defaultConfig()) as {
      runtimeVerification?: boolean;
      terminalTools?: boolean;
    };
    expect(off.runtimeVerification).toBeUndefined();
    expect(off.terminalTools).toBeUndefined();

    const on = cortexRunsPostBody("x", {
      ...defaultConfig(),
      runtimeVerification: true,
      terminalTools: true,
    }) as { runtimeVerification?: boolean; terminalTools?: boolean };
    expect(on.runtimeVerification).toBe(true);
    expect(on.terminalTools).toBe(true);
  });

  it("includes auditRationale only when enabled", () => {
    const off = cortexRunsPostBody("x", defaultConfig()) as { auditRationale?: boolean };
    expect(off.auditRationale).toBeUndefined();

    const on = cortexRunsPostBody("x", { ...defaultConfig(), auditRationale: true }) as {
      auditRationale?: boolean;
    };
    expect(on.auditRationale).toBe(true);
  });

  it("includes additionalToolNames when non-empty", () => {
    const body = cortexRunsPostBody("x", {
      ...defaultConfig(),
      additionalToolNames: "  foo, bar  ",
    }) as { additionalToolNames?: string };
    expect(body.additionalToolNames).toBe("foo, bar");
  });

  it("omits additionalToolNames when blank", () => {
    const body = cortexRunsPostBody("x", defaultConfig()) as { additionalToolNames?: string };
    expect(body.additionalToolNames).toBeUndefined();
  });

  it("includes numCtx when positive, omits when 0", () => {
    const on = cortexRunsPostBody("x", { ...defaultConfig(), numCtx: 32768 }) as { numCtx?: number };
    expect(on.numCtx).toBe(32768);

    const off = cortexRunsPostBody("x", { ...defaultConfig(), numCtx: 0 }) as { numCtx?: number };
    expect(off.numCtx).toBeUndefined();
  });

  it("includes shell command fields only when shell is active and non-empty", () => {
    const off = cortexRunsPostBody("x", {
      ...defaultConfig(),
      terminalTools: false,
      terminalShellAdditionalCommands: "node",
      tools: ["web-search"],
    }) as { terminalShellAdditionalCommands?: string; terminalShellAllowedCommands?: string };
    expect(off.terminalShellAdditionalCommands).toBeUndefined();

    const on = cortexRunsPostBody("x", {
      ...defaultConfig(),
      terminalTools: true,
      terminalShellAdditionalCommands: "  bun  ",
      terminalShellAllowedCommands: "git",
    }) as { terminalShellAdditionalCommands?: string; terminalShellAllowedCommands?: string };
    expect(on.terminalShellAdditionalCommands).toBe("bun");
    expect(on.terminalShellAllowedCommands).toBe("git");
  });

  it("emits variables + variableValues when present", () => {
    const cfg = {
      ...defaultConfig(),
      prompt: "Do {{task}}",
      variables: [{ name: "task", type: "string" as const, required: true }],
    };
    const body = cortexRunsPostBody("Do {{task}}", cfg, { task: "research" });
    expect(body.variables).toEqual(cfg.variables);
    expect(body.variableValues).toEqual({ task: "research" });
  });

  it("omits variable fields when no variables", () => {
    const body = cortexRunsPostBody("hi", defaultConfig());
    expect("variables" in body).toBe(false);
    expect("variableValues" in body).toBe(false);
  });
});

describe("cortexRunsPostBody — useReasoning (inline-think opt-out)", () => {
  it("omits useReasoning by default (reasoning kernel is the server default)", () => {
    const body = cortexRunsPostBody("x", defaultConfig()) as { useReasoning?: boolean };
    expect(body.useReasoning).toBeUndefined();
  });
  it("sends useReasoning:false when the user opts into inline-think", () => {
    const body = cortexRunsPostBody("x", { ...defaultConfig(), useReasoning: false }) as { useReasoning?: boolean };
    expect(body.useReasoning).toBe(false);
  });
});

describe("cortexRunsPostBody — durable execution", () => {
  it("omits durableRuns when disabled", () => {
    const body = cortexRunsPostBody("x", defaultConfig()) as { durableRuns?: unknown };
    expect(body.durableRuns).toBeUndefined();
  });
  it("sends durableRuns + approvalPolicy when enabled with gated tools", () => {
    const cfg = { ...defaultConfig(), tools: ["file-read", "shell-execute"], durableRuns: { enabled: true, approvalTools: ["shell-execute"] } };
    const body = cortexRunsPostBody("x", cfg) as { durableRuns?: { enabled: boolean; approvalPolicy?: { tools: string[]; mode: string } } };
    expect(body.durableRuns?.enabled).toBe(true);
    expect(body.durableRuns?.approvalPolicy?.tools).toEqual(["shell-execute"]);
    expect(body.durableRuns?.approvalPolicy?.mode).toBe("detach");
  });
});
