import { describe, expect, it } from "bun:test";
import { MIN_GAP_MAX_MS, pacingDraftFromWire, pacingProblems, pacingWireFromDraft } from "./channel-pacing.js";

describe("route pacing (minGapMs)", () => {
  it("reads a saved gap into the editor and an unset one as blank", () => {
    expect(pacingDraftFromWire({ minGapMs: 1500 })).toEqual({ minGapMs: "1500" });
    expect(pacingDraftFromWire({})).toEqual({ minGapMs: "" });
  });
  it("writes only a positive gap; blank and 0 stay off", () => {
    expect(pacingWireFromDraft({ minGapMs: "1500" })).toEqual({ minGapMs: 1500 });
    expect(pacingWireFromDraft({ minGapMs: "" })).toEqual({});
    expect(pacingWireFromDraft({ minGapMs: "0" })).toEqual({});
    expect(pacingWireFromDraft({ minGapMs: "abc" })).toEqual({});
  });
  it("refuses values the framework refuses (0 to 60000, whole numbers)", () => {
    expect(pacingProblems({ minGapMs: "" })).toEqual([]);
    expect(pacingProblems({ minGapMs: String(MIN_GAP_MAX_MS) })).toEqual([]);
    expect(pacingProblems({ minGapMs: String(MIN_GAP_MAX_MS + 1) })).toHaveLength(1);
    expect(pacingProblems({ minGapMs: "1.5" })).toHaveLength(1);
    expect(pacingProblems({ minGapMs: "-1" })).toHaveLength(1);
  });
});
