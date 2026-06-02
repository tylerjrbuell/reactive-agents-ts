// Run: bun test packages/reasoning/tests/kernel/age-aware-curation.test.ts --timeout 30000
//
// Spike 1 (curation ROOT) — age-aware tool-result compression.
//
// ROOT cause: RA compresses every tool result at PRODUCE time, size-only, before
// the model synthesizes. conversation-assembly.ts then rehydrates each result to
// full-up-to-4000 regardless of age — so the most-recent (synthesis-target)
// result the model reasons over THIS turn is bounded by a fixed cap, while aged
// history is ALSO kept full-up-to-4000 (token bloat). The canon (Anthropic
// tool-result clearing) says keep the CURRENT body full, clear OLD bodies.
//
// DEFAULT-ON (opt-out via RA_CURATION_AGEAWARE=0): the most-recent K=1
// tool_result is kept FULL (rehydrated from scratchpad up to a window-scaled
// ceiling), and AGED results are compressed to a preview + their existing
// reversible storedKey pointer. Setting RA_CURATION_AGEAWARE=0 = byte-identical
// to the pre-curation path (no rehydration, no compression here).
import { describe, it, expect } from "bun:test";
import {
  curationAgeAware,
  applyAgeAwareCuration,
} from "../../src/kernel/capabilities/attend/tool-formatting.js";
import type { KernelMessage } from "../../src/kernel/state/kernel-state.js";
import { CONTEXT_PROFILES } from "../../src/context/context-profile.js";

// ── Synthetic thread: 3 tool results across 3 iterations ──────────────────────
// Each tool result was produced large → full body stashed in scratchpad under a
// storedKey; the message.content is the compressed/rehydrated value (here: a
// 4000-cap-style preview to model "today's" assembly).

const BIG_1 = "RESULT-ONE " + "a".repeat(6000); // 6011 chars
const BIG_2 = "RESULT-TWO " + "b".repeat(6000);
const BIG_3 = "RESULT-THREE " + "c".repeat(6000); // most-recent

const scratchpad = new Map<string, string>([
  ["_tool_result_1", BIG_1],
  ["_tool_result_2", BIG_2],
  ["_tool_result_3", BIG_3],
]);

function thread(): KernelMessage[] {
  return [
    { role: "user", content: "do the task" },
    { role: "assistant", content: "t1", toolCalls: [{ id: "c1", name: "web-search", arguments: {} }] },
    { role: "tool_result", toolCallId: "c1", toolName: "web-search", content: BIG_1.slice(0, 4000), storedKey: "_tool_result_1" },
    { role: "assistant", content: "t2", toolCalls: [{ id: "c2", name: "web-search", arguments: {} }] },
    { role: "tool_result", toolCallId: "c2", toolName: "web-search", content: BIG_2.slice(0, 4000), storedKey: "_tool_result_2" },
    { role: "assistant", content: "t3", toolCalls: [{ id: "c3", name: "web-search", arguments: {} }] },
    { role: "tool_result", toolCallId: "c3", toolName: "web-search", content: BIG_3.slice(0, 4000), storedKey: "_tool_result_3" },
  ];
}

const frontier = CONTEXT_PROFILES.frontier; // maxTokens 128000

describe("age-aware curation flag seam", () => {
  it("curationAgeAware: DEFAULT-ON; opt-out only via RA_CURATION_AGEAWARE=0", () => {
    expect(curationAgeAware({})).toBe(true); // empty env → ON
    expect(curationAgeAware({ RA_CURATION_AGEAWARE: "1" })).toBe(true);
    expect(curationAgeAware({ RA_CURATION_AGEAWARE: "0" })).toBe(false); // sole opt-out
    expect(curationAgeAware({ RA_CURATION_AGEAWARE: "" })).toBe(true); // "" !== "0" → ON
  });
});

describe("applyAgeAwareCuration (ON)", () => {
  it("keeps the most-recent tool_result FULL (rehydrated beyond the old 4000 cap)", () => {
    const out = applyAgeAwareCuration(thread(), scratchpad, frontier, 1);
    const recent = out.find((m) => m.role === "tool_result" && m.toolCallId === "c3");
    expect(recent).toBeDefined();
    // full body rehydrated — exceeds the 4000 cap the assembly layer applies today
    expect((recent as Extract<KernelMessage, { role: "tool_result" }>).content.length).toBeGreaterThan(4000);
    expect((recent as Extract<KernelMessage, { role: "tool_result" }>).content).toBe(BIG_3);
  });

  it("compresses AGED tool_results to a preview + reversible storedKey pointer", () => {
    const out = applyAgeAwareCuration(thread(), scratchpad, frontier, 1);
    const aged1 = out.find((m) => m.role === "tool_result" && m.toolCallId === "c1") as Extract<KernelMessage, { role: "tool_result" }>;
    const aged2 = out.find((m) => m.role === "tool_result" && m.toolCallId === "c2") as Extract<KernelMessage, { role: "tool_result" }>;
    // aged results are compressed well below the full body
    expect(aged1.content.length).toBeLessThan(BIG_1.length);
    expect(aged2.content.length).toBeLessThan(BIG_2.length);
    // reversible pointer preserved (recall/rehydration intact)
    expect(aged1.storedKey).toBe("_tool_result_1");
    expect(aged1.content).toContain("_tool_result_1");
  });

  it("leaves non-tool_result messages untouched and order preserved", () => {
    const out = applyAgeAwareCuration(thread(), scratchpad, frontier, 1);
    expect(out.map((m) => m.role)).toEqual([
      "user", "assistant", "tool_result", "assistant", "tool_result", "assistant", "tool_result",
    ]);
    expect(out[0]).toEqual({ role: "user", content: "do the task" });
  });
});

describe("applyAgeAwareCuration (OFF = byte-identical passthrough)", () => {
  it("returns the input thread unchanged when curationAgeAware is off (caller-gated)", () => {
    // The caller only invokes applyAgeAwareCuration when curationAgeAware() is true;
    // but the function itself must also no-op when given k>=messageCount-style inputs.
    // Byte-identical OFF behavior is enforced at the caller via the flag. Here we
    // assert the pure function does not mutate the input array.
    const input = thread();
    const snapshot = JSON.stringify(input);
    applyAgeAwareCuration(input, scratchpad, frontier, 1);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

describe("window-scaled budget on the RECENT (synthesis-target) result", () => {
  // A genuinely huge most-recent body proves per-tier scaling: frontier's large
  // window keeps it full where local's smaller window truncates with a recall
  // pointer. (Aged budget is intentionally bounded ≤4000 for token cost and is
  // inert above ~25k-token windows — that is by design, not tested here.)
  const HUGE = "RESULT-HUGE " + "z".repeat(80_000); // 80012 chars
  const hugeScratch = new Map<string, string>([["_tool_result_h", HUGE]]);
  const hugeThread = (): KernelMessage[] => [
    { role: "user", content: "task" },
    { role: "assistant", content: "t", toolCalls: [{ id: "ch", name: "http-get", arguments: {} }] },
    { role: "tool_result", toolCallId: "ch", toolName: "http-get", content: HUGE.slice(0, 4000), storedKey: "_tool_result_h" },
  ];

  it("frontier (128k window) keeps the huge most-recent result FULL", () => {
    const out = applyAgeAwareCuration(hugeThread(), hugeScratch, frontier, 1);
    const recent = out.find((m) => m.role === "tool_result") as Extract<KernelMessage, { role: "tool_result" }>;
    expect(recent.content).toBe(HUGE);
  });

  it("local (smaller window) truncates the huge result at the scaled ceiling with a recall pointer", () => {
    const local = CONTEXT_PROFILES.local; // maxTokens 32768
    const out = applyAgeAwareCuration(hugeThread(), hugeScratch, local, 1);
    const recent = out.find((m) => m.role === "tool_result") as Extract<KernelMessage, { role: "tool_result" }>;
    expect(recent.content.length).toBeLessThan(HUGE.length);
    expect(recent.content).toContain('recall("_tool_result_h", full: true)');
    // still far more than the old fixed 4000 cap — window-scaled, not crushed
    expect(recent.content.length).toBeGreaterThan(4000);
  });
});

describe("parallel batch (K=1 = most-recent TURN, not most-recent message)", () => {
  // A parallel batch: one assistant message + 3 tool_results in a single turn.
  // All three are this turn's synthesis target → all kept full. A prior turn's
  // result is aged → compressed.
  const P1 = "PRIOR " + "p".repeat(6000);
  const A = "ALPHA " + "x".repeat(6000);
  const B = "BETA " + "y".repeat(6000);
  const C = "GAMMA " + "w".repeat(6000);
  const pScratch = new Map<string, string>([
    ["_tr_prior", P1],
    ["_tr_a", A],
    ["_tr_b", B],
    ["_tr_c", C],
  ]);
  const pThread = (): KernelMessage[] => [
    { role: "user", content: "task" },
    { role: "assistant", content: "prior", toolCalls: [{ id: "p", name: "web-search", arguments: {} }] },
    { role: "tool_result", toolCallId: "p", toolName: "web-search", content: P1.slice(0, 4000), storedKey: "_tr_prior" },
    {
      role: "assistant",
      content: "batch",
      toolCalls: [
        { id: "a", name: "http-get", arguments: {} },
        { id: "b", name: "http-get", arguments: {} },
        { id: "c", name: "http-get", arguments: {} },
      ],
    },
    { role: "tool_result", toolCallId: "a", toolName: "http-get", content: A.slice(0, 4000), storedKey: "_tr_a" },
    { role: "tool_result", toolCallId: "b", toolName: "http-get", content: B.slice(0, 4000), storedKey: "_tr_b" },
    { role: "tool_result", toolCallId: "c", toolName: "http-get", content: C.slice(0, 4000), storedKey: "_tr_c" },
  ];

  it("keeps ALL three same-turn siblings FULL", () => {
    const out = applyAgeAwareCuration(pThread(), pScratch, frontier, 1);
    const get = (id: string) =>
      (out.find((m) => m.role === "tool_result" && m.toolCallId === id) as Extract<KernelMessage, { role: "tool_result" }>).content;
    expect(get("a")).toBe(A);
    expect(get("b")).toBe(B);
    expect(get("c")).toBe(C);
  });

  it("compresses the PRIOR turn's result (aged) to a preview + pointer", () => {
    const out = applyAgeAwareCuration(pThread(), pScratch, frontier, 1);
    const prior = out.find((m) => m.role === "tool_result" && m.toolCallId === "p") as Extract<KernelMessage, { role: "tool_result" }>;
    expect(prior.content.length).toBeLessThan(P1.length);
    expect(prior.content).toContain("_tr_prior");
    expect(prior.storedKey).toBe("_tr_prior");
  });
});
