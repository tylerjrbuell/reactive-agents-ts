import { describe, it, expect } from "bun:test";
import { extractCodeBlock, buildPlanPrompt } from "../code-action-plan.js";

describe("buildPlanPrompt", () => {
  it("includes tool bindings in system prompt", () => {
    const bindings = `declare async function add(params: { a: number; b: number }): Promise<unknown>;`;
    const prompt = buildPlanPrompt("Sum 1+2", bindings);
    expect(prompt.system).toContain("add");
    expect(prompt.system).toContain("Promise<unknown>");
  });

  it("includes task description in user message", () => {
    const prompt = buildPlanPrompt("Sum 1+2", "");
    expect(prompt.user).toContain("Sum 1+2");
  });
});

describe("extractCodeBlock", () => {
  it("extracts code from a fenced typescript block", () => {
    const response = "Here is the code:\n```typescript\n(async () => { return 42; })()\n```";
    expect(extractCodeBlock(response)).toBe("(async () => { return 42; })()");
  });

  it("extracts code from a plain fenced block", () => {
    const response = "```\n(async () => { return 42; })()\n```";
    expect(extractCodeBlock(response)).toBe("(async () => { return 42; })()");
  });

  it("returns raw string if no fence found", () => {
    const response = "(async () => { return 42; })()";
    expect(extractCodeBlock(response)).toBe("(async () => { return 42; })()");
  });
});
