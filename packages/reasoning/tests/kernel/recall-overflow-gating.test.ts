// Run: bun test packages/reasoning/tests/kernel/recall-overflow-gating.test.ts --timeout 15000
//
// Inc 1 (tier-aware context architecture) — recall redundant-fire gate.
//
// Trace evidence (qwen3.5 T3, run 01KSV58K): get-hn-posts returned 3928 chars
// (≤ TOOL_RESULT_INLINE_CAP 4000) → data fully inline, NO storedKey surfaced.
// Model still called recall("hn_posts") BLIND (invented key, {"found":false})
// purely because recall was present in the tool schema. recall is only ever
// usable when a >4000 truncation surfaces a key in the CURRENT window
// (conversation-assembly:118 marker: `Full available via recall("<key>", full: true)`).
// This gate hides recall from the model-visible schema unless such a key is
// actually visible this iteration (or calibration force-enables it).
import { describe, it, expect } from "bun:test";
import {
  filterRecallByOverflow,
  recallKeyVisibleInWindow,
  recallGateEnabled,
} from "../../src/kernel/capabilities/reason/think-guards.js";

const recall = { name: "recall", description: "", parameters: [] };
const web = { name: "web-search", description: "", parameters: [] };

// >4000 truncation marker as written by conversation-assembly.ts:118
const overflowMsg = {
  role: "tool_result" as const,
  content:
    '[{"id":1,"title":"x"}]\n  ...truncated (5210 chars). Full available via recall("_tool_result_1", full: true).',
};
// ≤4000 inline tool result — full data, NO recall key surfaced
const inlineMsg = {
  role: "tool_result" as const,
  content: '[{"id":1,"title":"x","score":300},{"id":2,"title":"y","score":120}]',
};
// Array/commit overflow marker (tool-formatting.ts:294) — the spot-test GitHub-MCP
// regression: cogito fetches commits, large array stored, key surfaced WITHOUT
// `full: true`. recall MUST stay usable here.
const arrayMarkerMsg = {
  role: "tool_result" as const,
  content:
    '[{"sha":"a1","msg":"feat"}]\n  — full data is stored. Use recall("_tool_result_2", arrayStart: 5, arrayCount: 5) for remaining commits.',
};
// Curator per-observation cap marker (context-curator.ts:231) — no args.
const noArgsMarkerMsg = {
  role: "tool_result" as const,
  content:
    'preview…\n  ...truncated (8100 chars). Full content available via recall("_tool_result_3").',
};

describe("recall overflow gating (Inc 1)", () => {
  it("recallKeyVisibleInWindow: true only when a surfaced >4000 key is present", () => {
    expect(recallKeyVisibleInWindow([overflowMsg])).toBe(true);
    expect(recallKeyVisibleInWindow([inlineMsg])).toBe(false);
    expect(recallKeyVisibleInWindow([])).toBe(false);
    // an assistant message merely mentioning recall must NOT count as a usable key
    expect(
      recallKeyVisibleInWindow([
        { role: "assistant" as const, content: "I will call recall next." },
      ]),
    ).toBe(false);
  }, 15000);

  it("filters recall OUT when window is inline-only (≤4000, the redundant-fire bug)", () => {
    const out = filterRecallByOverflow([web, recall], [inlineMsg]);
    expect(out.map((s) => s.name)).toEqual(["web-search"]);
  }, 15000);

  it("KEEPS recall when a >4000 key is surfaced in window (mechanism B intact)", () => {
    const out = filterRecallByOverflow([web, recall], [overflowMsg]);
    expect(out.map((s) => s.name)).toContain("recall");
  }, 15000);

  it("KEEPS recall for ARRAY/commit marker without full:true (spot-test MCP regression)", () => {
    expect(recallKeyVisibleInWindow([arrayMarkerMsg])).toBe(true);
    const out = filterRecallByOverflow([web, recall], [arrayMarkerMsg]);
    expect(out.map((s) => s.name)).toContain("recall");
  }, 15000);

  it("KEEPS recall for curator no-args marker recall(\"key\")", () => {
    expect(recallKeyVisibleInWindow([noArgsMarkerMsg])).toBe(true);
    const out = filterRecallByOverflow([web, recall], [noArgsMarkerMsg]);
    expect(out.map((s) => s.name)).toContain("recall");
  }, 15000);

  it("KEEPS recall when forceRecall (calibration uses-recall) despite inline window", () => {
    const out = filterRecallByOverflow([web, recall], [inlineMsg], true);
    expect(out.map((s) => s.name)).toContain("recall");
  }, 15000);

  it("no-op when recall is not in the schema set", () => {
    const out = filterRecallByOverflow([web], [inlineMsg]);
    expect(out.map((s) => s.name)).toEqual(["web-search"]);
  }, 15000);

  // DEFAULT-ON flip (Phase-3 ablation, 2026-05-30): gate is active unless the
  // run explicitly opts out with RA_RECALL_GATE=0. Was previously OPT-IN
  // (active only when RA_RECALL_GATE=1).
  it("recallGateEnabled: DEFAULT-ON when env unset, opt-out only via RA_RECALL_GATE=0", () => {
    expect(recallGateEnabled({})).toBe(true); // default-on
    expect(recallGateEnabled({ RA_RECALL_GATE: "0" })).toBe(false); // opt-out
    expect(recallGateEnabled({ RA_RECALL_GATE: "1" })).toBe(true); // explicit on
    expect(recallGateEnabled({ RA_RECALL_GATE: "" })).toBe(true); // unset-equivalent
  }, 15000);
});
