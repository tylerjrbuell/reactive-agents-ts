import { describe, it, expect } from "bun:test";
import {
  applyOverhaulContextProjection,
  summarizeStored,
  overhaulProjectionEnabled,
} from "../../src/overhaul/context-projection.js";

const big = JSON.stringify(Array.from({ length: 20 }, (_, i) => ({ sha: `s${i}`, commit: { message: `m${i}` } })));

describe("overhaul/context-projection — clean summary+ref, no marker", () => {
  it("projects an OVERFLOWING stored tool_result to a clean summary+ref (no marker/preview/recall)", () => {
    const scratch = new Map([["_tool_result_1", big]]);
    const msgs = [
      { role: "user", content: "task" },
      { role: "tool_result", toolName: "github/list_commits", storedKey: "_tool_result_1", content: "[STORED: _tool_result_1] Preview (first 8 of 20)... recall(...)" },
    ];
    const out = applyOverhaulContextProjection(msgs, scratch, 100); // budget 100 < big
    const tr = out[1]!.content;
    expect(tr).toContain('result_ref="_tool_result_1"');
    expect(tr).toContain("write_result_to_file");
    expect(tr).toContain("Array(20)");
    expect(tr).not.toContain("[STORED:");
    expect(tr).not.toContain("Preview");
    expect(tr).not.toContain("recall(");
    expect(tr).not.toContain("m0"); // no bulk data leaks
  });

  it("leaves a FITTING stored result untouched (model may still reason/transcribe)", () => {
    const scratch = new Map([["_tool_result_1", big]]);
    const msgs = [{ role: "tool_result", storedKey: "_tool_result_1", content: "full data here" }];
    const out = applyOverhaulContextProjection(msgs, scratch, 10_000); // budget > big
    expect(out[0]!.content).toBe("full data here");
  });

  it("leaves messages with no storedKey untouched", () => {
    const msgs = [{ role: "tool_result", content: "small inline result" }];
    expect(applyOverhaulContextProjection(msgs, new Map(), 0)[0]!.content).toBe("small inline result");
  });

  it("enabled only under RA_OVERHAUL=1", () => {
    expect(overhaulProjectionEnabled({ RA_OVERHAUL: "1" } as NodeJS.ProcessEnv)).toBe(true);
    expect(overhaulProjectionEnabled({} as NodeJS.ProcessEnv)).toBe(false);
  });

  it("summary names ref + tool, omits bulk", () => {
    const s = summarizeStored("_tool_result_1", "github/list_commits", big);
    expect(s).toContain('result_ref="_tool_result_1"');
    expect(s).toContain("github/list_commits");
    expect(s).not.toContain("m5");
  });
});
