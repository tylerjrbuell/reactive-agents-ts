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
