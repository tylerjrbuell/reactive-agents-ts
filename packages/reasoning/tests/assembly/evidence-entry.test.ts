import { describe, it, expect } from "bun:test";
import {
  evidenceFromStep,
  evidenceFromStored,
  evidenceFromPlanResult,
  type EvidenceEntry,
} from "../../src/assembly/evidence-entry.js";
import { ResultStore } from "../../src/assembly/result-store.js";

describe("EvidenceEntry — unifies the three scattered representations (audit 03-#14)", () => {
  it("rep #1 scratchpad/_tool_result_* step → reuses step.ts storedKey + extractedFact", () => {
    const step = {
      content: "[STORED: _tool_result_3] compressed preview…",
      metadata: { storedKey: "_tool_result_3", extractedFact: "42 open PRs" },
    };
    const e: EvidenceEntry = evidenceFromStep(step, 20, "full raw payload here");
    expect(e.full).toBe("full raw payload here");
    expect(e.preview).toBe("[STORED: _tool_resul"); // 20-char head
    expect(e.extractedFact).toBe("42 open PRs");
    expect(e.storedKey).toBe("_tool_result_3");
  });

  it("rep #1: a non-recallable storedKey is dropped (no dead recall pointer)", () => {
    const step = { content: "x", metadata: { storedKey: "res_deadbeef00" } };
    expect(evidenceFromStep(step, 10).storedKey).toBeUndefined();
  });

  it("rep #2 ResultStore recallable ref → carries storedKey", () => {
    const s = new ResultStore();
    const big = Array.from({ length: 400 }, (_, i) => ({ i, msg: `m${i}` }));
    s.putWithRef("_tool_result_9", "web-search", big);
    const e = evidenceFromStored(s, "_tool_result_9", 400);
    expect(e.storedKey).toBe("_tool_result_9");
    expect(e.full.length).toBeGreaterThan(e.preview.length); // preview is bounded
  });

  it("rep #2 ResultStore minted (res_) ref → NO storedKey (not recall-resolvable)", () => {
    const s = new ResultStore();
    const ref = s.put("web-search", { a: 1 });
    const e = evidenceFromStored(s, ref, 400);
    expect(e.storedKey).toBeUndefined();
  });

  it("rep #3 from_step value → full prefers fullResult, preview is the compressed result", () => {
    const e = evidenceFromPlanResult("short preview", "the whole uncompressed content");
    expect(e.full).toBe("the whole uncompressed content");
    expect(e.preview).toBe("short preview");
    expect(e.storedKey).toBeUndefined();
    // analysis steps have no fullResult → result IS full
    expect(evidenceFromPlanResult("only this").full).toBe("only this");
  });
});
