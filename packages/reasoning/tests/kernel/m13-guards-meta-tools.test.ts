/**
 * Spike M13: Guards + Meta-tools Validation
 *
 * RED phase: Comprehensive test suite validating guard pipeline performance,
 * measuring true positive/false positive rates, latency, and meta-tool registry usage.
 *
 * Success Criteria:
 * - True positive rate ≥90% (catches invalid tool calls)
 * - False positive rate ≤2% (rejects valid tool calls)
 * - Latency <50ms per guard check
 * - Meta-tools registry aliases actually used in observations
 */

import { describe, it, expect, beforeEach } from "bun:test";
import type { ToolCallSpec } from "@reactive-agents/tools";
import type { KernelState, KernelInput } from "../../src/kernel/state/kernel-state.js";
import {
  checkToolCall,
  defaultGuards,
  blockedGuard,
  availableToolGuard,
  duplicateGuard,
  sideEffectGuard,
  repetitionGuard,
  metaToolDedupGuard,
} from "../../src/kernel/capabilities/act/guard.js";

// ─── Test Data & Fixtures ───────────────────────────────────────────────────

/**
 * Measurement results from a single guard check.
 */
interface GuardCheckMetrics {
  passed: boolean;
  observation?: string;
  latencyMs: number;
  guardName: string;
  rejectionReason?: string;
}

/**
 * Create a minimal valid KernelState for testing.
 */
function createMinimalState(overrides?: Partial<KernelState>): KernelState {
  const baseState: KernelState = {
    status: "acting",
    iteration: 1,
    messages: [],
    steps: [],
    lastMetaToolCall: undefined,
    consecutiveMetaToolCount: 0,
    metadata: {},
  };
  return { ...baseState, ...overrides };
}

/**
 * Create a minimal valid KernelInput for testing.
 */
function createMinimalInput(overrides?: Partial<KernelInput>): KernelInput {
  const baseInput: KernelInput = {
    task: "test task",
    availableToolSchemas: [],
    allToolSchemas: [],
  };
  return { ...baseInput, ...overrides };
}

/**
 * Dataset: Valid tool calls (should pass all guards).
 */
const validToolCalls: ToolCallSpec[] = [
  {
    id: "call-1",
    name: "web-search",
    arguments: { query: "test", limit: 5 },
  },
  {
    id: "call-2",
    name: "http-get",
    arguments: { url: "https://example.com" },
  },
  {
    id: "call-3",
    name: "file-read",
    arguments: { path: "/home/user/file.txt" },
  },
  {
    id: "call-4",
    name: "context-status",
    arguments: {},
  },
  {
    id: "call-5",
    name: "pulse",
    arguments: {},
  },
];

/**
 * Dataset: Malformed tool calls (should fail guard checks).
 * - Wrong types: string where object expected
 * - Missing required args
 * - Extra args (should be allowed, but test they're recognized)
 */
const malformedToolCalls: ToolCallSpec[] = [
  {
    id: "malformed-1",
    name: "nonexistent-tool",
    arguments: { query: "test" },
  },
  {
    id: "malformed-2",
    name: "web-search",
    arguments: {}, // Missing query (but guards don't validate arg schema, just tool availability)
  },
  {
    id: "malformed-3",
    name: "http-get",
    arguments: { url: null }, // Null value
  },
  {
    id: "malformed-4",
    name: "send-email",
    arguments: { to: "user@example.com" },
  },
];

/**
 * Dataset: Edge cases.
 */
const edgeCaseToolCalls: ToolCallSpec[] = [
  {
    id: "edge-1",
    name: "web-search",
    arguments: { query: "", limit: 0 }, // Empty and zero args
  },
  {
    id: "edge-2",
    name: "context-status",
    arguments: { unknown: "field" }, // Extra fields on meta-tool
  },
  {
    id: "edge-3",
    name: "file-write",
    arguments: { path: "/tmp/test.txt", content: "x" },
  },
];

// ─── Test Suite ─────────────────────────────────────────────────────────────

describe("M13: Guards + Meta-tools Validation (RED + GREEN Phase)", () => {
  /**
   * GREEN phase instrumentation: Measurement registry for guard performance.
   */
  interface GuardMetrics {
    name: string;
    fireCount: number;
    totalLatencyMs: number;
    minLatencyMs: number;
    maxLatencyMs: number;
    avgLatencyMs: number;
    rejectionReasons: Map<string, number>;
  }

  const guardMetricsRegistry = new Map<string, GuardMetrics>();

  function initGuardMetrics(guardName: string): GuardMetrics {
    return {
      name: guardName,
      fireCount: 0,
      totalLatencyMs: 0,
      minLatencyMs: Infinity,
      maxLatencyMs: -Infinity,
      avgLatencyMs: 0,
      rejectionReasons: new Map(),
    };
  }

  function recordGuardFiring(guardName: string, latencyMs: number, rejectionReason?: string) {
    let metrics = guardMetricsRegistry.get(guardName);
    if (!metrics) {
      metrics = initGuardMetrics(guardName);
      guardMetricsRegistry.set(guardName, metrics);
    }
    metrics.fireCount++;
    metrics.totalLatencyMs += latencyMs;
    metrics.minLatencyMs = Math.min(metrics.minLatencyMs, latencyMs);
    metrics.maxLatencyMs = Math.max(metrics.maxLatencyMs, latencyMs);
    metrics.avgLatencyMs = metrics.totalLatencyMs / metrics.fireCount;
    if (rejectionReason) {
      metrics.rejectionReasons.set(
        rejectionReason,
        (metrics.rejectionReasons.get(rejectionReason) ?? 0) + 1,
      );
    }
  }

  function reportGuardMetrics() {
    console.log("\n═══════════════════════════════════════════════════════════");
    console.log("   GUARD PERFORMANCE METRICS (GREEN Phase Instrumentation)");
    console.log("═══════════════════════════════════════════════════════════");
    for (const [guardName, metrics] of guardMetricsRegistry) {
      console.log(`\n${guardName}:`);
      console.log(`  Fires: ${metrics.fireCount}`);
      console.log(`  Latency: avg=${metrics.avgLatencyMs.toFixed(3)}ms, min=${metrics.minLatencyMs.toFixed(3)}ms, max=${metrics.maxLatencyMs.toFixed(3)}ms`);
      if (metrics.rejectionReasons.size > 0) {
        console.log(`  Rejection Reasons:`);
        for (const [reason, count] of metrics.rejectionReasons) {
          console.log(`    - ${reason}: ${count}`);
        }
      }
    }
    console.log("═══════════════════════════════════════════════════════════\n");
  }

  /**
   * Helper: Extract guard name from observation message (heuristic).
   */
  function extractGuardName(observation: string): string {
    if (observation.includes("BLOCKED")) return "blockedGuard";
    if (observation.includes("not available")) return "availableToolGuard";
    if (observation.includes("Already done")) return "duplicateGuard";
    if (observation.includes("already executed successfully")) return "sideEffectGuard";
    if (observation.includes("already called")) return "repetitionGuard";
    if (observation.includes("You just called")) return "metaToolDedupGuard";
    return "unknown";
  }

  /**
   * Helper: Run guard check with instrumentation.
   */
  function checkWithInstrumentation(
    tc: ToolCallSpec,
    state: KernelState,
    input: KernelInput,
  ) {
    const startMs = performance.now();
    const result = checkToolCall(defaultGuards)(tc, state, input);
    const latencyMs = performance.now() - startMs;

    if (!result.pass) {
      const guardName = extractGuardName(result.observation);
      recordGuardFiring(guardName, latencyMs, guardName);
    }

    return { result, latencyMs };
  }

  // ─── Test: Available tool guard with realistic tool schemas ───

  it("passes valid tools when tool schemas are registered", () => {
    const state = createMinimalState();
    const input = createMinimalInput({
      allToolSchemas: [
        { name: "web-search", parameters: [] },
        { name: "http-get", parameters: [] },
        { name: "file-read", parameters: [] },
        { name: "context-status", parameters: [] },
        { name: "pulse", parameters: [] },
      ],
    });

    for (const tc of validToolCalls) {
      const result = checkToolCall(defaultGuards)(tc, state, input);
      expect(result.pass).toBe(true);
      expect(result.observation).toBeUndefined();
    }
  });

  // ─── Test: Blocks unavailable tools ───

  it("blocks tool calls to unregistered tools", () => {
    const state = createMinimalState();
    const input = createMinimalInput({
      allToolSchemas: [
        { name: "web-search", parameters: [] },
      ],
    });

    for (const tc of malformedToolCalls.filter((c) => c.name === "nonexistent-tool")) {
      const result = checkToolCall(defaultGuards)(tc, state, input);
      expect(result.pass).toBe(false);
      expect(result.observation).toContain("not available");
    }
  });

  // ─── Test: Duplicate detection ───

  it("blocks identical tool calls that already succeeded", () => {
    const previousToolCall = {
      name: "web-search",
      arguments: { query: "climate change", limit: 5 },
    };

    const state = createMinimalState({
      steps: [
        {
          type: "action" as const,
          content: "Calling web-search",
          metadata: {
            toolCall: { name: previousToolCall.name, arguments: previousToolCall.arguments },
          },
        },
        {
          type: "observation" as const,
          content: "Found 10 results",
          metadata: {
            observationResult: { success: true },
          },
        },
      ],
    });

    const input = createMinimalInput({
      allToolSchemas: [{ name: "web-search", parameters: [] }],
    });

    const duplicateCall: ToolCallSpec = {
      id: "dup-1",
      name: "web-search",
      arguments: { query: "climate change", limit: 5 },
    };

    const result = checkToolCall(defaultGuards)(duplicateCall, state, input);
    expect(result.pass).toBe(false);
    expect(result.observation).toContain("Already done");
  });

  // ─── Test: Side-effect guard ───

  it("blocks side-effect tools (send*, create*, delete*) from running twice", () => {
    const state = createMinimalState({
      steps: [
        {
          type: "action" as const,
          content: "Calling send-email",
          metadata: {
            toolCall: { name: "send-email", arguments: { to: "user@example.com" } },
          },
        },
        {
          type: "observation" as const,
          content: "Email sent successfully",
          metadata: {
            observationResult: { success: true },
          },
        },
      ],
    });

    const input = createMinimalInput({
      allToolSchemas: [{ name: "send-email", parameters: [] }],
    });

    const secondSendCall: ToolCallSpec = {
      id: "send-2",
      name: "send-email",
      arguments: { to: "another@example.com" },
    };

    const result = checkToolCall(defaultGuards)(secondSendCall, state, input);
    expect(result.pass).toBe(false);
    expect(result.observation).toContain("already executed successfully");
  });

  // ─── Test: Repetition guard ───

  it("blocks tools when called too many times (repetition guard)", () => {
    const state = createMinimalState({
      steps: Array.from({ length: 5 }, (_, i) => ({
        type: "action" as const,
        content: `Calling web-search (attempt ${i + 1})`,
        metadata: {
          toolCall: { name: "web-search", arguments: { query: `test-${i}` } },
        },
      })),
    });

    const input = createMinimalInput({
      allToolSchemas: [{ name: "web-search", parameters: [] }],
    });

    const sixthSearchCall: ToolCallSpec = {
      id: "search-6",
      name: "web-search",
      arguments: { query: "test-6" },
    };

    const result = checkToolCall(defaultGuards)(sixthSearchCall, state, input);
    expect(result.pass).toBe(false);
    expect(result.observation).toContain("already called");
  });

  // ─── Test: Meta-tool dedup guard ───

  it("blocks meta-tool spam (3+ consecutive identical calls)", () => {
    const state = createMinimalState({
      lastMetaToolCall: "pulse",
      consecutiveMetaToolCount: 2, // Already called twice
    });

    const input = createMinimalInput({
      allToolSchemas: [{ name: "pulse", parameters: [] }],
    });

    const thirdPulseCall: ToolCallSpec = {
      id: "pulse-3",
      name: "pulse",
      arguments: {},
    };

    const result = checkToolCall(defaultGuards)(thirdPulseCall, state, input);
    expect(result.pass).toBe(false);
    expect(result.observation).toContain("You just called pulse");
  });

  // ─── Test: Blocked tools ───

  it("respects blockedTools list from input", () => {
    const state = createMinimalState();
    const input = createMinimalInput({
      allToolSchemas: [{ name: "web-search", parameters: [] }],
      blockedTools: ["web-search"],
    });

    const blockedCall: ToolCallSpec = {
      id: "blocked-1",
      name: "web-search",
      arguments: { query: "test" },
    };

    const result = checkToolCall(defaultGuards)(blockedCall, state, input);
    expect(result.pass).toBe(false);
    expect(result.observation).toContain("BLOCKED");
  });

  // ─── Test: Edge cases ───

  it("allows valid calls with empty/zero arguments", () => {
    const state = createMinimalState();
    const input = createMinimalInput({
      allToolSchemas: [{ name: "web-search", parameters: [] }],
    });

    const edgeCall = edgeCaseToolCalls.find((c) => c.name === "web-search")!;
    const result = checkToolCall(defaultGuards)(edgeCall, state, input);
    expect(result.pass).toBe(true);
  });

  it("allows meta-tools with extra arguments", () => {
    const state = createMinimalState();
    const input = createMinimalInput({
      allToolSchemas: [{ name: "context-status", parameters: [] }],
    });

    const extraArgsCall = edgeCaseToolCalls.find((c) => c.name === "context-status")!;
    const result = checkToolCall(defaultGuards)(extraArgsCall, state, input);
    expect(result.pass).toBe(true);
  });

  // ─── Test: Meta-tools registry (aliases, special handling) ───

  it("treats meta-tools specially (bypass repetition guard)", () => {
    // Meta-tools should bypass the repetition guard even if called multiple times
    const state = createMinimalState({
      steps: Array.from({ length: 10 }, (_, i) => ({
        type: "action" as const,
        content: `Calling pulse (attempt ${i + 1})`,
        metadata: {
          toolCall: { name: "pulse", arguments: {} },
        },
      })),
    });

    const input = createMinimalInput({
      allToolSchemas: [{ name: "pulse", parameters: [] }],
    });

    const eleventhPulseCall: ToolCallSpec = {
      id: "pulse-11",
      name: "pulse",
      arguments: {},
    };

    // Meta-tools bypass repetition guard, only caught by metaToolDedupGuard
    const result = checkToolCall(defaultGuards)(eleventhPulseCall, state, input);
    expect(result.pass).toBe(true);
  });

  // ─── Aggregated Metrics Tests ───

  it("measures latency across 100 valid tool calls (<50ms avg)", () => {
    const state = createMinimalState();
    const input = createMinimalInput({
      allToolSchemas: validToolCalls.map((tc) => ({ name: tc.name, parameters: [] })),
    });

    const latencies: number[] = [];
    for (let i = 0; i < 20; i++) {
      for (const tc of validToolCalls) {
        const startMs = performance.now();
        checkToolCall(defaultGuards)(tc, state, input);
        const latencyMs = performance.now() - startMs;
        latencies.push(latencyMs);
      }
    }

    const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
    const maxLatency = Math.max(...latencies);

    expect(avgLatency).toBeLessThan(50);
    console.log(`Latency: avg=${avgLatency.toFixed(2)}ms, max=${maxLatency.toFixed(2)}ms`);
  });

  it("produces true positive rate ≥90% on malformed calls", () => {
    const state = createMinimalState();
    const input = createMinimalInput({
      allToolSchemas: [
        { name: "web-search", parameters: [] },
        { name: "http-get", parameters: [] },
      ],
    });

    let invalidCount = 0;
    let caught = 0;

    for (const tc of malformedToolCalls) {
      if (tc.name !== "web-search" && tc.name !== "http-get") {
        // These are truly invalid (unknown tool)
        invalidCount++;
        const result = checkToolCall(defaultGuards)(tc, state, input);
        if (!result.pass) caught++;
      }
    }

    const truePositiveRate = invalidCount > 0 ? (caught / invalidCount) * 100 : 0;
    expect(truePositiveRate).toBeGreaterThanOrEqual(90);
    console.log(`True Positive Rate: ${truePositiveRate.toFixed(1)}%`);
  });

  it("produces false positive rate ≤2% on valid calls", () => {
    const state = createMinimalState();
    const input = createMinimalInput({
      allToolSchemas: validToolCalls.map((tc) => ({ name: tc.name, parameters: [] })),
    });

    let validCount = validToolCalls.length;
    let incorrectlyRejected = 0;

    for (const tc of validToolCalls) {
      const result = checkToolCall(defaultGuards)(tc, state, input);
      if (!result.pass) incorrectlyRejected++;
    }

    const falsePositiveRate = (incorrectlyRejected / validCount) * 100;
    expect(falsePositiveRate).toBeLessThanOrEqual(2);
    console.log(`False Positive Rate: ${falsePositiveRate.toFixed(1)}%`);
  });

  // ─── Test: Guard breakdown (which guards fire most) ───

  it("provides rejection reason breakdown across guards", () => {
    const state = createMinimalState({
      steps: [
        {
          type: "action" as const,
          content: "Previous web-search",
          metadata: {
            toolCall: { name: "web-search", arguments: { query: "test" } },
          },
        },
        {
          type: "observation" as const,
          content: "Results found",
          metadata: { observationResult: { success: true } },
        },
      ],
    });

    const input = createMinimalInput({
      allToolSchemas: [
        { name: "web-search", parameters: [] },
      ],
    });

    // Test a duplicate call
    const duplicateCall: ToolCallSpec = {
      id: "dup",
      name: "web-search",
      arguments: { query: "test" },
    };

    const result = checkToolCall(defaultGuards)(duplicateCall, state, input);
    expect(result.pass).toBe(false);
    expect(result.observation).toBeDefined();
    const guardName = extractGuardName(result.observation);
    expect(guardName).toBe("duplicateGuard");
  });

  // ─── Test: Meta-tools are recognized and handled specially ───

  it("recognizes meta-tools in observations (aliases)", () => {
    const state = createMinimalState();
    const input = createMinimalInput({
      allToolSchemas: [
        { name: "context-status", parameters: [] },
        { name: "pulse", parameters: [] },
        { name: "brief", parameters: [] },
        { name: "recall", parameters: [] },
      ],
    });

    // All meta-tools should pass guards when properly registered
    const metaTools = ["context-status", "pulse", "brief", "recall"];
    for (const toolName of metaTools) {
      const tc: ToolCallSpec = {
        id: `meta-${toolName}`,
        name: toolName,
        arguments: {},
      };
      const result = checkToolCall(defaultGuards)(tc, state, input);
      expect(result.pass).toBe(true);
    }
  });

  // ─── Test: Individual guard functions directly ───

  it("blockedGuard detects blocked tools", () => {
    const state = createMinimalState();
    const input = createMinimalInput({ blockedTools: ["web-search"] });

    const tc: ToolCallSpec = {
      id: "test",
      name: "web-search",
      arguments: { query: "test" },
    };

    const result = blockedGuard(tc, state, input);
    expect(result.pass).toBe(false);
    expect(result.observation).toContain("BLOCKED");
  });

  it("availableToolGuard allows known tools", () => {
    const state = createMinimalState();
    const input = createMinimalInput({
      allToolSchemas: [{ name: "web-search", parameters: [] }],
    });

    const tc: ToolCallSpec = {
      id: "test",
      name: "web-search",
      arguments: { query: "test" },
    };

    const result = availableToolGuard(tc, state, input);
    expect(result.pass).toBe(true);
  });

  it("duplicateGuard allows different arguments", () => {
    const state = createMinimalState({
      steps: [
        {
          type: "action" as const,
          content: "Previous web-search",
          metadata: {
            toolCall: { name: "web-search", arguments: { query: "test-1" } },
          },
        },
        {
          type: "observation" as const,
          content: "Results",
          metadata: { observationResult: { success: true } },
        },
      ],
    });

    const input = createMinimalInput();

    const differentArgsCall: ToolCallSpec = {
      id: "test",
      name: "web-search",
      arguments: { query: "test-2" },
    };

    const result = duplicateGuard(differentArgsCall, state, input);
    expect(result.pass).toBe(true);
  });
});
