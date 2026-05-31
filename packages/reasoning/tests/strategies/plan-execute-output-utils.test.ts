import { describe, it, expect } from "bun:test";
import { stripDeadStorageHints } from "../../src/strategies/plan-execute/output-utils.js";

/**
 * Dead-hint strip (#2 honesty fix, 2026-05-31).
 *
 * plan-execute's tool_call steps compress results via `compressToolResult`, which
 * emits `[STORED: _tool_result_N]` headers + `recall("_tool_result_N", …)` coverage
 * hints. But plan-execute DISCARDS the full data (never writes the scratchpad the
 * kernel's resolver reads) AND injects the result into tool-less single-shot prompts
 * (analysis/reflection/synthesis) where recall is uncallable. So those hints are
 * DEAD pointers — they tell the model to recall a key that was never stored and
 * cannot be called, risking fabricated tails or echoed framework scaffolding (which
 * evidence-grounding HARD-fails). Strip them; re-append NOTHING (no key was stored —
 * unlike the kernel act path, which stores + re-appends one honest recall line).
 */
describe("stripDeadStorageHints", () => {
  it("strips the [STORED:] header and recall() coverage hint from a truncated array preview", () => {
    const compressed =
      `[STORED: _tool_result_3 | github/list_commits]\n` +
      `Type: Array(300) | Schema: commit.message, commit.author.name\n` +
      `Preview (first 8 of 300):\n` +
      `  [0] sha=abc1234 | message=fix bug | author=Ada | date=2026-05-01\n` +
      `  [1] sha=def5678 | message=add test | author=Bo | date=2026-05-02\n` +
      `  ...292 more\n` +
      `  — full data is stored. Use recall("_tool_result_3", arrayStart: 8, arrayCount: 292) for remaining commits.`;
    const out = stripDeadStorageHints(compressed, "github/list_commits");

    // Dead pointers gone.
    expect(out).not.toContain("[STORED:");
    expect(out).not.toContain("recall(");
    expect(out).not.toContain("_tool_result_3");
    expect(out).not.toContain("full data is stored");
    // Real preview content preserved.
    expect(out).toContain("fix bug");
    expect(out).toContain("add test");
    expect(out).toContain("...292 more");
    // A useful label replaces the [STORED:] header.
    expect(out).toContain("github/list_commits");
  });

  it("strips the [STORED:] header + ✓ line from a show-all preview, keeps commits", () => {
    const compressed =
      `[STORED: _tool_result_1 | github/list_commits]\n` +
      `Type: Array(2) | Schema: commit.message\n` +
      `All 2 commits:\n` +
      `  [0] sha=abc | message=one | author=A | date=d\n` +
      `  [1] sha=def | message=two | author=B | date=d\n` +
      `  ✓ Preview includes all commits with exact message/author/date values.`;
    const out = stripDeadStorageHints(compressed, "github/list_commits");
    expect(out).not.toContain("[STORED:");
    expect(out).not.toContain("✓ Preview includes");
    expect(out).toContain("message=one");
    expect(out).toContain("message=two");
  });

  it("leaves content with no storage hints unchanged", () => {
    const plain = "Step produced: 42 widgets, all green.";
    expect(stripDeadStorageHints(plain, "analysis")).toBe(plain);
  });
});
