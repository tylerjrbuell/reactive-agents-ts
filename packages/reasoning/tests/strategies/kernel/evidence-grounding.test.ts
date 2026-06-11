import { describe, it, expect } from "bun:test";
import {
  buildEvidenceCorpusFromSteps,
  validateOutputGroundedInEvidence,
  validateExpectedEntitiesInOutput,
} from "../../../src/kernel/capabilities/verify/evidence-grounding.js";
import type { ReasoningStep } from "../../../src/types/index.js";

function obs(
  content: string,
  toolName: string,
): ReasoningStep {
  return {
    type: "observation",
    content,
    metadata: {
      observationResult: { toolName, success: true },
    },
  } as ReasoningStep;
}

describe("buildEvidenceCorpusFromSteps", () => {
  it("joins non-system tool observations", () => {
    const steps: ReasoningStep[] = [
      obs("XRP ~ $1.37 on CMC", "web-search"),
      { type: "thought", content: "thinking" } as ReasoningStep,
      obs("system nudge", "system"),
    ];
    expect(buildEvidenceCorpusFromSteps(steps)).toContain("1.37");
    expect(buildEvidenceCorpusFromSteps(steps)).not.toContain("system nudge");
  }, 15000);
});

describe("validateOutputGroundedInEvidence", () => {
  it("passes when all dollar amounts appear in evidence", () => {
    const evidence = "ETH last 2,208.24 USD per Yahoo; BTC 71,535.42";
    const output = "| ETH | $2,208.24 | yahoo |\n| BTC | $71,535.42 | yahoo |";
    expect(validateOutputGroundedInEvidence(output, evidence)).toEqual({ ok: true });
  }, 15000);

  it("fails when output invents a price not in evidence", () => {
    const evidence = "ETH last 2,208.24 USD; BTC 71,535.42";
    const output = "ETH is $3,500.00 today.";
    const r = validateOutputGroundedInEvidence(output, evidence);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.violations.some((v) => v.includes("$3,500"))).toBe(true);
  }, 15000);

  it("skips check when evidence corpus is too short", () => {
    const r = validateOutputGroundedInEvidence("Costs $9,999", "short");
    expect(r).toEqual({ ok: true });
  }, 15000);

  it("passes when output has no dollar amounts", () => {
    const r = validateOutputGroundedInEvidence("No prices here.", "BTC is 71535 USD");
    expect(r).toEqual({ ok: true });
  }, 15000);

  it("flags ~$ and LaTeX-style dollar amounts", () => {
    const evidence = "BTC trading near 71535 USD on Yahoo.";
    // Model-style: $\approx \$65,000$
    const output = "BTC is ~$68,000 or $\\approx \\$65,000$ depending on venue.";
    const r = validateOutputGroundedInEvidence(output, evidence);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.violations.length).toBeGreaterThanOrEqual(2);
  }, 15000);
});

describe("validateExpectedEntitiesInOutput", () => {
  it("requires each enumerated entity (ticker aliases for BTC/ETH)", () => {
    const entities = ["xrp", "xlm", "eth", "bitcoin"] as const;
    const okTable = "| XRP | $1 | u |\n| XLM | $0.15 | u |\n| ETH | $2377 | u |\n| Bitcoin | $71535 | u |";
    expect(validateExpectedEntitiesInOutput(okTable, entities)).toEqual({ ok: true });

    const bad = "| SOL | $1 | u |\n| ADA | $2 | u |";
    const r = validateExpectedEntitiesInOutput(bad, entities);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.violations.length).toBe(4);
  }, 15000);
});

// ─── Scaffold-leak detection (formerly validateGeneralizedGrounding's
// compression-marker echo path; the prose claim-grounding path was removed in
// the opt-in grounding redesign — it false-rejected legitimate summaries at
// 64-73%). The always-on framework-internal-echo guard now lives in
// scaffold-leak.ts. ────────────────────────────────────────────────────────
import { detectScaffoldLeak } from "../../../src/kernel/capabilities/verify/scaffold-leak.js";

describe("detectScaffoldLeak (always-on framework-internal echo guard)", () => {
  it("FLAGS output containing framework compression markers (echo detection)", () => {
    const r = detectScaffoldLeak(
      "[recall result — compressed preview]\nType: Object(4 keys)\n_tool_result_5 ...",
    );
    expect(r.leaked).toBe(true);
    expect(r.reason).toContain("scaffolding");
  });

  it("FLAGS bare [STORED:] markers in output", () => {
    const r = detectScaffoldLeak(
      "Final answer: [STORED: _tool_result_3 | get-hn-posts]",
    );
    expect(r.leaked).toBe(true);
  });

  it("PASSES a normal synthesis citing actual titles", () => {
    const r = detectScaffoldLeak(
      "## Top Stories\n1. Asahi Linux Progress (273 points)\n2. Statecharts: hierarchical state machines (158)",
    );
    expect(r.leaked).toBe(false);
  });
});
