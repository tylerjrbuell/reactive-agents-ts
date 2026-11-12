import { describe, expect, it } from "bun:test";
import { configAppliedNote, isLiveConfigCommand, slashMenuAllowed, submitRoute, turnModelOf } from "./chat-live-config.js";

describe("config during a run never queues", () => {
  it("config commands dispatch during a run; messages and other commands queue", () => {
    for (const cmd of ["model", "strategy", "tools", "terminal", "workspace", "iterations", "thinking", "provider", "mcp", "btw"]) {
      expect(submitRoute({ sending: true, command: cmd })).toBe("dispatch");
    }
    expect(submitRoute({ sending: true })).toBe("queue");
    expect(submitRoute({ sending: true, command: "clear" })).toBe("queue");
    expect(submitRoute({ sending: false })).toBe("dispatch");
    expect(submitRoute({ sending: false, command: "clear" })).toBe("dispatch");
  });

  it("the panel of a config command and the root list (config commands only) open during a run", () => {
    expect(slashMenuAllowed({ sending: true, command: "model", hasArg: true })).toBe(true);
    expect(slashMenuAllowed({ sending: true, hasArg: false })).toBe(true);
    expect(slashMenuAllowed({ sending: true, command: "rewind", hasArg: true })).toBe(false);
    expect(slashMenuAllowed({ sending: false, hasArg: false })).toBe(true);
    expect(isLiveConfigCommand(undefined)).toBe(false);
  });

  it("the toast says when a change lands", () => {
    expect(configAppliedNote("Model x", true)).toBe("Model x · applies to the next turn (this one keeps its settings)");
    expect(configAppliedNote("Model x", false)).toBe("Model x · applies to your next message");
  });

  it("a turn pins the provider and model it started with", () => {
    expect(turnModelOf({ provider: "ollama", model: "qwen3", strategy: "reactive" })).toEqual({ provider: "ollama", model: "qwen3" });
    expect(turnModelOf({ provider: "" })).toEqual({});
    expect(turnModelOf(undefined)).toEqual({});
  });
});
