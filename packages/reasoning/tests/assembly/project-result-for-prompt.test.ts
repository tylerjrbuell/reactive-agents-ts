import { describe, it, expect } from "bun:test";
import { ResultStore } from "../../src/assembly/result-store.js";
import { projectResultForPrompt } from "../../src/assembly/project-result-for-prompt.js";

/**
 * (3a) single-shot result projector — substrate unification (#2).
 *
 * Non-reactive strategies (plan-execute/ToT/reflexion) inject prior results into
 * single-shot prompts. They used a SECOND projection policy (compressToolResult +
 * scratchpad-pointer) parallel to reactive's ResultStore.preview + result_ref (#1).
 * projectResultForPrompt unifies them: one ResultStore, one preview+ref policy.
 */
describe("projectResultForPrompt — single-shot result injection (3a)", () => {
  it("an overflowing structured result projects to preview+ref, never raw", () => {
    const store = new ResultStore();
    // 22 spread markdown sections — the #1 overflow shape.
    const big =
      "# Doc\n" +
      Array.from({ length: 22 }, (_, i) => `## Section ${i}\nlead line ${i}\n${"body ".repeat(200)}`).join("\n");
    const { ref, text } = projectResultForPrompt(store, "github/list_commits", big, 1500);

    // Bounded: never the raw 30k+ doc.
    expect(text.length).toBeLessThan(big.length / 2);
    // Faithful + actionable: honest truncation marker + the ref.
    expect(text).toContain(`result_ref="${ref}"`);
    expect(text).toContain("content truncated");
    // Structure-aware: every section heading stays visible (skeleton), not just head.
    expect(text).toContain("## Section 0");
    expect(text).toContain("## Section 21");
    // NOT the old scratchpad-pointer format.
    expect(text).not.toContain("[STORED:");

    // Recoverable: full data resolves system-side by ref.
    expect(store.materialize(ref)).toContain("body");
    expect(store.get(ref)?.value).toBe(big);
  });

  it("a result that fits the budget is returned full, no marker noise", () => {
    const store = new ResultStore();
    const small = "short result";
    const { ref, text } = projectResultForPrompt(store, "ping", small, 1500);
    expect(text).toBe(small);
    expect(text).not.toContain("content truncated");
    expect(store.has(ref)).toBe(true);
  });

  it("two calls with identical value share one ref (content-addressed, no dup)", () => {
    const store = new ResultStore();
    const a = projectResultForPrompt(store, "t", { x: 1 }, 500);
    const b = projectResultForPrompt(store, "t", { x: 1 }, 500);
    expect(a.ref).toBe(b.ref);
  });
});
