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

// ─── Sprint 3.4 Scaffold 2 — validateGeneralizedGrounding tests ──────────────
import { validateGeneralizedGrounding } from "../../../src/kernel/capabilities/verify/evidence-grounding.js";

describe("validateGeneralizedGrounding (Scaffold 2 — task-agnostic)", () => {
  it("FAILS when output contains framework compression markers (echo detection)", () => {
    const r = validateGeneralizedGrounding(
      "[recall result — compressed preview]\nType: Object(4 keys)\n_tool_result_5 ...",
      "real evidence corpus content",
    );
    expect(r.verified).toBe(false);
    expect(r.compressionEchoDetected).toBe(true);
    expect(r.reason).toContain("compression markers");
  });

  it("FAILS on bare [STORED:] markers in output", () => {
    const r = validateGeneralizedGrounding(
      "Final answer: [STORED: _tool_result_3 | get-hn-posts]",
      "evidence corpus with actual content",
    );
    expect(r.verified).toBe(false);
    expect(r.compressionEchoDetected).toBe(true);
  });

  it("PASSES when output is a normal synthesis citing actual titles", () => {
    const r = validateGeneralizedGrounding(
      "## Top Stories\n1. Asahi Linux Progress (273 points)\n2. Statecharts: hierarchical state machines (158)",
      "Asahi Linux Progress 273 points; Statecharts: hierarchical state machines 158 points; Other stories",
    );
    expect(r.verified).toBe(true);
    expect(r.compressionEchoDetected).toBe(false);
    expect(r.groundingRate).toBeGreaterThan(0.5);
  });

  it("FAILS when most claims are not in evidence (fabrication)", () => {
    const r = validateGeneralizedGrounding(
      'The top stories are "Acme Widget", "Foo Bar", "Lorem Ipsum", with values 999, 888, 777',
      "Real evidence: Asahi Linux 273; Statecharts 158",
    );
    expect(r.verified).toBe(false);
    expect(r.ungroundedClaims.length).toBeGreaterThan(2);
  });

  it("ABSTAINS when evidence corpus is too thin", () => {
    const r = validateGeneralizedGrounding(
      "Some output with multiple claims",
      "tiny",
    );
    expect(r.verified).toBe(true);
    expect(r.reason).toContain("no evidence corpus");
  });

  it("ABSTAINS when output has too few extractable claims", () => {
    const r = validateGeneralizedGrounding(
      "ok",
      "Real evidence: Asahi Linux 273; Statecharts 158; many things here",
    );
    expect(r.verified).toBe(true);
    expect(r.reason).toContain("below threshold");
  });

  it("DETECTS quoted-phrase fabrication", () => {
    const r = validateGeneralizedGrounding(
      'The customer said "I love this product" and "I hate this product" and 999 dollars and another fabricated TestThing',
      "Customer feedback corpus: response time 12 seconds; complaints about pricing",
      { maxUngroundedRate: 0.2 }, // strict — quoted fabrication should fail at 0.2
    );
    expect(r.verified).toBe(false);
    expect(r.ungroundedClaims.some((c) => c.includes("love") || c.includes("hate"))).toBe(true);
  });

  it("DETECTS capitalized-phrase fabrication (titles/names)", () => {
    const r = validateGeneralizedGrounding(
      "The leading products are Acme Widget Pro and Foo Bar Ultra and Lorem Ipsum Plus",
      "Actual product list: WidgetMaster 3000, FooBox Standard, BarKit Lite",
    );
    expect(r.verified).toBe(false);
  });

  it("PASSES partial-prefix matching for long titles (≥80% prefix in evidence)", () => {
    const r = validateGeneralizedGrounding(
      "1. Asahi Linux Progress Linux 7 Point Zero (full title)",
      "Asahi Linux Progress Linux 7.0 — story details",
    );
    expect(r.verified).toBe(true);
  });

  it("respects custom maxUngroundedRate threshold (lenient passes, strict fails on same data)", () => {
    // Synthesize a case with KNOWN counts: 4 claims, 2 grounded, 2 ungrounded → 50% ungroundedRate
    const output =
      'The data shows "Foo Real" and "Bar Real" plus FabricatedTitle ProductX (999 points)';
    const evidence =
      "evidence: 'Foo Real' is one item, 'Bar Real' is another, plus other irrelevant 555 items";

    const lenient = validateGeneralizedGrounding(output, evidence, {
      maxUngroundedRate: 0.7,
      minClaimsForCheck: 1,
    });
    expect(lenient.totalClaims).toBeGreaterThanOrEqual(2);
    expect(lenient.verified).toBe(true);

    const strict = validateGeneralizedGrounding(output, evidence, {
      maxUngroundedRate: 0,
      minClaimsForCheck: 1,
    });
    // With ANY ungrounded claim (rate > 0), strict mode fails.
    if (strict.ungroundedClaims.length > 0) {
      expect(strict.verified).toBe(false);
    }
  });
});
