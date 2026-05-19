import { describe, it, expect } from "bun:test";

function isToolBlocked(
  toolName: string,
  allowedTools: readonly string[],
  metaTools: ReadonlySet<string>,
): boolean {
  if (allowedTools.length === 0) return false;
  if (metaTools.has(toolName)) return false;
  return !allowedTools.includes(toolName);
}

const META = new Set(["final-answer", "task-complete", "brief", "pulse", "recall", "find", "context-status"]);

describe("act allowedTools gate", () => {
  it("blocks non-allowed user tools", () => {
    expect(isToolBlocked("web-search", ["crypto-price"], META)).toBe(true);
  });

  it("allows tools in allowedTools", () => {
    expect(isToolBlocked("crypto-price", ["crypto-price", "web-search"], META)).toBe(false);
  });

  it("never blocks meta-tools", () => {
    expect(isToolBlocked("final-answer", ["crypto-price"], META)).toBe(false);
    expect(isToolBlocked("recall", ["crypto-price"], META)).toBe(false);
  });

  it("blocks nothing when allowedTools is empty", () => {
    expect(isToolBlocked("anything", [], META)).toBe(false);
  });
});
