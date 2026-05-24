// Run: bun test packages/reasoning/tests/kernel/capabilities/verify/verifier.test.ts --timeout 15000
//
// Unit tests for the Verifier service (Sprint 3.2). Pins the contract
// by which every effector output flows through verify(). Future sprints
// (Arbitrator in S3.3, Reflection in S3.4) consume the VerificationResult
// — these tests ensure that consumption is on a stable surface.

import { describe, it, expect } from "bun:test";
import {
  defaultVerifier,
  contextFromObservation,
  type VerificationContext,
  type Verifier,
} from "../../../../src/kernel/capabilities/verify/verifier.js";
import type { ReasoningStep } from "../../../../src/types/index.js";
import type { ObservationResult } from "../../../../src/types/observation.js";

const baseCtx: VerificationContext = {
  action: "web-search",
  content: "result content",
  actionSuccess: true,
  task: "find the answer",
  priorSteps: [],
};

describe("defaultVerifier — basic contract", () => {
  it("returns verified=true when action succeeds with content", () => {
    const r = defaultVerifier.verify(baseCtx);
    expect(r.verified).toBe(true);
    expect(r.action).toBe("web-search");
    expect(r.checks.length).toBeGreaterThanOrEqual(2);
  });

  it("returns verified=false when actionSuccess is false", () => {
    const r = defaultVerifier.verify({ ...baseCtx, actionSuccess: false });
    expect(r.verified).toBe(false);
    const failed = r.checks.find((c) => c.name === "action-success");
    expect(failed?.passed).toBe(false);
    expect(failed?.reason).toContain("success=false");
  });

  it("flags empty content as failed non-empty-content check", () => {
    const r = defaultVerifier.verify({ ...baseCtx, content: "" });
    expect(r.verified).toBe(false);
    const empty = r.checks.find((c) => c.name === "non-empty-content");
    expect(empty?.passed).toBe(false);
  });

  it("flags whitespace-only content as empty (trim semantics)", () => {
    const r = defaultVerifier.verify({ ...baseCtx, content: "   \n\t  " });
    expect(r.verified).toBe(false);
    expect(r.checks.find((c) => c.name === "non-empty-content")?.passed).toBe(false);
  });

  it("preserves the action in result.action for trace correlation", () => {
    const r = defaultVerifier.verify({ ...baseCtx, action: "custom-tool" });
    expect(r.action).toBe("custom-tool");
  });

  it("summary names the failed check when verification fails", () => {
    const r = defaultVerifier.verify({ ...baseCtx, actionSuccess: false });
    expect(r.summary).toContain("action-success");
  });

  it("summary reports check count when all passed", () => {
    const r = defaultVerifier.verify(baseCtx);
    expect(r.summary).toMatch(/\d+ checks? passed/);
  });
});

describe("defaultVerifier — non-terminal vs terminal checks", () => {
  it("non-terminal actions only run action-success + non-empty-content", () => {
    const r = defaultVerifier.verify({ ...baseCtx, terminal: false });
    const names = r.checks.map((c) => c.name);
    expect(names).toContain("action-success");
    expect(names).toContain("non-empty-content");
    expect(names).not.toContain("required-tools-satisfied");
    expect(names).not.toContain("completion-claim");
    expect(names).not.toContain("evidence-grounded");
  });

  it("does NOT add required-tools-satisfied — that check moved to runner §8 for delegation awareness", () => {
    const r = defaultVerifier.verify({
      ...baseCtx,
      terminal: true,
      requiredTools: ["web-search"],
      toolsUsed: new Set(["web-search"]),
    });
    // The verifier's flat requiredTools.filter check lacked sub-agent-delegation
    // awareness (where a child kernel's tool call satisfies the parent's
    // requirement). That logic now lives in runner.ts post-loop check.
    // The verifier focuses on output-quality signals (agent-took-action,
    // synthesis-grounded, completion-claim).
    expect(r.checks.find((c) => c.name === "required-tools-satisfied")).toBeUndefined();
  });

  it("terminal actions skip required-tools check when no requiredTools given", () => {
    const r = defaultVerifier.verify({ ...baseCtx, terminal: true });
    expect(r.checks.find((c) => c.name === "required-tools-satisfied")).toBeUndefined();
  });

  it("terminal actions add completion-claim as informational (always passes)", () => {
    const r = defaultVerifier.verify({
      ...baseCtx,
      terminal: true,
      content: "SATISFIED: the task is complete",
    });
    const check = r.checks.find((c) => c.name === "completion-claim");
    expect(check?.passed).toBe(true);
    expect(check?.reason).toBeUndefined();
  });

  it("terminal actions note absence of completion-claim as informational only", () => {
    const r = defaultVerifier.verify({
      ...baseCtx,
      terminal: true,
      content: "Here is the answer.",
    });
    const check = r.checks.find((c) => c.name === "completion-claim");
    expect(check?.passed).toBe(true); // informational, never fails
    expect(check?.reason).toContain("informational");
  });

  it("terminal actions skip evidence-grounded when no priorSteps", () => {
    const r = defaultVerifier.verify({ ...baseCtx, terminal: true });
    expect(r.checks.find((c) => c.name === "evidence-grounded")).toBeUndefined();
  });

  it("terminal-only checks short-circuit when action-success failed", () => {
    const r = defaultVerifier.verify({
      ...baseCtx,
      terminal: true,
      actionSuccess: false,
      requiredTools: ["web-search"],
    });
    // Only action-success + non-empty-content should run; terminal checks
    // short-circuit because action itself failed.
    expect(r.checks.find((c) => c.name === "required-tools-satisfied")).toBeUndefined();
    expect(r.checks.find((c) => c.name === "completion-claim")).toBeUndefined();
  });
});

describe("defaultVerifier — evidence grounding (terminal)", () => {
  // Build a step with rich tool-result evidence ($1,234.56 explicitly visible)
  const withEvidence = (text: string): ReasoningStep => ({
    id: "s1" as ReasoningStep["id"],
    type: "observation",
    content: text,
    timestamp: new Date(),
    metadata: {
      observationResult: {
        success: true,
        toolName: "web-search",
        displayText: text,
        category: "web-search",
        resultKind: "data",
        preserveOnCompaction: false,
        trustLevel: "untrusted",
      } as ObservationResult,
    },
  });

  it("passes evidence-grounded when output's amounts appear in tool evidence", () => {
    const r = defaultVerifier.verify({
      ...baseCtx,
      terminal: true,
      content: "The price is $1,234.56 today.",
      priorSteps: [withEvidence("Search results: BTC trades at $1234.56 USD")],
    });
    expect(r.checks.find((c) => c.name === "evidence-grounded")?.passed).toBe(true);
  });

  it("flags evidence-grounded when output cites amounts not in evidence", () => {
    const r = defaultVerifier.verify({
      ...baseCtx,
      terminal: true,
      content: "The price is $9,999.99 today.",
      priorSteps: [withEvidence("Search results: BTC trades at $1,234.56 USD")],
    });
    const check = r.checks.find((c) => c.name === "evidence-grounded");
    expect(check?.passed).toBe(false);
    expect(check?.reason).toContain("9,999.99");
  });
});

describe("defaultVerifier — output-not-harness-parrot (terminal)", () => {
  const harnessSignal = (text: string): ReasoningStep => ({
    id: "hs1" as ReasoningStep["id"],
    type: "harness_signal",
    content: text,
    timestamp: new Date(),
  });
  const thought = (text: string): ReasoningStep => ({
    id: "t1" as ReasoningStep["id"],
    type: "thought",
    content: text,
    timestamp: new Date(),
  });

  it("rejects output that begins with the harness '⚠️ ' prefix", () => {
    const r = defaultVerifier.verify({
      ...baseCtx,
      terminal: true,
      content: "⚠️ Recovery required: prior tool path failed (file-read). Try an alternate path now: web-search. Do not finalize yet. (1/2)",
      priorSteps: [harnessSignal("⚠️ Recovery required: prior tool path failed (file-read). Try an alternate path now: web-search. Do not finalize yet. (1/2)")],
    });
    const check = r.checks.find((c) => c.name === "output-not-harness-parrot");
    expect(check?.passed).toBe(false);
    expect(r.verified).toBe(false);
  });

  it("rejects output that echoes a recent harness_signal verbatim (no prefix)", () => {
    const sig = "Loop detected but required tool quota is still missing: read-file. Call the missing required tool(s) now instead of finalizing.";
    const r = defaultVerifier.verify({
      ...baseCtx,
      terminal: true,
      content: sig,
      priorSteps: [harnessSignal(`⚠️ ${sig}`)],
    });
    const check = r.checks.find((c) => c.name === "output-not-harness-parrot");
    expect(check?.passed).toBe(false);
  });

  it("passes a real answer that does not match any recent harness_signal", () => {
    const r = defaultVerifier.verify({
      ...baseCtx,
      terminal: true,
      content: "The TV ELEC-4K-TV-001 went out of stock after order 3 on day 2, costing roughly $4,200 in lost revenue. Recommend pre-buying inventory ahead of promotional periods.",
      priorSteps: [harnessSignal("⚠️ Required tools not yet used: read-file. (Redirect 1/3)"), thought("Looking at the data...")],
    });
    const check = r.checks.find((c) => c.name === "output-not-harness-parrot");
    expect(check?.passed).toBe(true);
    expect(r.verified).toBe(true);
  });

  it("passes when there are no recent harness_signal steps", () => {
    const r = defaultVerifier.verify({
      ...baseCtx,
      terminal: true,
      content: "Plain answer with no harness echo.",
      priorSteps: [thought("My reasoning here.")],
    });
    expect(r.checks.find((c) => c.name === "output-not-harness-parrot")?.passed).toBe(true);
  });

  it("only looks back at the last 10 steps for harness signals", () => {
    const oldSig = harnessSignal("⚠️ Old recovery message that should not match");
    const filler = Array.from({ length: 11 }, (_, i) => thought(`filler thought ${i}`));
    const r = defaultVerifier.verify({
      ...baseCtx,
      terminal: true,
      content: "Old recovery message that should not match",
      priorSteps: [oldSig, ...filler],
    });
    expect(r.checks.find((c) => c.name === "output-not-harness-parrot")?.passed).toBe(true);
  });
});

describe("contextFromObservation helper", () => {
  const obs: ObservationResult = {
    success: true,
    toolName: "web-search",
    displayText: "result text",
    category: "web-search",
    resultKind: "data",
    preserveOnCompaction: false,
    trustLevel: "untrusted",
  };

  it("lifts an ObservationResult into a VerificationContext (defaults to non-terminal)", () => {
    const ctx = contextFromObservation({
      observation: obs,
      task: "test",
      priorSteps: [],
    });
    expect(ctx.action).toBe("web-search");
    expect(ctx.content).toBe("result text");
    expect(ctx.actionSuccess).toBe(true);
    expect(ctx.terminal).toBe(false);
  });

  it("opt-in to terminal verification preserves the flag", () => {
    const ctx = contextFromObservation({
      observation: obs,
      task: "test",
      priorSteps: [],
      terminal: true,
    });
    expect(ctx.terminal).toBe(true);
  });

  it("forwards requiredTools + toolsUsed for terminal verification", () => {
    const ctx = contextFromObservation({
      observation: obs,
      task: "test",
      priorSteps: [],
      requiredTools: ["web-search"],
      toolsUsed: new Set(["web-search"]),
    });
    expect(ctx.requiredTools).toEqual(["web-search"]);
    expect(ctx.toolsUsed?.has("web-search")).toBe(true);
  });
});

// ─── GH #121 / I5 — Multi-severity verifier ─────────────────────────────────
describe("defaultVerifier — multi-severity (GH #121)", () => {
  const harnessSignal = (text: string): ReasoningStep => ({
    id: "hs1" as ReasoningStep["id"],
    type: "harness_signal",
    content: text,
    timestamp: new Date(),
  });

  describe("severity field on every check", () => {
    it("attaches severity to action-success (pass on success)", () => {
      const r = defaultVerifier.verify(baseCtx);
      const check = r.checks.find((c) => c.name === "action-success");
      expect(check?.severity).toBe("pass");
    });

    it("attaches severity=reject to action-success on failure", () => {
      const r = defaultVerifier.verify({ ...baseCtx, actionSuccess: false });
      const check = r.checks.find((c) => c.name === "action-success");
      expect(check?.severity).toBe("reject");
    });

    it("attaches severity=reject to non-empty-content on empty output", () => {
      const r = defaultVerifier.verify({ ...baseCtx, content: "" });
      const check = r.checks.find((c) => c.name === "non-empty-content");
      expect(check?.severity).toBe("reject");
    });
  });

  describe("F4 success metric (1): M2 producer-leak outputs emit severity=reject", () => {
    it("rationale XML leak → output-not-harness-parrot severity=reject", () => {
      // Direct reproduction of cogito:14b ToT/Reflexion M2a/b/c outputs per
      // wiki/Research/Harness-Reports/cross-strategy-matrix-analysis-2026-05-23.md §M2.
      const r = defaultVerifier.verify({
        ...baseCtx,
        terminal: true,
        content: `<rationale call="1">{"why":"direct calculation of multiplication","what":"compute 17*23"}</rationale>`,
        priorSteps: [],
      });
      const check = r.checks.find((c) => c.name === "output-not-harness-parrot");
      expect(check?.passed).toBe(false);
      expect(check?.severity).toBe("reject");
      expect(r.severity).toBe("reject");
      expect(r.verified).toBe(false);
      expect(r.softFail).toBe(false);
    });

    it("[CRITIQUE] marker leak → severity=reject", () => {
      const r = defaultVerifier.verify({
        ...baseCtx,
        terminal: true,
        content: `[CRITIQUE 1] NEUTRAL: the prior step is fine`,
        priorSteps: [],
      });
      const check = r.checks.find((c) => c.name === "output-not-harness-parrot");
      expect(check?.severity).toBe("reject");
      expect(r.severity).toBe("reject");
    });

    it("[find result —] preview wrapper leak → severity=reject", () => {
      const r = defaultVerifier.verify({
        ...baseCtx,
        terminal: true,
        content: `[find result — 5 items] foo: bar baz: qux`,
        priorSteps: [],
      });
      const check = r.checks.find((c) => c.name === "output-not-harness-parrot");
      expect(check?.severity).toBe("reject");
    });

    it("harness signal '⚠️ ' prefix → severity=reject", () => {
      const r = defaultVerifier.verify({
        ...baseCtx,
        terminal: true,
        content: "⚠️ Recovery required: try web-search.",
        priorSteps: [harnessSignal("⚠️ Recovery required: try web-search.")],
      });
      expect(r.severity).toBe("reject");
    });
  });

  describe("F4 success metric (2): shallow give-up answers escalate", () => {
    it("'no 7th result' + unused tools → severity=escalate (output-not-shallow-giveup)", () => {
      // Direct reproduction of F4 from sweep-2026-05-23-qwen3-14b.md:
      // Agent called `find` (wrong tool), saw 5 entries in preview, answered
      // "no 7th result available." Task included `recall` tool unused.
      const r = defaultVerifier.verify({
        ...baseCtx,
        terminal: true,
        content: "The search results only contain 5 entries. There is no 7th result available.",
        priorSteps: [],
        availableUserTools: ["web-search", "recall"],
        toolsUsed: new Set(["find"]),
      });
      const check = r.checks.find((c) => c.name === "output-not-shallow-giveup");
      expect(check?.passed).toBe(false);
      expect(check?.severity).toBe("escalate");
      expect(r.severity).toBe("escalate");
      expect(r.verified).toBe(false);
    });

    it("'I cannot complete this task' + unused tools → severity=escalate", () => {
      const r = defaultVerifier.verify({
        ...baseCtx,
        terminal: true,
        content: "I cannot complete this task with the information provided.",
        availableUserTools: ["web-search"],
        toolsUsed: new Set([]),
      });
      const check = r.checks.find((c) => c.name === "output-not-shallow-giveup");
      expect(check?.severity).toBe("escalate");
    });

    it("give-up phrasing but all tools used → severity=pass (no false positive)", () => {
      const r = defaultVerifier.verify({
        ...baseCtx,
        terminal: true,
        content: "I cannot complete this task.",
        availableUserTools: ["web-search"],
        toolsUsed: new Set(["web-search"]),
      });
      const check = r.checks.find((c) => c.name === "output-not-shallow-giveup");
      expect(check?.severity).toBe("pass");
    });

    it("legitimate answer with no give-up phrasing → severity=pass", () => {
      const r = defaultVerifier.verify({
        ...baseCtx,
        terminal: true,
        content: "The 7th result is React.",
        availableUserTools: ["web-search", "recall"],
        toolsUsed: new Set(["find"]),
      });
      const check = r.checks.find((c) => c.name === "output-not-shallow-giveup");
      expect(check?.severity).toBe("pass");
    });
  });

  describe("harness_deliverable → severity=escalate (output-is-model-authored)", () => {
    it("emits escalate so Loop Controller can strategy-switch instead of retry-in-place", () => {
      const r = defaultVerifier.verify({
        ...baseCtx,
        terminal: true,
        content: '[{"foo":"bar"}]',
        terminatedBy: "harness_deliverable",
        priorSteps: [],
      });
      const check = r.checks.find((c) => c.name === "output-is-model-authored");
      expect(check?.passed).toBe(false);
      expect(check?.severity).toBe("escalate");
      expect(r.severity).toBe("escalate");
    });
  });

  describe("overall severity rollup (max severity wins)", () => {
    it("warn + pass → overall=warn (softFail=true, verified=false)", () => {
      // Synthesis-grounded fails (warn), no rejects/escalates.
      const r = defaultVerifier.verify({
        ...baseCtx,
        terminal: true,
        content: "The price is $9,999.99 today.",
        priorSteps: [
          {
            id: "s1" as ReasoningStep["id"],
            type: "observation",
            content: "BTC trades at $1,234.56 USD",
            timestamp: new Date(),
          },
        ],
      });
      expect(r.severity).toBe("warn");
      expect(r.softFail).toBe(true);
      expect(r.verified).toBe(false);
    });

    it("reject dominates warn (escalate dominates everything)", () => {
      // Producer-leak (reject) + grounding miss would-be (warn) → overall reject.
      const r = defaultVerifier.verify({
        ...baseCtx,
        terminal: true,
        content: `<rationale call="1">stuff</rationale>`,
        priorSteps: [
          {
            id: "s1" as ReasoningStep["id"],
            type: "observation",
            content: "some evidence",
            timestamp: new Date(),
          },
        ],
      });
      expect(r.severity).toBe("reject");
      expect(r.softFail).toBe(false);
    });

    it("all pass → overall=pass, verified=true, softFail=false", () => {
      const r = defaultVerifier.verify({ ...baseCtx, terminal: true });
      expect(r.severity).toBe("pass");
      expect(r.verified).toBe(true);
      expect(r.softFail).toBe(false);
    });
  });

  describe("back-compat: checkSeverity helper handles legacy producers", () => {
    it("infers pass from {passed:true} when severity is absent", () => {
      // Eagerly imported alongside defaultVerifier — covered by re-exports.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { checkSeverity } = require("../../../../src/kernel/capabilities/verify/verifier.js") as typeof import("../../../../src/kernel/capabilities/verify/verifier.js");
      expect(checkSeverity({ name: "x", passed: true })).toBe("pass");
      expect(checkSeverity({ name: "x", passed: false })).toBe("reject");
      expect(checkSeverity({ name: "x", passed: true, severity: "warn" })).toBe("warn");
      expect(checkSeverity({ name: "x", passed: false, severity: "escalate" })).toBe("escalate");
    });
  });
});

describe("Verifier contract — developer overrides", () => {
  it("custom verifier can replace defaultVerifier without touching kernel", () => {
    const customVerifier: Verifier = {
      verify: () => ({
        verified: true,
        action: "always-pass",
        summary: "domain-specific check passed",
        checks: [{ name: "custom", passed: true }],
      }),
    };
    const verdict = customVerifier.verify({
      action: "anything",
      content: "anything",
      actionSuccess: false, // even with actionSuccess=false, custom says verified
      task: "x",
      priorSteps: [],
      terminal: true,
    });
    expect(verdict.verified).toBe(true);
    expect(verdict.summary).toContain("domain-specific");
  });
});
