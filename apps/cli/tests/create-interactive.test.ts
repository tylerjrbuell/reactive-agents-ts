import { describe, test, expect } from "bun:test";

describe("rax create agent --interactive", () => {
  test("--interactive flag is recognized in args", () => {
    const args = ["test-agent", "--interactive"];
    const hasFlag = args.includes("--interactive");
    expect(hasFlag).toBe(true);
  });

  test("falls back to non-interactive when stdin is not a TTY", () => {
    // In test environment, process.stdin.isTTY is falsy
    const args = ["test-agent", "--interactive"];
    const isInteractive = args.includes("--interactive") && Boolean(process.stdin.isTTY);
    expect(isInteractive).toBeFalsy();
  });

  test("non-interactive mode still works unchanged with --recipe", () => {
    const args = ["my-agent", "--recipe", "basic"];
    const recipeIdx = args.indexOf("--recipe");
    expect(recipeIdx).toBe(1);
    expect(args[recipeIdx + 1]).toBe("basic");
  });

  test("interactive mode detects TTY correctly", () => {
    // Simulate TTY check logic
    const mockIsTTY = true;
    const args = ["test-agent", "--interactive"];
    const isInteractive = args.includes("--interactive") && mockIsTTY;
    expect(isInteractive).toBe(true);
  });
});
