import { describe, it, expect } from "bun:test";
import { ResultStore } from "../../src/assembly/result-store.js";

const commits = Array.from({ length: 20 }, (_, i) => ({ sha: `s${i}`, commit: { message: `m${i}` } }));

describe("ResultStore — content-addressed, system-owned", () => {
  it("put returns a stable ref; same content → same ref (CAS)", () => {
    const s = new ResultStore();
    const r1 = s.put("github/list_commits", commits);
    const r2 = s.put("github/list_commits", commits);
    expect(r1).toBe(r2); // content-addressed
    expect(s.get(r1)?.value).toEqual(commits);
  });

  it("summarize gives shape + ref, no bulk, no marker, no recall", () => {
    const s = new ResultStore();
    const ref = s.put("github/list_commits", commits);
    const sum = s.summarize(ref);
    expect(sum).toContain("Array(20)");
    expect(sum).toContain(ref);
    expect(sum).not.toContain("[STORED:");
    expect(sum).not.toContain("recall(");
    expect(sum).not.toContain("m0");
  });

  it("materialize renders ALL items deterministically", () => {
    const s = new ResultStore();
    const ref = s.put("github/list_commits", commits);
    expect(s.materialize(ref, "bullets").split("\n").length).toBe(20);
  });

  it("unknown ref does not throw", () => {
    expect(new ResultStore().materialize("nope")).toContain("nope");
  });
});

// ── preview(): the content-aware overflow projection (#1, 2026-05-31) ──────────
// The Phase-4 regression: overflow → bare summarize() (shape+ref only) stripped
// the content the model needed to summarize → it looped / dropped sections.
// Verified bar: legacy inlined ~5k of a 57k spread-section doc and silently
// covered only ~19/22 sections. preview() must do BETTER — when content is
// heading-structured, surface the FULL heading skeleton (all sections) within
// budget so the model can faithfully cover every section, honestly marked.
describe("ResultStore.preview() — content-aware bounded overflow projection", () => {
  // A markdown doc whose 22 `##` sections are SPREAD across a large body that
  // overflows a small budget (mirrors the AGENTS.md fixture shape).
  const bigDoc = (() => {
    const sections = Array.from({ length: 22 }, (_, i) =>
      `## Section ${i} Title\nLead line for section ${i}.\n` +
      Array.from({ length: 40 }, (_, j) => `body filler ${i}.${j} lorem ipsum dolor sit amet`).join("\n"),
    );
    return sections.join("\n\n");
  })();

  it("structural: surfaces ALL heading lines within budget even when the body overflows", () => {
    const s = new ResultStore();
    const ref = s.put("file-read", bigDoc);
    const budget = 2000; // far smaller than bigDoc (~40k chars)
    const p = s.preview(ref, budget);
    // Every section heading must appear (the skeleton the model summarizes from).
    for (let i = 0; i < 22; i++) expect(p).toContain(`## Section ${i} Title`);
    // Recoverable by reference + honest about truncation.
    expect(p).toContain(ref);
    expect(p.toLowerCase()).toMatch(/truncat|full|system-side|of \d/);
    // Bounded — must not inline the whole 40k body.
    expect(p.length).toBeLessThan(bigDoc.length / 2);
  });

  it("head fallback: non-heading content → bounded head + truncation marker + ref", () => {
    const s = new ResultStore();
    const blob = "x".repeat(50_000); // no markdown structure
    const ref = s.put("file-read", blob);
    const budget = 800;
    const p = s.preview(ref, budget);
    expect(p).toContain(ref);
    expect(p.toLowerCase()).toMatch(/truncat|of \d|system-side/);
    expect(p.length).toBeLessThan(2000); // bounded near budget + marker
  });

  it("under budget: returns the full content (no truncation, no ref noise)", () => {
    const s = new ResultStore();
    const small = "## A\nshort\n## B\nalso short";
    const ref = s.put("file-read", small);
    const p = s.preview(ref, 4000);
    expect(p).toContain("## A");
    expect(p).toContain("## B");
    expect(p).not.toMatch(/truncat/i);
  });

  it("always recoverable: the ref appears so the model can act-by-reference too", () => {
    const s = new ResultStore();
    const ref = s.put("file-read", bigDoc);
    expect(s.preview(ref, 1500)).toContain(ref);
  });
});

// ── H2 (2026-07-08 sweep, audit 03-F2): recall read-hint vocabulary ───────────
// The recall-overflow gate (think-guards SURFACED_RECALL_KEY) matches
// `recall("<key>"`. Previews on the canonical assembly path only ever emitted
// `result_ref="…"`, so the gate never saw a marker and the stored-evidence
// read path was structurally dead. Scratchpad-backed refs (putWithRef) now
// advertise recall in the gate's exact vocabulary; minted content-hash refs
// (put) must NOT — recall cannot resolve them (blind-recall lure).
import { recallKeyVisibleInWindow } from "../../src/kernel/capabilities/reason/think-guards.js";

describe("H2 — recall read-hint on scratchpad-backed refs", () => {
  const big = Array.from({ length: 400 }, (_, i) => ({ sha: `sha${i}`, msg: `commit message ${i}` }));

  it("putWithRef (scratchpad key): summarize + preview advertise recall(\"<ref>\"", () => {
    const s = new ResultStore();
    s.putWithRef("_tool_result_3", "github/list_commits", big);
    expect(s.summarize("_tool_result_3")).toContain('recall("_tool_result_3"');
    const p = s.preview("_tool_result_3", 500);
    expect(p).toContain('recall("_tool_result_3"');
  });

  it("put (minted res_ ref): NO recall hint — recall cannot resolve it", () => {
    const s = new ResultStore();
    const ref = s.put("github/list_commits", big);
    expect(s.summarize(ref)).not.toContain("recall(");
    expect(s.preview(ref, 500)).not.toContain("recall(");
  });

  it("gate integration: a preview footer in a tool_result unlocks the recall gate", () => {
    const s = new ResultStore();
    s.putWithRef("_tool_result_7", "web-search", big);
    const content = s.preview("_tool_result_7", 600);
    expect(
      recallKeyVisibleInWindow([{ role: "tool_result", content }]),
    ).toBe(true);
    // Minted refs must NOT unlock it.
    const minted = s.put("web-search", big);
    expect(
      recallKeyVisibleInWindow([{ role: "tool_result", content: s.preview(minted, 600) }]),
    ).toBe(false);
  });
});
