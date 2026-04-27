// Run: bun test packages/reasoning/tests/kernel/capabilities/verify/verifier.test.ts --timeout 15000
//
// Unit tests for the Verifier service (Sprint 3.2). Pins the contract
// by which every effector output flows through verify(). Future sprints
// (Arbitrator in S3.3, Reflection in S3.4) consume the VerificationResult
// — these tests ensure that consumption is on a stable surface.

import { describe, it, expect } from "bun:test";
import {
  defaultVerifier,
  defaultVerifierRetryPolicy,
  contextFromObservation,
  type VerificationContext,
  type Verifier,
  type VerifierRetryPolicy,
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

// ─── Sprint 3.5 Stage 2.5 — verifier-driven retry policy hooks ──────────────
//
// Pins the developer-overridable contract: custom Verifier and custom
// VerifierRetryPolicy can replace defaults without touching kernel internals.
// Vision §1 (Pillar: Control) requires that every harness primitive be
// hookable; these tests make that contractual.

describe("defaultVerifierRetryPolicy — pins default behavior", () => {
  const verdict = defaultVerifier.verify({
    action: "final-answer",
    content: "x",
    actionSuccess: true,
    task: "t",
    priorSteps: [],
    terminal: true,
  });

  it("retries while budget remains", () => {
    const decision = defaultVerifierRetryPolicy({
      verdict,
      iteration: 1,
      retriesUsed: 0,
      maxRetries: 1,
      stepCount: 3,
      toolsUsed: new Set(),
    });
    expect(decision.retry).toBe(true);
    expect(decision.reason).toBeDefined();
  });

  it("stops retrying when budget is exhausted", () => {
    const decision = defaultVerifierRetryPolicy({
      verdict,
      iteration: 2,
      retriesUsed: 1,
      maxRetries: 1,
      stepCount: 3,
      toolsUsed: new Set(),
    });
    expect(decision.retry).toBe(false);
    expect(decision.reason).toContain("exhausted");
  });
});

describe("VerifierRetryPolicy contract — developer overrides", () => {
  it("policy can suppress retry for specific failure shapes", () => {
    // E.g. don't retry long-form synthesis (T5 regression class).
    const policy: VerifierRetryPolicy = (ctx) => {
      if (ctx.stepCount > 6 && ctx.verdict.summary.includes("synthesis")) {
        return { retry: false, reason: "long-form synthesis: retry regresses" };
      }
      return defaultVerifierRetryPolicy(ctx);
    };

    const verdict = {
      verified: false,
      summary: "final-answer: failed at synthesis-grounded",
      action: "final-answer",
      checks: [{ name: "synthesis-grounded", passed: false, reason: "fab" }],
    };
    const decision = policy({
      verdict,
      iteration: 4,
      retriesUsed: 0,
      maxRetries: 3,
      stepCount: 8,
      toolsUsed: new Set(),
    });
    expect(decision.retry).toBe(false);
    expect(decision.reason).toContain("regresses");
  });

  it("policy can customize the harness signal text", () => {
    const policy: VerifierRetryPolicy = () => ({
      retry: true,
      signalText: "🛠 retry with extra hint: try calling tool X first",
    });
    const decision = policy({
      verdict: { verified: false, summary: "x", action: "y", checks: [] },
      iteration: 1,
      retriesUsed: 0,
      maxRetries: 1,
      stepCount: 1,
      toolsUsed: new Set(),
    });
    expect(decision.signalText).toContain("extra hint");
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
