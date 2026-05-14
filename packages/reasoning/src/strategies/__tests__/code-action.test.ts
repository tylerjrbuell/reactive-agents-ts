import { describe, it, expect } from "bun:test";
import { executeCodeAction } from "../code-action.js";

describe("CodeAgentStrategy skeleton", () => {
  it("exports executeCodeAction function", () => {
    expect(typeof executeCodeAction).toBe("function");
  });

  it("strategy id is code-action", () => {
    expect((executeCodeAction as { strategyId?: string }).strategyId).toBe("code-action");
  });
});
