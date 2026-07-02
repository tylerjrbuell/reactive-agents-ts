// Run: bun test packages/runtime/tests/approval-autofeed.test.ts --timeout 15000
//
// F2 — per-tool requiresApproval flags were inert: shell-execute / code-execute
// / file-write (all requiresApproval: true) ran with no approval even under a
// configured policy unless re-listed by hand. The approval policy now folds
// those flags in at config assembly.
import { describe, test, expect } from "bun:test";
import {
  requiresApprovalToolNames,
  foldApprovalRequiredTools,
} from "../src/builder/build-effect/approval-autofeed.js";

describe("F2 — approval auto-feed", () => {
  test("requiresApprovalToolNames selects only flagged defs", () => {
    const names = requiresApprovalToolNames([
      { name: "danger", requiresApproval: true },
      { name: "safe", requiresApproval: false },
      { name: "unflagged" },
    ]);
    expect(names).toEqual(["danger"]);
  });

  test("folds registered requiresApproval defs and preserves configured tools", () => {
    const tools = foldApprovalRequiredTools(
      ["already-listed"],
      [
        { name: "shell-execute", requiresApproval: true },
        { name: "code-execute", requiresApproval: true },
        { name: "file-write", requiresApproval: true },
        { name: "web-search", requiresApproval: false },
      ],
    );
    expect(tools).toContain("already-listed");
    expect(tools).toContain("shell-execute");
    expect(tools).toContain("code-execute");
    expect(tools).toContain("file-write");
    expect(tools).not.toContain("web-search");
  });

  test("deduplicates a tool already listed in the policy", () => {
    const tools = foldApprovalRequiredTools(
      ["shell-execute"],
      [{ name: "shell-execute", requiresApproval: true }],
    );
    expect(tools.filter((t) => t === "shell-execute")).toHaveLength(1);
  });
});
