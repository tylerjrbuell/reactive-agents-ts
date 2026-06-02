import { describe, it, expect } from "bun:test";
import { projectResultsStage } from "../../src/assembly/stages/project-results.js";
import { EventLog } from "../../src/assembly/event-log.js";
import { ResultStore } from "../../src/assembly/result-store.js";
import { resolveCapability } from "../../src/assembly/capability.js";
import { emptyTrace } from "../../src/assembly/trace.js";

function ctxWith(value: unknown) {
  // Test pins overflow→preview path via the small per-result preserve cap
  // (RA_TOOL_RESULT_BUDGET_CHARS env). Previously this test exploited the
  // window→recencyBudgetChars chain (window 1000 → cap 1400) as the per-
  // result gate; after the 2026-06-02 separation between recency-window
  // total and per-result preservation, the gate is now `toolResultPreserveBudget`
  // resolved tier-aware (local=4000) — too generous for this fixture.
  const prev = process.env.RA_TOOL_RESULT_BUDGET_CHARS;
  process.env.RA_TOOL_RESULT_BUDGET_CHARS = "400";
  const cap = resolveCapability({ window: 1000, outputBudget: 100, dialect: "native-fc", tier: "local" });
  if (prev === undefined) delete process.env.RA_TOOL_RESULT_BUDGET_CHARS;
  else process.env.RA_TOOL_RESULT_BUDGET_CHARS = prev;
  const store = new ResultStore();
  const ref = store.put("github/list_commits", value);
  const log = new EventLog()
    .append({ kind: "tool_called", tool: "github/list_commits", callId: "c1", args: {} })
    .append({ kind: "tool_result", callId: "c1", ref, shape: "Array" });
  return { input: { log, capability: cap, store, persona: { system: "" }, tools: { schemas: [] } }, ref };
}

describe("projectResults — full | preview+ref | cleared", () => {
  it("OVERFLOW → preview+ref (bounded preview + ref, no marker)", () => {
    const big = Array.from({ length: 50 }, (_, i) => ({ sha: `s${i}`, commit: { message: `message ${i} ${"x".repeat(50)}` } }));
    const { input, ref } = ctxWith(big);
    const ctx = projectResultsStage({ ...input, systemPrompt: "", messages: [], toolSchemas: [], trace: emptyTrace(input.capability) });
    const tr = ctx.messages.find((m) => m.role === "tool_result")!;
    expect(tr.content).toContain(`result_ref="${ref}"`);
    expect(tr.content).not.toContain("[STORED:");
    expect(tr.content).not.toContain("recall(");
    // preview+ref carries CONTENT (some commit messages), not just a bare shape —
    // the Phase-4 regression was bare-ref stripping all content.
    expect(tr.content).toContain("message 0");
    // …but bounded (does not inline all 50 verbose commits).
    // Sole tool_result → it's the LATEST → uses recencyBudgetChars (model
    // attention budget), not the tight per-result preserve cap.
    expect(tr.content.length).toBeLessThanOrEqual(input.capability.recencyBudgetChars + 400);
    expect(ctx.trace.messages.some((m) => m.projection === "preview+ref")).toBe(true);
  });
  it("FITTING result → present full", () => {
    const small = [{ sha: "s0", commit: { message: "tiny" } }];
    const { input } = ctxWith(small);
    const ctx = projectResultsStage({ ...input, systemPrompt: "", messages: [], toolSchemas: [], trace: emptyTrace(input.capability) });
    const tr = ctx.messages.find((m) => m.role === "tool_result")!;
    expect(tr.content).toContain("tiny");
    expect(ctx.trace.messages.some((m) => m.projection === "full")).toBe(true);
  });

  it("recency-split: latest result keeps full content even when older results compress", () => {
    // Phase-A 2026-06-02: the previous flat-cap projection regressed verbatim
    // tasks (transcribe / recall) because a single large tool_result was
    // preview+ref'd and the model lost the content it needed. Recency split
    // keeps the LATEST result under the model's attention budget (full),
    // while OLDER results take the tight preserve cap (preview+ref).
    const cap = resolveCapability({
      window: 32768,
      outputBudget: 2000,
      dialect: "native-fc",
      tier: "local",
    });
    const store = new ResultStore();
    const bigA = Array.from({ length: 200 }, (_, i) => ({ id: i, value: `vA-${i} ${"x".repeat(40)}` }));
    const bigB = Array.from({ length: 200 }, (_, i) => ({ id: i, value: `vB-${i} ${"x".repeat(40)}` }));
    const refA = store.put("read", bigA);
    const refB = store.put("read", bigB);
    const log = new EventLog()
      .append({ kind: "tool_called", tool: "read", callId: "c1", args: {} })
      .append({ kind: "tool_result", callId: "c1", ref: refA, shape: "Array" })
      .append({ kind: "tool_called", tool: "read", callId: "c2", args: {} })
      .append({ kind: "tool_result", callId: "c2", ref: refB, shape: "Array" });
    const ctx = projectResultsStage({
      log,
      capability: cap,
      store,
      persona: { system: "" },
      tools: { schemas: [] },
      systemPrompt: "",
      messages: [],
      toolSchemas: [],
      trace: emptyTrace(cap),
    });
    const results = ctx.messages.filter((m) => m.role === "tool_result");
    expect(results.length).toBe(2);
    // Older result: tight preserve budget → preview+ref (does not contain
    // every row sentinel; structural preview only).
    expect(results[0].content).toContain(`result_ref="${refA}"`);
    expect(results[0].content).not.toContain("vA-199"); // last sentinel of A
    // Latest result: full attention budget → verbatim sentinel preserved.
    expect(results[1].content).toContain("vB-199");
    // Trace records the split per-projection.
    const projections = ctx.trace.messages.filter((m) => m.role === "tool_result").map((m) => m.projection);
    expect(projections[0]).toBe("preview+ref");
    expect(projections[1]).toBe("full");
  });
});
