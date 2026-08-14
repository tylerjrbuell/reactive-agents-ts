import { describe, it, expect } from "bun:test";
import { projectResultsStage } from "../../src/assembly/stages/project-results.js";
import { EventLog } from "../../src/assembly/event-log.js";
import { ResultStore } from "../../src/assembly/result-store.js";
import { resolveCapability } from "../../src/assembly/capability.js";
import { emptyTrace } from "../../src/assembly/trace.js";
import type { RunContract } from "../../src/kernel/contract/run-contract.js";
import type { RunAssessment } from "../../src/kernel/assessment/assess.js";

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
  it("R4: preview+ref trace message carries tool + rawChars + budget for the compression report", () => {
    // The compression reporter (runtime/context-compression-reporter.ts) and the
    // enriched ProjectionRenderedEmitted event render `raw→shown (budget @
    // window)` from exactly these fields. Without them the "result crushed X→Y"
    // signal is invisible (the 2026-07-30 divergence took RA_PROMPT_DUMP to find).
    const big = Array.from({ length: 50 }, (_, i) => ({ sha: `s${i}`, commit: { message: `message ${i} ${"x".repeat(50)}` } }));
    const { input } = ctxWith(big);
    const ctx = projectResultsStage({ ...input, systemPrompt: "", messages: [], toolSchemas: [], trace: emptyTrace(input.capability) });
    const tr = ctx.trace.messages.find((m) => m.projection === "preview+ref");
    expect(tr).toBeDefined();
    expect(tr!.tool).toBe("github/list_commits");
    // rawChars = the FULL pre-projection render, strictly larger than what the
    // model actually saw (the whole point of the signal).
    expect(tr!.rawChars).toBeGreaterThan(tr!.chars);
    expect(tr!.budget).toBeGreaterThan(0);
    // ref = the curator-decision targetRef (think.ts emits CuratorDecision from it).
    expect(typeof tr!.ref).toBe("string");
    expect(tr!.ref!.length).toBeGreaterThan(0);
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

  it("escalates the render budget for a ref backing a stalled enumeration requirement (FM-17 layer 3)", () => {
    // window 1000 → recencyBudgetChars = floor(1000 * 0.35 * 4) = 1400 (sole/
    // latest result → recency budget, not the tighter preserve cap). bigResult
    // (5000 chars) overflows that base budget, so without escalation this
    // renders preview+ref bounded to ~1400 chars.
    const cap = resolveCapability({ window: 1000, outputBudget: 100, dialect: "native-fc", tier: "local" });
    const bigResult = "x".repeat(5000); // exceeds the base budget (1400) and even the escalated one only barely
    const store = new ResultStore();
    const ref = store.put("web-search", bigResult);
    const log = new EventLog()
      .append({ kind: "tool_called", tool: "web-search", callId: "c1", args: {} })
      .append({ kind: "tool_result", callId: "c1", ref, shape: "String" });

    const contract: RunContract = {
      requirements: [
        {
          id: "answer",
          kind: "question-answered",
          spec: {
            description: "answer the question",
            condition: { kind: "ToolCalled", tool: "web-search" },
            acceptance: "deterministic",
            enumeration: { expectedCount: "unknown", itemShape: "list-entry" },
          },
        },
      ],
      deliverables: [],
      constraints: [],
      horizon: "long",
      postConditions: [],
    };
    // Escalation is keyed BY REF (finding C2): assess() only lists refs that a
    // `result-truncated` ledger fact actually named, so a requirement's mere
    // existence can no longer widen an unrelated result.
    const assessment = {
      requirementProgress: new Map([
        ["answer", { stallCount: 2, refEscalation: new Map([[ref, 2]]) }],
      ]),
    } as unknown as RunAssessment;

    const ctx = projectResultsStage({
      log,
      capability: cap,
      store,
      persona: { system: "" },
      tools: { schemas: [] },
      contract,
      assessment,
      systemPrompt: "",
      messages: [],
      toolSchemas: [],
      trace: emptyTrace(cap),
    });
    const rendered = ctx.messages.find((m) => m.role === "tool_result");
    expect(rendered?.content.length).toBeGreaterThan(bigResult.length * 0.5); // escalated, not clipped to base budget
  });

  it("does NOT escalate a ref that was never itself truncated (finding C2)", () => {
    // Same stalled enumeration requirement, same generous stallCount — but this
    // result's ref is absent from `refEscalation`, so it must stay at the base
    // budget. The old predicate matched on `condition === undefined`, which is
    // vacuously true for the compiler's floor `answer` requirement (the only
    // requirement that ever carries an enumeration hint and it never carries a
    // condition), so EVERY tool result in the thread widened at once.
    const cap = resolveCapability({ window: 1000, outputBudget: 100, dialect: "native-fc", tier: "local" });
    const bigResult = "x".repeat(5000);
    const store = new ResultStore();
    const ref = store.put("web-search", bigResult);
    const log = new EventLog()
      .append({ kind: "tool_called", tool: "web-search", callId: "c1", args: {} })
      .append({ kind: "tool_result", callId: "c1", ref, shape: "String" });

    const contract: RunContract = {
      requirements: [
        {
          id: "answer",
          kind: "question-answered",
          spec: {
            description: "answer the question",
            acceptance: "self-critique",
            enumeration: { expectedCount: "unknown", itemShape: "list-entry" },
          },
        },
      ],
      deliverables: [],
      constraints: [],
      horizon: "long",
      postConditions: [],
    };
    const assessment = {
      requirementProgress: new Map([
        ["answer", { stallCount: 4, refEscalation: new Map([["some_other_ref", 4]]) }],
      ]),
    } as unknown as RunAssessment;

    const ctx = projectResultsStage({
      log,
      capability: cap,
      store,
      persona: { system: "" },
      tools: { schemas: [] },
      contract,
      assessment,
      systemPrompt: "",
      messages: [],
      toolSchemas: [],
      trace: emptyTrace(cap),
    });
    const rendered = ctx.messages.find((m) => m.role === "tool_result");
    expect(rendered?.content.length).toBeLessThan(bigResult.length * 0.5);
  });

  it("caps AGGREGATE escalation extra across several simultaneously-stalled refs (2026-08-14)", () => {
    // Live-observed: several refs escalating in the same pass can push the
    // total render past the compaction threshold (window * 4 chars), and
    // compaction can then drop the very exchange escalation just widened.
    // The per-ref cap (MAX_ESCALATION_LEVEL, ~7x one ref's base budget)
    // doesn't bound the SUM across refs — this test pins that the sum IS
    // now bounded, at 50% of the compaction threshold.
    const cap = resolveCapability({ window: 1000, outputBudget: 100, dialect: "native-fc", tier: "local" });
    const bigResult = "x".repeat(5000);
    const store = new ResultStore();
    const refs = ["r1", "r2", "r3", "r4"].map((name) => store.put(`tool-${name}`, bigResult));
    let log = new EventLog();
    for (const [i, ref] of refs.entries()) {
      log = log
        .append({ kind: "tool_called", tool: `tool-r${i + 1}`, callId: `c${i + 1}`, args: {} })
        .append({ kind: "tool_result", callId: `c${i + 1}`, ref, shape: "String" });
    }

    const contract: RunContract = {
      requirements: [
        {
          id: "answer",
          kind: "question-answered",
          spec: {
            description: "answer the question",
            acceptance: "self-critique",
            enumeration: { expectedCount: "unknown", itemShape: "list-entry" },
          },
        },
      ],
      deliverables: [],
      constraints: [],
      horizon: "long",
      postConditions: [],
    };
    // All 4 refs stalled at the same (near-max) level — the worst case: every
    // ref independently qualifies for the full ~7x per-ref escalation.
    const assessment = {
      requirementProgress: new Map([
        ["answer", { stallCount: 4, refEscalation: new Map(refs.map((r) => [r, 4])) }],
      ]),
    } as unknown as RunAssessment;

    const ctx = projectResultsStage({
      log,
      capability: cap,
      store,
      persona: { system: "" },
      tools: { schemas: [] },
      contract,
      assessment,
      systemPrompt: "",
      messages: [],
      toolSchemas: [],
      trace: emptyTrace(cap),
    });

    // Each ref independently qualifies for ~7x its own base budget (well
    // over 5000 chars, enough to render fully) — WITHOUT an aggregate cap
    // all 4 would render "full". With the cap, the aggregate extra runs out
    // partway through the pass: escalation still helps the first ref(s) in
    // thread order, but not every ref gets the full requested widening.
    const projections = ctx.trace.messages.filter((m) => m.role === "tool_result").map((m) => m.projection);
    expect(projections).toHaveLength(4);
    expect(projections.filter((p) => p === "full").length).toBeLessThan(4);
    // And escalation still did SOMETHING — the first ref in thread order
    // got real benefit from its full requested widening (mechanism isn't
    // neutered by the cap).
    const first = ctx.messages.find((m) => m.role === "tool_result")!;
    expect(first.content.length).toBeGreaterThan(bigResult.length * 0.5);
  });
});
