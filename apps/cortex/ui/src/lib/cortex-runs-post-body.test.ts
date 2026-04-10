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
});
