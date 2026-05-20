import { describe, it, expect } from "bun:test";
import { withEnvContext } from "../../src/context/context-engine.js";

describe("withEnvContext — env injection for direct LLM call sites", () => {
  it("prepends an Environment: block with current date to a non-empty systemPrompt", () => {
    const sp = "You are a Crypto Analyst. Timestamp your work.";
    const out = withEnvContext(sp);
    expect(out).toContain("Environment:");
    expect(out).toContain("Date:");
    expect(out).toContain("Timezone:");
    // Original systemPrompt preserved after the env block.
    expect(out).toContain(sp);
    // Env appears first so it survives middle-truncation strategies.
    expect(out.indexOf("Environment:")).toBeLessThan(out.indexOf(sp));
  });

  it("returns env block alone when systemPrompt is undefined or empty", () => {
    const a = withEnvContext(undefined);
    const b = withEnvContext("");
    expect(a).toContain("Environment:");
    expect(b).toContain("Environment:");
    // No leading whitespace from a phantom systemPrompt.
    expect(a.startsWith("Environment:")).toBe(true);
  });

  it("merges custom environmentContext fields into the env block", () => {
    const out = withEnvContext("base", { Agent: "Crypto Analyst", RunId: "abc123" });
    expect(out).toContain("Agent: Crypto Analyst");
    expect(out).toContain("RunId: abc123");
  });

  it("includes today's year (auto-detected via new Date)", () => {
    const out = withEnvContext("base");
    const year = new Date().getFullYear().toString();
    expect(out).toContain(year);
  });
});
