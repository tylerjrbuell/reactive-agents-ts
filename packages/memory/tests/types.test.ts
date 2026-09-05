import { describe, it, expect } from "bun:test";
import { defaultMemoryConfig, defaultUserMemoryPath } from "../src/types.js";

describe("default dbPath resolution", () => {
  // Regression: defaultMemoryConfig() (used by createMemoryLayer() and the
  // `rax skills` CLI) and defaultUserMemoryPath() (used by the runtime
  // builder's auto-enabled memory) used to resolve to two different paths —
  // one cwd-relative, one $HOME-anchored — so which location an agent's
  // memory actually lived in silently depended on which API created it.
  // A CLI (or a second .withMemory() call) run from a different directory
  // than the original agent run would look in the wrong place and find
  // nothing. They must now agree, for every agentId.
  it("defaultMemoryConfig().dbPath matches defaultUserMemoryPath() for the same agentId", () => {
    for (const agentId of ["agent-x", "cortex-desk-123", "scratch-456"]) {
      expect(defaultMemoryConfig(agentId).dbPath).toBe(defaultUserMemoryPath(agentId));
    }
  });

  it("resolves under $HOME with the memory/<agentId>/memory.db shape", () => {
    const home = process.env.HOME ?? process.env.USERPROFILE;
    if (!home) return; // sandboxed runtime with no $HOME — cwd fallback path, not under test here

    const path = defaultUserMemoryPath("agent-x");
    expect(path).toBe(`${home}/.reactive-agents/memory/agent-x/memory.db`);
  });

  it("two different agentIds never collide on the same dbPath", () => {
    expect(defaultUserMemoryPath("agent-a")).not.toBe(defaultUserMemoryPath("agent-b"));
  });
});
