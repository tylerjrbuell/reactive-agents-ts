import { describe, it, expect } from "bun:test";
import {
  SCRATCHPAD_REF_PREFIX,
  mintScratchpadRef,
  isRecallableRef,
  renderRecallHint,
  SURFACED_RECALL_REF,
  surfacedRecallRefs,
  scratchpadRecallRefRe,
  fromStepRe,
  renderFromStepRef,
  type RecallMode,
} from "../../src/assembly/ref-grammar.js";

describe("ref-grammar — recallable namespace", () => {
  it("mints canonical scratchpad refs", () => {
    expect(mintScratchpadRef(3)).toBe("_tool_result_3");
    expect(mintScratchpadRef(3).startsWith(SCRATCHPAD_REF_PREFIX)).toBe(true);
  });

  it("classifies recallable vs non-recallable refs", () => {
    expect(isRecallableRef("_tool_result_7")).toBe(true);
    expect(isRecallableRef("res_ab12cd34ef56")).toBe(false); // minted content-hash ref
    expect(isRecallableRef("anything-else")).toBe(false);
  });
});

describe("ref-grammar — recall pointer: mint ⇄ match round-trip (the C3 invariant)", () => {
  // The load-bearing property: EVERY recall pointer the minter renders is
  // matched by the SINGLE gate matcher. Because both come from this module they
  // cannot drift → no dead pointers the gate fails to see (H2 generalized).
  const modes: RecallMode[] = ["full", "segment"];
  const refs = ["_tool_result_0", "_tool_result_42", "my_notes", "res_deadbeef"];

  for (const ref of refs) {
    for (const mode of modes) {
      it(`renderRecallHint(${ref}, ${mode}) is matched by SURFACED_RECALL_REF`, () => {
        const hint = renderRecallHint(ref, mode);
        expect(SURFACED_RECALL_REF.test(hint)).toBe(true);
        // …and the ref is extractable from the rendered pointer.
        expect(surfacedRecallRefs(hint)).toContain(ref);
      });
    }
  }

  it("full and segment modes render the documented vocabulary", () => {
    expect(renderRecallHint("_tool_result_1", "full")).toBe('recall("_tool_result_1", full: true)');
    expect(renderRecallHint("_tool_result_1", "segment")).toBe(
      'recall("_tool_result_1", start: 0, maxChars: 2000)',
    );
    expect(renderRecallHint("_tool_result_1")).toBe('recall("_tool_result_1", full: true)'); // default
  });

  it("inline (non-recall) text carries no recall marker", () => {
    expect(SURFACED_RECALL_REF.test('result_ref="res_abc"')).toBe(false);
  });
});

describe("ref-grammar — scratchpad-scoped resolver matcher", () => {
  it("captures only scratchpad-namespace refs", () => {
    const text = 'see recall("_tool_result_5", full: true) and recall("my_notes")';
    const keys = [...text.matchAll(scratchpadRecallRefRe())].map((m) => m[1]);
    expect(keys).toEqual(["_tool_result_5"]); // my_notes excluded — not resolvable there
  });

  it("returns a fresh regex each call (no shared lastIndex)", () => {
    expect(scratchpadRecallRefRe()).not.toBe(scratchpadRecallRefRe());
  });
});

describe("ref-grammar — from_step grammar", () => {
  it("renders bare / summary / full references", () => {
    expect(renderFromStepRef("s2")).toBe("{{from_step:s2}}");
    expect(renderFromStepRef("s2", "summary")).toBe("{{from_step:s2:summary}}");
    expect(renderFromStepRef("s2", "full")).toBe("{{from_step:s2:full}}");
  });

  it("matches every rendered from_step reference", () => {
    for (const mode of [undefined, "summary", "full"] as const) {
      const rendered = renderFromStepRef("s3", mode);
      const matches = [...rendered.matchAll(fromStepRe())];
      expect(matches.length).toBe(1);
      expect(matches[0]![1]).toBe("s3");
    }
  });

  it("returns a fresh regex each call", () => {
    expect(fromStepRe()).not.toBe(fromStepRe());
  });
});
