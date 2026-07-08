// File: src/kernel/assessment/assess.test.ts
//
// Tests for the RunAssessment estimator (meta-loop Phase 5a / task E1).
// Covers: the long-gathering false-positive guard (sweep acceptance #2),
// phase inference progression, pace bands (burnRatio × outstanding coupling),
// requirement/deliverable derivation from the ledger, and determinism.

import { describe, expect, it } from "bun:test";
import {
  artifactProduced,
  outputContains,
  toolCalled,
} from "../capabilities/verify/post-conditions.js";
import type { RunContract } from "../contract/run-contract.js";
import { appendEntries, type RunLedger } from "../ledger/run-ledger.js";
import { assess, type BudgetState } from "./assess.js";

// ── Fixtures ────────────────────────────────────────────────────────────────

/** A contract with one deterministic tool-coverage requirement + the answer floor. */
function toolContract(tool = "web-search"): RunContract {
  return {
    requirements: [
      {
        id: `tool:${tool}`,
        kind: "tool-coverage",
        spec: { description: `call ${tool}`, condition: toolCalled(tool), acceptance: "deterministic" },
        weight: 1,
      },
      {
        id: "answer",
        kind: "question-answered",
        spec: { description: "answer the task", acceptance: "self-critique" },
        weight: 1,
      },
    ],
    deliverables: [],
    constraints: [],
    horizon: "long",
    acceptance: { tiers: ["deterministic", "checker", "self-critique"], stakes: "standard" },
    postConditions: [toolCalled(tool)],
  };
}

/** A research-and-deliver contract: 1 gather tool + 2 file deliverables. */
function deliverContract(): RunContract {
  return {
    requirements: [
      {
        id: "tool:web-search",
        kind: "tool-coverage",
        spec: { description: "call web-search", condition: toolCalled("web-search"), acceptance: "deterministic" },
        weight: 1,
      },
      {
        id: "artifact:report.md",
        kind: "artifact-produced",
        spec: { description: "write report.md", condition: artifactProduced("report.md"), acceptance: "deterministic" },
        weight: 2,
      },
      {
        id: "artifact:findings.json",
        kind: "artifact-produced",
        spec: { description: "write findings.json", condition: artifactProduced("findings.json"), acceptance: "deterministic" },
        weight: 2,
      },
      {
        id: "answer",
        kind: "question-answered",
        spec: { description: "answer the task", acceptance: "self-critique" },
        weight: 1,
      },
    ],
    deliverables: [
      { id: "artifact:report.md", kind: "file", matcher: artifactProduced("report.md"), acceptance: "deterministic" },
      { id: "artifact:findings.json", kind: "file", matcher: artifactProduced("findings.json"), acceptance: "deterministic" },
    ],
    constraints: [],
    horizon: "long",
    acceptance: { tiers: ["deterministic", "checker", "self-critique"], stakes: "high" },
    postConditions: [toolCalled("web-search"), artifactProduced("report.md"), artifactProduced("findings.json")],
  };
}

/** Build a ledger of `n` DISTINCT successful gather rounds over iterations 1..n. */
function gatherLedger(n: number): RunLedger {
  let ledger: RunLedger = [];
  for (let i = 1; i <= n; i++) {
    ledger = appendEntries(ledger, [
      { kind: "tool-invocation", iteration: i, toolName: "web-search", args: { q: `query-${i}` }, toolCallId: `call-${i}` },
      { kind: "tool-result", iteration: i, toolName: "web-search", success: true, preview: `result ${i}`, toolCallId: `call-${i}` },
    ]);
  }
  return ledger;
}

function budget(overrides: Partial<BudgetState> = {}): BudgetState {
  return { iteration: 1, maxIterations: 50, tokensUsed: 0, costUsd: 0, ...overrides };
}

// ── Long-gathering false-positive (sweep acceptance #2) ─────────────────────

describe("assess — long-gathering false positive", () => {
  it("15 distinct gathers over 15 iterations → evidenceDelta > 0 every iteration, zero stall signals", () => {
    const contract = deliverContract();
    for (let i = 1; i <= 15; i++) {
      const a = assess(contract, gatherLedger(i), budget({ iteration: i }));
      expect(a.evidenceDelta).toBeGreaterThan(0);
      expect(a.health.stuckSignals).toBe(0);
      expect(a.health.repeatWaste).toBe(0);
      expect(a.health.consecutiveFailures).toBe(0);
      expect(a.health.recentFailures).toBe(0);
      expect(a.health.iterationsSinceEvidence).toBe(0);
    }
  });

  it("a repeated identical gather is NOT counted as new evidence (C3 identity reuse)", () => {
    const contract = toolContract();
    // Iteration 1 gathers query-A; iteration 2 repeats the SAME (tool, args).
    const ledger = appendEntries(undefined, [
      { kind: "tool-invocation", iteration: 1, toolName: "web-search", args: { q: "A" }, toolCallId: "c1" },
      { kind: "tool-result", iteration: 1, toolName: "web-search", success: true, preview: "r", toolCallId: "c1" },
      { kind: "tool-invocation", iteration: 2, toolName: "web-search", args: { q: "A" }, toolCallId: "c2" },
      { kind: "tool-result", iteration: 2, toolName: "web-search", success: true, preview: "r", toolCallId: "c2" },
    ]);
    const a = assess(contract, ledger, budget({ iteration: 2 }));
    expect(a.evidenceDelta).toBe(0); // identity already seen at iteration 1
  });

  it("meta-tool and failed results are NOT substantive evidence", () => {
    const contract = toolContract();
    const ledger = appendEntries(undefined, [
      { kind: "tool-invocation", iteration: 1, toolName: "recall", args: { key: "x" }, toolCallId: "m1" },
      { kind: "tool-result", iteration: 1, toolName: "recall", success: true, preview: "r", toolCallId: "m1" },
      { kind: "tool-invocation", iteration: 1, toolName: "web-search", args: { q: "z" }, toolCallId: "f1" },
      { kind: "tool-result", iteration: 1, toolName: "web-search", success: false, preview: "err", toolCallId: "f1" },
    ]);
    const a = assess(contract, ledger, budget({ iteration: 1 }));
    expect(a.evidenceDelta).toBe(0);
  });
});

// ── Phase inference ─────────────────────────────────────────────────────────

describe("assess — phase inference", () => {
  const contract = deliverContract();

  it("empty ledger → orient", () => {
    expect(assess(contract, [], budget({ iteration: 0 })).phase).toBe("orient");
  });

  it("gathering evidence present → gather", () => {
    expect(assess(contract, gatherLedger(2), budget({ iteration: 2 })).phase).toBe("gather");
  });

  it("recent writing/mutation actions dominate → execute", () => {
    // gathered, then a run of file-write actions (one deliverable still outstanding)
    const ledger = appendEntries(gatherLedger(1), [
      { kind: "tool-invocation", iteration: 2, toolName: "file-write", args: { path: "report.md" }, toolCallId: "w1" },
      { kind: "tool-result", iteration: 2, toolName: "file-write", success: true, preview: "ok", toolCallId: "w1" },
      { kind: "artifact", iteration: 2, path: "report.md", op: "write", toolCallId: "w1" },
    ]);
    expect(assess(contract, ledger, budget({ iteration: 2 })).phase).toBe("execute");
  });

  it("all deterministic requirements satisfied → synthesize", () => {
    const ledger = appendEntries(gatherLedger(1), [
      { kind: "tool-invocation", iteration: 2, toolName: "file-write", args: { path: "report.md" }, toolCallId: "w1" },
      { kind: "tool-result", iteration: 2, toolName: "file-write", success: true, preview: "ok", toolCallId: "w1" },
      { kind: "artifact", iteration: 2, path: "report.md", op: "write", toolCallId: "w1" },
      { kind: "tool-invocation", iteration: 3, toolName: "file-write", args: { path: "findings.json" }, toolCallId: "w2" },
      { kind: "tool-result", iteration: 3, toolName: "file-write", success: true, preview: "ok", toolCallId: "w2" },
      { kind: "artifact", iteration: 3, path: "findings.json", op: "write", toolCallId: "w2" },
    ]);
    expect(assess(contract, ledger, budget({ iteration: 3 })).phase).toBe("synthesize");
  });

  it("terminal verdict present → verify", () => {
    const ledger = appendEntries(gatherLedger(1), [
      { kind: "verdict", iteration: 2, gate: "terminal", verified: true },
    ]);
    expect(assess(contract, ledger, budget({ iteration: 2 })).phase).toBe("verify");
  });
});

// ── Pace bands (burnRatio × outstanding coupling) ───────────────────────────

describe("assess — pace bands", () => {
  it("bands step at 0.60 / 0.80 / 0.95 when deterministic work is outstanding", () => {
    const contract = toolContract(); // 1 deterministic req, empty ledger → outstanding
    const mk = (used: number) =>
      assess(contract, [], budget({ iteration: 5, tokensUsed: used, tokenLimit: 1000 })).pace;

    expect(mk(500).band).toBe("green");
    expect(mk(600).band).toBe("economize");
    expect(mk(800).band).toBe("triage");
    expect(mk(950).band).toBe("terminal");
  });

  it("burnRatio reflects the max of token/cost consumption", () => {
    const contract = toolContract();
    const p = assess(contract, [], budget({ iteration: 5, tokensUsed: 700, tokenLimit: 1000, costUsd: 0.9, costLimit: 1 })).pace;
    expect(p.burnRatio).toBeCloseTo(0.9, 5); // cost ratio 0.9 > token ratio 0.7
  });

  it("no deterministic outstanding → green regardless of burn (coupling proof)", () => {
    const contract = toolContract("web-search");
    // web-search invoked → its requirement satisfied → zero deterministic outstanding
    const ledger = appendEntries(undefined, [
      { kind: "tool-invocation", iteration: 1, toolName: "web-search", args: { q: "x" }, toolCallId: "c1" },
      { kind: "tool-result", iteration: 1, toolName: "web-search", success: true, preview: "r", toolCallId: "c1" },
    ]);
    const p = assess(contract, ledger, budget({ iteration: 2, tokensUsed: 990, tokenLimit: 1000 })).pace;
    expect(p.band).toBe("green");
  });

  it("falls back to iteration/maxIterations when no budget limits are declared", () => {
    const contract = toolContract();
    const p = assess(contract, [], budget({ iteration: 48, maxIterations: 50 })).pace;
    expect(p.burnRatio).toBeCloseTo(0.96, 5);
    expect(p.band).toBe("terminal");
  });
});

// ── Requirement + deliverable derivation ────────────────────────────────────

describe("assess — requirements + deliverables", () => {
  it("derives satisfied/outstanding from ledger tool + artifact facts", () => {
    const contract = deliverContract();
    const ledger = appendEntries(gatherLedger(1), [
      { kind: "tool-invocation", iteration: 2, toolName: "file-write", args: { path: "/abs/dir/report.md" }, toolCallId: "w1" },
      { kind: "tool-result", iteration: 2, toolName: "file-write", success: true, preview: "ok", toolCallId: "w1" },
      { kind: "artifact", iteration: 2, path: "/abs/dir/report.md", op: "write", toolCallId: "w1" },
    ]);
    const a = assess(contract, ledger, budget({ iteration: 2 }));
    expect(a.requirements.satisfied).toContain("tool:web-search");
    expect(a.requirements.satisfied).toContain("artifact:report.md"); // suffix path match
    expect(a.requirements.outstanding).toContain("artifact:findings.json");
    expect(a.requirements.outstanding).toContain("answer"); // self-critique floor, unverifiable mid-run
    // deliverables
    expect(a.deliverables.produced.map((p) => p.id)).toContain("artifact:report.md");
    expect(a.deliverables.missing.map((m) => m.id)).toContain("artifact:findings.json");
  });

  it("honors explicit requirement ledger entries (satisfied / blocked)", () => {
    const contract = toolContract();
    const ledger = appendEntries(undefined, [
      { kind: "requirement", iteration: 1, requirementId: "answer", status: "satisfied", evidenceRef: "seq:0" },
      { kind: "requirement", iteration: 1, requirementId: "tool:web-search", status: "blocked", reason: "tool unavailable" },
    ]);
    const a = assess(contract, ledger, budget({ iteration: 1 }));
    expect(a.requirements.satisfied).toContain("answer");
    expect(a.requirements.blocked).toContain("tool:web-search");
    expect(a.requirements.outstanding).not.toContain("tool:web-search");
  });

  it("OutputContains deliverables are missing mid-run (no output visible to the estimator)", () => {
    const contract: RunContract = {
      requirements: [
        {
          id: "output:Summary",
          kind: "question-answered",
          spec: { description: "include Summary", condition: outputContains("Summary"), acceptance: "deterministic" },
          weight: 1,
        },
      ],
      deliverables: [
        { id: "output:Summary", kind: "answer-section", matcher: outputContains("Summary"), acceptance: "deterministic" },
      ],
      constraints: [],
      horizon: "short",
      acceptance: { tiers: ["deterministic", "checker", "self-critique"], stakes: "standard" },
      postConditions: [outputContains("Summary")],
    };
    const a = assess(contract, gatherLedger(1), budget({ iteration: 1 }));
    expect(a.requirements.outstanding).toContain("output:Summary");
    expect(a.deliverables.missing.map((m) => m.id)).toContain("output:Summary");
  });
});

// ── Health windowing ────────────────────────────────────────────────────────

describe("assess — health", () => {
  it("counts recent failures, consecutive failures, dedup waste and stuck signals", () => {
    const contract = toolContract();
    const ledger = appendEntries(undefined, [
      { kind: "tool-invocation", iteration: 3, toolName: "web-search", args: { q: "a" }, toolCallId: "c1" },
      { kind: "tool-result", iteration: 3, toolName: "web-search", success: false, preview: "err", toolCallId: "c1" },
      { kind: "tool-result", iteration: 4, toolName: "web-search", success: false, preview: "err", toolCallId: "c2" },
      { kind: "harness-signal", iteration: 4, signal: "gather-dedup", detail: "duplicate gather" },
      { kind: "harness-signal", iteration: 4, signal: "loop-detected", detail: "repetition" },
      { kind: "claim", iteration: 4, text: "42% faster", value: 42, grounded: false },
    ]);
    const a = assess(contract, ledger, budget({ iteration: 4 }));
    expect(a.health.recentFailures).toBe(2);
    expect(a.health.consecutiveFailures).toBe(2);
    expect(a.health.repeatWaste).toBe(1);
    expect(a.health.stuckSignals).toBe(1);
    expect(a.health.contradictions).toBe(1);
  });
});

// ── Arg-normalized failure identity (audit 02-#11 / F3) ─────────────────────

describe("assess — failureArgVariety (F3 arg-normalized identity)", () => {
  const contract = toolContract("file-write");

  it("no trailing failure → 0", () => {
    expect(assess(contract, gatherLedger(3), budget({ iteration: 3 })).health.failureArgVariety).toBe(0);
  });

  it("repeated IDENTICAL bad call (same args) → variety 1 (truly stuck)", () => {
    const ledger = appendEntries(undefined, [
      { kind: "tool-invocation", iteration: 1, toolName: "file-write", args: { content: "x" }, toolCallId: "c1" },
      { kind: "tool-result", iteration: 1, toolName: "file-write", success: false, preview: "missing path", toolCallId: "c1" },
      { kind: "tool-invocation", iteration: 2, toolName: "file-write", args: { content: "x" }, toolCallId: "c2" },
      { kind: "tool-result", iteration: 2, toolName: "file-write", success: false, preview: "missing path", toolCallId: "c2" },
    ]);
    expect(assess(contract, ledger, budget({ iteration: 2 })).health.failureArgVariety).toBe(1);
  });

  it("VARYING args across failures → variety > 1 (exploring, not stuck)", () => {
    const ledger = appendEntries(undefined, [
      { kind: "tool-invocation", iteration: 1, toolName: "file-write", args: { content: "a" }, toolCallId: "c1" },
      { kind: "tool-result", iteration: 1, toolName: "file-write", success: false, preview: "missing path", toolCallId: "c1" },
      { kind: "tool-invocation", iteration: 2, toolName: "file-write", args: { content: "b", path: "x" }, toolCallId: "c2" },
      { kind: "tool-result", iteration: 2, toolName: "file-write", success: false, preview: "missing path", toolCallId: "c2" },
    ]);
    expect(assess(contract, ledger, budget({ iteration: 2 })).health.failureArgVariety).toBeGreaterThan(1);
  });

  it("a trailing SUCCESS ends the streak → 0", () => {
    const ledger = appendEntries(undefined, [
      { kind: "tool-invocation", iteration: 1, toolName: "file-write", args: { content: "a" }, toolCallId: "c1" },
      { kind: "tool-result", iteration: 1, toolName: "file-write", success: false, preview: "missing path", toolCallId: "c1" },
      { kind: "tool-invocation", iteration: 2, toolName: "file-write", args: { content: "b", path: "x" }, toolCallId: "c2" },
      { kind: "tool-result", iteration: 2, toolName: "file-write", success: true, preview: "ok", toolCallId: "c2" },
    ]);
    expect(assess(contract, ledger, budget({ iteration: 2 })).health.failureArgVariety).toBe(0);
  });
});

// ── Determinism ─────────────────────────────────────────────────────────────

describe("assess — determinism", () => {
  it("same (contract, ledger, budget) → deep-equal assessment", () => {
    const contract = deliverContract();
    const ledger = gatherLedger(5);
    const b = budget({ iteration: 5, tokensUsed: 400, tokenLimit: 1000 });
    expect(assess(contract, ledger, b)).toEqual(assess(contract, ledger, b));
  });
});
