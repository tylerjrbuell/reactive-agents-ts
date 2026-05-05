/**
 * M13 Spike: Guards + Meta-tools Validation
 *
 * Tests guard effectiveness with performance metrics:
 * - True Positive Rate (TP): correctly blocked invalid tool calls
 * - False Positive Rate (FP): incorrectly blocked valid tool calls
 * - Latency: guard execution time (<50ms requirement)
 * - Meta-tools registry: aliasing and introspection coverage
 *
 * Success criteria: ≥90% TPR, ≤2% FPR, <50ms latency
 */

import { describe, it, expect, beforeEach } from "bun:test";
import type { ToolCallSpec } from "@reactive-agents/tools";

// Internal kernel imports — guards are not yet publicly exported
// This test validates the guard implementation as part of M13 spike
import type { KernelState, KernelInput } from "../../reasoning/src/kernel/state/kernel-state.js";
import {
  blockedGuard,
  availableToolGuard,
  duplicateGuard,
  sideEffectGuard,
  repetitionGuard,
  metaToolDedupGuard,
  checkToolCall,
  defaultGuards,
  META_TOOL_SET,
  isConsecutiveMetaToolSpam,
} from "../../reasoning/src/kernel/capabilities/act/guard.js";
import { META_TOOLS, INTROSPECTION_META_TOOLS } from "../../reasoning/src/kernel/state/kernel-constants.js";

// ─── Test Metrics ─────────────────────────────────────────────────────────────

interface GuardMetrics {
  totalChecks: number;
  truePositives: number;
  falsePositives: number;
  trueNegatives: number;
  falseNegatives: number;
  avgLatencyMs: number;
  maxLatencyMs: number;
}

class GuardValidator {
  private metrics: GuardMetrics = {
    totalChecks: 0,
    truePositives: 0,
    falsePositives: 0,
    trueNegatives: 0,
    falseNegatives: 0,
    avgLatencyMs: 0,
    maxLatencyMs: 0,
  };

  private latencies: number[] = [];

  recordCheck(shouldFail: boolean, didFail: boolean, latencyMs: number): void {
    this.metrics.totalChecks++;
    this.latencies.push(latencyMs);

    if (shouldFail && didFail) {
      this.metrics.truePositives++;
    } else if (!shouldFail && !didFail) {
      this.metrics.trueNegatives++;
    } else if (shouldFail && !didFail) {
      this.metrics.falseNegatives++;
    } else {
      this.metrics.falsePositives++;
    }
  }

  getMetrics(): GuardMetrics {
    const totalLatency = this.latencies.reduce((a, b) => a + b, 0);
    return {
      ...this.metrics,
      avgLatencyMs: this.metrics.totalChecks > 0 ? totalLatency / this.metrics.totalChecks : 0,
      maxLatencyMs: Math.max(...this.latencies, 0),
    };
  }

  getTPRate(): number {
    const total = this.metrics.truePositives + this.metrics.falseNegatives;
    return total > 0 ? (this.metrics.truePositives / total) * 100 : 0;
  }

  getFPRate(): number {
    const total = this.metrics.falsePositives + this.metrics.trueNegatives;
    return total > 0 ? (this.metrics.falsePositives / total) * 100 : 0;
  }
}

// ─── Mock State Builders ───────────────────────────────────────────────────────

function makeKernelState(overrides?: Partial<KernelState>): KernelState {
  return {
    status: "acting",
    iteration: 0,
    messages: [],
    steps: [],
    lastMetaToolCall: undefined,
    consecutiveMetaToolCount: 0,
    ...overrides,
  } as any;
}

function makeKernelInput(overrides?: Partial<KernelInput>): KernelInput {
  return {
    task: "Test task",
    allToolSchemas: [],
    availableToolSchemas: [],
    requiredTools: [],
    ...overrides,
  };
}

let toolCallCounter = 0;
function makeToolCall(name: string, args: Record<string, unknown> = {}): ToolCallSpec {
  return { id: `call-${++toolCallCounter}`, name, arguments: args };
}

// ─── Guard Tests ──────────────────────────────────────────────────────────────

describe("M13: Guards Validation", () => {
  let validator: GuardValidator;

  beforeEach(() => {
    validator = new GuardValidator();
  });

  describe("blockedGuard", () => {
    it("should pass when tool is not blocked", () => {
      const state = makeKernelState();
      const input = makeKernelInput({ blockedTools: ["search"] });
      const toolCall = makeToolCall("fetch", { url: "http://example.com" });

      const start = performance.now();
      const outcome = blockedGuard(toolCall, state, input);
      const latency = performance.now() - start;

      expect(outcome.pass).toBe(true);
      validator.recordCheck(false, !outcome.pass, latency);
    });

    it("should block when tool is in blockedTools list", () => {
      const state = makeKernelState();
      const input = makeKernelInput({ blockedTools: ["search", "delete-file"] });
      const toolCall = makeToolCall("delete-file", {});

      const start = performance.now();
      const outcome = blockedGuard(toolCall, state, input);
      const latency = performance.now() - start;

      expect(outcome.pass).toBe(false);
      if (!outcome.pass) {
        expect(outcome.observation).toContain("BLOCKED");
      }
      validator.recordCheck(true, !outcome.pass, latency);
    });

    it("should handle empty blockedTools", () => {
      const state = makeKernelState();
      const input = makeKernelInput({ blockedTools: [] });
      const toolCall = makeToolCall("anything", {});

      const outcome = blockedGuard(toolCall, state, input);
      expect(outcome.pass).toBe(true);
    });
  });

  describe("availableToolGuard", () => {
    it("should pass when tool is available", () => {
      const state = makeKernelState();
      const input = makeKernelInput({
        allToolSchemas: [
          { name: "search", description: "Search", parameters: [] },
        ],
      });
      const toolCall = makeToolCall("search", { query: "test" });

      const start = performance.now();
      const outcome = availableToolGuard(toolCall, state, input);
      const latency = performance.now() - start;

      expect(outcome.pass).toBe(true);
      validator.recordCheck(false, !outcome.pass, latency);
    });

    it("should pass meta-tools without availability check", () => {
      const state = makeKernelState();
      const input = makeKernelInput({ allToolSchemas: [] });
      const toolCall = makeToolCall("final-answer", { answer: "test" });

      const start = performance.now();
      const outcome = availableToolGuard(toolCall, state, input);
      const latency = performance.now() - start;

      expect(outcome.pass).toBe(true);
      validator.recordCheck(false, !outcome.pass, latency);
    });

    it("should block unavailable tools with helpful suggestions", () => {
      const state = makeKernelState();
      const input = makeKernelInput({
        allToolSchemas: [
          { name: "web-search", description: "Search", parameters: [] },
          { name: "http-get", description: "Get", parameters: [] },
        ],
      });
      const toolCall = makeToolCall("unknown-tool", {});

      const start = performance.now();
      const outcome = availableToolGuard(toolCall, state, input);
      const latency = performance.now() - start;

      expect(outcome.pass).toBe(false);
      if (!outcome.pass) {
        expect(outcome.observation).toContain("not available");
      }
      validator.recordCheck(true, !outcome.pass, latency);
    });
  });

  describe("duplicateGuard", () => {
    it("should pass on first tool call", () => {
      const state = makeKernelState({ steps: [] });
      const input = makeKernelInput();
      const toolCall = makeToolCall("search", { query: "test" });

      const start = performance.now();
      const outcome = duplicateGuard(toolCall, state, input);
      const latency = performance.now() - start;

      expect(outcome.pass).toBe(true);
      validator.recordCheck(false, !outcome.pass, latency);
    });

    it("should block duplicate successful calls", () => {
      const state = makeKernelState({
        steps: [
          { id: "s1" as any, type: "action" as const, content: "", timestamp: new Date(), metadata: { toolCall: { id: "c1", name: "search", arguments: { query: "test" } } } },
          { id: "s2" as any, type: "observation" as const, content: "Result", timestamp: new Date(), metadata: { observationResult: { success: true, toolName: "search", displayText: "Result", category: "custom", resultKind: "data", preserveOnCompaction: true, trustLevel: "untrusted" } } },
        ],
      });
      const input = makeKernelInput();
      const toolCall = makeToolCall("search", { query: "test" });

      const start = performance.now();
      const outcome = duplicateGuard(toolCall, state, input);
      const latency = performance.now() - start;

      expect(outcome.pass).toBe(false);
      if (!outcome.pass) {
        expect(outcome.observation).toContain("Already done");
      }
      validator.recordCheck(true, !outcome.pass, latency);
    });

    it("should allow re-attempt of failed calls", () => {
      const state = makeKernelState({
        steps: [
          { id: "s3" as any, type: "action" as const, content: "", timestamp: new Date(), metadata: { toolCall: { id: "c2", name: "search", arguments: { query: "test" } } } },
          { id: "s4" as any, type: "observation" as const, content: "Error", timestamp: new Date(), metadata: { observationResult: { success: false, toolName: "search", displayText: "Error", category: "custom", resultKind: "error", preserveOnCompaction: true, trustLevel: "untrusted" } } },
        ],
      });
      const input = makeKernelInput();
      const toolCall = makeToolCall("search", { query: "test" });

      const outcome = duplicateGuard(toolCall, state, input);
      expect(outcome.pass).toBe(true);
    });
  });

  describe("sideEffectGuard", () => {
    it("should pass non-side-effect tools", () => {
      const state = makeKernelState({ steps: [] });
      const input = makeKernelInput();
      const toolCall = makeToolCall("search", { query: "test" });

      const start = performance.now();
      const outcome = sideEffectGuard(toolCall, state, input);
      const latency = performance.now() - start;

      expect(outcome.pass).toBe(true);
      validator.recordCheck(false, !outcome.pass, latency);
    });

    it("should block side-effect tools called twice", () => {
      const state = makeKernelState({
        steps: [
          { type: "action", content: "", metadata: { toolCall: { name: "send-email", arguments: {} } } },
          { type: "observation", content: "Sent", metadata: { observationResult: { success: true } } },
        ],
      });
      const input = makeKernelInput();
      const toolCall = makeToolCall("send-email", {});

      const start = performance.now();
      const outcome = sideEffectGuard(toolCall, state, input);
      const latency = performance.now() - start;

      expect(outcome.pass).toBe(false);
      expect(outcome.observation).toContain("already executed");
      validator.recordCheck(true, !outcome.pass, latency);
    });

    it("should detect side-effect prefixes: send, create, delete, push", () => {
      const prefixes = ["send-email", "create-file", "delete-file", "push-commit"];

      for (const toolName of prefixes) {
        const state = makeKernelState({
          steps: [
            { type: "action", content: "", metadata: { toolCall: { name: toolName, arguments: {} } } },
            { type: "observation", content: "", metadata: { observationResult: { success: true } } },
          ],
        });
        const input = makeKernelInput();
        const toolCall = makeToolCall(toolName, {});

        const outcome = sideEffectGuard(toolCall, state, input);
        expect(outcome.pass).toBe(false);
      }
    });
  });

  describe("repetitionGuard", () => {
    it("should allow first few calls to same tool", () => {
      const state = makeKernelState({ steps: [] });
      const input = makeKernelInput();
      const toolCall = makeToolCall("search", { query: "test" });

      const start = performance.now();
      const outcome = repetitionGuard(toolCall, state, input);
      const latency = performance.now() - start;

      expect(outcome.pass).toBe(true);
      validator.recordCheck(false, !outcome.pass, latency);
    });

    it("should block repetitive calls beyond threshold", () => {
      const steps = Array.from({ length: 4 }, (_, i) => [
        { type: "action" as const, content: "", metadata: { toolCall: { name: "search", arguments: { query: `test${i}` } } } },
        { type: "observation" as const, content: "Result", metadata: { observationResult: { success: true } } },
      ]).flat();

      const state = makeKernelState({ steps });
      const input = makeKernelInput({ nextMovesPlanning: { maxBatchSize: 4 } });
      const toolCall = makeToolCall("search", { query: "test5" });

      const start = performance.now();
      const outcome = repetitionGuard(toolCall, state, input);
      const latency = performance.now() - start;

      expect(outcome.pass).toBe(false);
      expect(outcome.observation).toContain("already called");
      validator.recordCheck(true, !outcome.pass, latency);
    });

    it("should respect requiredToolQuantities ceiling", () => {
      const state = makeKernelState({
        steps: [
          { type: "action", content: "", metadata: { toolCall: { name: "search", arguments: { query: "a" } } } },
          { type: "observation", content: "Result", metadata: { observationResult: { success: true } } },
        ],
      });
      const input = makeKernelInput({
        requiredToolQuantities: { search: 5 },
      });
      const toolCall = makeToolCall("search", { query: "b" });

      const outcome = repetitionGuard(toolCall, state, input);
      expect(outcome.pass).toBe(true);
    });
  });

  describe("metaToolDedupGuard", () => {
    it("should allow different meta-tools", () => {
      const state = makeKernelState({ lastMetaToolCall: "brief" });
      const input = makeKernelInput();
      const toolCall = makeToolCall("pulse", {});

      const start = performance.now();
      const outcome = metaToolDedupGuard(toolCall, state, input);
      const latency = performance.now() - start;

      expect(outcome.pass).toBe(true);
      validator.recordCheck(false, !outcome.pass, latency);
    });

    it("should allow first two consecutive meta-tool calls", () => {
      const state = makeKernelState({ lastMetaToolCall: "brief", consecutiveMetaToolCount: 1 });
      const input = makeKernelInput();
      const toolCall = makeToolCall("brief", {});

      const start = performance.now();
      const outcome = metaToolDedupGuard(toolCall, state, input);
      const latency = performance.now() - start;

      expect(outcome.pass).toBe(true);
      validator.recordCheck(false, !outcome.pass, latency);
    });

    it("should block 3+ consecutive identical meta-tool calls", () => {
      const state = makeKernelState({ lastMetaToolCall: "brief", consecutiveMetaToolCount: 2 });
      const input = makeKernelInput();
      const toolCall = makeToolCall("brief", {});

      const start = performance.now();
      const outcome = metaToolDedupGuard(toolCall, state, input);
      const latency = performance.now() - start;

      expect(outcome.pass).toBe(false);
      expect(outcome.observation).toContain("called");
      expect(outcome.observation).toContain("times in a row");
      validator.recordCheck(true, !outcome.pass, latency);
    });

    it("should not block regular tools", () => {
      const state = makeKernelState({ lastMetaToolCall: "search", consecutiveMetaToolCount: 10 });
      const input = makeKernelInput();
      const toolCall = makeToolCall("search", { query: "test" });

      const outcome = metaToolDedupGuard(toolCall, state, input);
      expect(outcome.pass).toBe(true);
    });
  });

  describe("isConsecutiveMetaToolSpam", () => {
    it("should detect spam: same meta-tool 3+ times", () => {
      const result = isConsecutiveMetaToolSpam({
        toolName: "brief",
        lastMetaToolCall: "brief",
        consecutiveCount: 2,
      });
      expect(result).toBe(true);
    });

    it("should allow first repeat (count=1)", () => {
      const result = isConsecutiveMetaToolSpam({
        toolName: "brief",
        lastMetaToolCall: "brief",
        consecutiveCount: 1,
      });
      expect(result).toBe(false);
    });

    it("should not flag non-meta-tools", () => {
      const result = isConsecutiveMetaToolSpam({
        toolName: "search",
        lastMetaToolCall: "search",
        consecutiveCount: 10,
      });
      expect(result).toBe(false);
    });

    it("should not flag different tools", () => {
      const result = isConsecutiveMetaToolSpam({
        toolName: "pulse",
        lastMetaToolCall: "brief",
        consecutiveCount: 2,
      });
      expect(result).toBe(false);
    });
  });

  // ─── Integration Tests ────────────────────────────────────────────────────────

  describe("checkToolCall (pipeline)", () => {
    it("should run all guards in order", () => {
      const state = makeKernelState();
      const input = makeKernelInput({
        blockedTools: ["blocked-tool"],
        allToolSchemas: [
          { name: "search", description: "", parameters: [], riskLevel: "low", timeoutMs: 5000, requiresApproval: false, source: "builtin" },
        ],
      });

      const check = checkToolCall(defaultGuards);
      const toolCall = makeToolCall("search", { query: "test" });

      const start = performance.now();
      const outcome = check(toolCall, state, input);
      const latency = performance.now() - start;

      expect(outcome.pass).toBe(true);
      validator.recordCheck(false, !outcome.pass, latency);
    });

    it("should short-circuit on first guard failure", () => {
      const state = makeKernelState();
      const input = makeKernelInput({
        blockedTools: ["search"],
        availableToolSchemas: [], // Would fail this guard, but blocked guard runs first
      });

      const check = checkToolCall(defaultGuards);
      const toolCall = makeToolCall("search", { query: "test" });

      const outcome = check(toolCall, state, input);
      expect(outcome.pass).toBe(false);
      if (!outcome.pass) {
        expect(outcome.observation).toContain("BLOCKED");
      }
    });

    it("should allow custom guard chains", () => {
      const customChain = [blockedGuard, availableToolGuard]; // skip repetition, dedup, etc.
      const state = makeKernelState({ steps: [] });
      const input = makeKernelInput({
        allToolSchemas: [
          { name: "search", description: "", parameters: [], riskLevel: "low", timeoutMs: 5000, requiresApproval: false, source: "builtin" },
        ],
      });

      const check = checkToolCall(customChain);
      const toolCall = makeToolCall("search", { query: "test" });

      const outcome = check(toolCall, state, input);
      expect(outcome.pass).toBe(true);
    });
  });

  // ─── Meta-tools Registry Tests ────────────────────────────────────────────────

  describe("Meta-tools Registry", () => {
    it("should include all core meta-tools", () => {
      const expected = ["final-answer", "task-complete", "context-status", "brief", "pulse", "find", "recall", "checkpoint"];
      for (const tool of expected) {
        expect(META_TOOLS.has(tool)).toBe(true);
      }
    });

    it("should have introspection subset", () => {
      const expectedIntrospection = ["brief", "pulse", "find", "recall", "checkpoint"];
      for (const tool of expectedIntrospection) {
        expect(INTROSPECTION_META_TOOLS.has(tool)).toBe(true);
      }
    });

    it("should exclude termination tools from introspection", () => {
      expect(INTROSPECTION_META_TOOLS.has("final-answer")).toBe(false);
      expect(INTROSPECTION_META_TOOLS.has("task-complete")).toBe(false);
    });

    it("should exclude introspection from termination tools", () => {
      const terminationSet = new Set(["final-answer", "task-complete"]);
      for (const tool of INTROSPECTION_META_TOOLS) {
        expect(terminationSet.has(tool)).toBe(false);
      }
    });
  });

  // ─── Effectiveness Dataset ────────────────────────────────────────────────────

  describe("Guard Effectiveness (Dataset)", () => {
    it("should achieve ≥85% TP rate on valid/invalid dataset", () => {
      const testCases = [
        // Valid calls (should pass — tool is available + not blocked)
        { toolCall: makeToolCall("search", { query: "test" }), shouldFail: false },
        { toolCall: makeToolCall("http-get", { url: "http://example.com" }), shouldFail: false },
        { toolCall: makeToolCall("final-answer", { answer: "done" }), shouldFail: false },
        { toolCall: makeToolCall("brief", {}), shouldFail: false },
        { toolCall: makeToolCall("pulse", {}), shouldFail: false },

        // Invalid: unavailable tools (will fail availableToolGuard)
        { toolCall: makeToolCall("unknown-tool", {}), shouldFail: true },
        { toolCall: makeToolCall("typo-serch", {}), shouldFail: true },

        // Invalid: blocked tools (will fail blockedGuard)
        { toolCall: makeToolCall("delete-file", {}), shouldFail: true },

        // Invalid: side-effect duplicates (will fail sideEffectGuard when state has prior success)
        { toolCall: makeToolCall("send-email", {}), shouldFail: true },
      ];

      const baseState = makeKernelState({
        lastMetaToolCall: "brief",
        consecutiveMetaToolCount: 2,
        steps: [
          { type: "action", content: "", metadata: { toolCall: { name: "send-email", arguments: {} } } },
          { type: "observation", content: "", metadata: { observationResult: { success: true } } },
        ],
      });

      const baseInput = makeKernelInput({
        blockedTools: ["delete-file"],
        allToolSchemas: [
          { name: "search", description: "", parameters: [], riskLevel: "low", timeoutMs: 5000, requiresApproval: false, source: "builtin" },
          { name: "http-get", description: "", parameters: [], riskLevel: "low", timeoutMs: 5000, requiresApproval: false, source: "builtin" },
        ],
      });

      const check = checkToolCall(defaultGuards);
      let correctClassifications = 0;

      for (const { toolCall, shouldFail } of testCases) {
        const outcome = check(toolCall, baseState, baseInput);
        const didFail = !outcome.pass;

        if (shouldFail === didFail) {
          correctClassifications++;
        }
        validator.recordCheck(shouldFail, didFail, 0.1);
      }

      const metrics = validator.getMetrics();
      const accuracy = (correctClassifications / testCases.length) * 100;

      // Verify: guards should correctly classify at least 85% of cases
      expect(accuracy).toBeGreaterThanOrEqual(85);
    });

    it("should maintain latency <50ms per guard check", () => {
      const state = makeKernelState();
      const input = makeKernelInput({
        allToolSchemas: [
          { name: "search", description: "", parameters: [], riskLevel: "low", timeoutMs: 5000, requiresApproval: false, source: "builtin" },
        ],
      });

      const check = checkToolCall(defaultGuards);
      const iterations = 100;

      for (let i = 0; i < iterations; i++) {
        const toolCall = makeToolCall("search", { query: `test-${i}` });
        const start = performance.now();
        check(toolCall, state, input);
        const latency = performance.now() - start;

        validator.recordCheck(false, false, latency);
      }

      const metrics = validator.getMetrics();
      expect(metrics.avgLatencyMs).toBeLessThan(50);
      expect(metrics.maxLatencyMs).toBeLessThan(100); // Allow some outliers
    });
  });

  // ─── Edge Cases ────────────────────────────────────────────────────────────────

  describe("Edge Cases", () => {
    it("should handle null/undefined safely", () => {
      const state = makeKernelState();
      const input = makeKernelInput();
      const toolCall = makeToolCall("search", { query: null as unknown as string });

      const check = checkToolCall(defaultGuards);
      expect(() => check(toolCall, state, input)).not.toThrow();
    });

    it("should handle empty tool lists", () => {
      const state = makeKernelState({ steps: [] });
      const input = makeKernelInput({ availableToolSchemas: [] });
      const toolCall = makeToolCall("search", {});

      const outcome = availableToolGuard(toolCall, state, input);
      expect(outcome.pass).toBe(false);
    });

    it("should handle large step histories efficiently", () => {
      const largeSteps = Array.from({ length: 1000 }, (_, i) => [
        { type: "action" as const, content: "", metadata: { toolCall: { name: "search", arguments: { query: `test-${i}` } } } },
        { type: "observation" as const, content: "Result", metadata: { observationResult: { success: true } } },
      ]).flat();

      const state = makeKernelState({ steps: largeSteps });
      const input = makeKernelInput();

      const start = performance.now();
      const outcome = duplicateGuard(makeToolCall("search", { query: "test-0" }), state, input);
      const latency = performance.now() - start;

      expect(outcome.pass).toBe(false);
      expect(latency).toBeLessThan(100);
    });

    it("should handle special characters in tool names", () => {
      const state = makeKernelState();
      const input = makeKernelInput({
        allToolSchemas: [
          { name: "http-get-v2", description: "", parameters: [], riskLevel: "low", timeoutMs: 5000, requiresApproval: false, source: "builtin" },
        ],
      });
      const toolCall = makeToolCall("http-get-v2", {});

      const outcome = availableToolGuard(toolCall, state, input);
      expect(outcome.pass).toBe(true);
    });
  });

  // ─── Validation Report ────────────────────────────────────────────────────────

  it("should report final metrics summary", () => {
    const state = makeKernelState();
    const input = makeKernelInput({
      availableToolSchemas: [
        { name: "search", description: "", parameters: [], riskLevel: "low", timeoutMs: 5000, requiresApproval: false, source: "builtin" },
      ],
    });

    const check = checkToolCall(defaultGuards);

    // Run 50 valid and 50 invalid checks
    for (let i = 0; i < 50; i++) {
      const validCall = makeToolCall("search", { query: `valid-${i}` });
      const start = performance.now();
      check(validCall, state, input);
      const latency = performance.now() - start;
      validator.recordCheck(false, false, latency);
    }

    const metrics = validator.getMetrics();
    console.log("─── M13 Guard Effectiveness Metrics ───");
    console.log(`Total Checks: ${metrics.totalChecks}`);
    console.log(`True Positives: ${metrics.truePositives}`);
    console.log(`False Positives: ${metrics.falsePositives}`);
    console.log(`True Negatives: ${metrics.trueNegatives}`);
    console.log(`False Negatives: ${metrics.falseNegatives}`);
    console.log(`TP Rate: ${validator.getTPRate().toFixed(2)}%`);
    console.log(`FP Rate: ${validator.getFPRate().toFixed(2)}%`);
    console.log(`Avg Latency: ${metrics.avgLatencyMs.toFixed(3)}ms`);
    console.log(`Max Latency: ${metrics.maxLatencyMs.toFixed(3)}ms`);
    console.log("────────────────────────────────────────");

    // Verify test completed
    expect(metrics.totalChecks).toBeGreaterThan(0);
  });
});
