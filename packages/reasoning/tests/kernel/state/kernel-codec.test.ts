// File: tests/kernel/state/kernel-codec.test.ts
/**
 * Lossless KernelState codec (v0.12.0 durable execution, design spec
 * wiki/Architecture/Design-Specs/2026-06-10-durable-execution.md):
 *
 *   serializeKernelState(state): string   — JSON envelope w/ CODEC_VERSION
 *   deserializeKernelState(json): KernelState — exact data round-trip
 *
 * Invariants under test:
 *   1. Round-trip is LOSSLESS for all data fields, including ReadonlyMap
 *      (scratchpad), ReadonlySet (toolsUsed), Date (step timestamps), and
 *      every optional scalar field on KernelState.
 *   2. Non-serializable meta values (function / symbol / circular) are
 *      WARN-skipped, never crash, and the rest of meta round-trips.
 *   3. Envelope carries a CODEC_VERSION; a future (greater) version refuses
 *      to decode with a descriptive error; corrupt input throws descriptively.
 */
import { describe, it, expect } from "bun:test";
import {
  serializeKernelState,
  deserializeKernelState,
  KERNEL_CODEC_VERSION,
} from "../../../src/kernel/state/kernel-codec.js";
import type { KernelState } from "../../../src/kernel/state/kernel-state.js";
import type { ReasoningStep } from "../../../src/types/index.js";

const step = (id: string, type: ReasoningStep["type"], content: string, ts: number): ReasoningStep =>
  ({
    id: id as ReasoningStep["id"],
    type,
    content,
    timestamp: new Date(ts),
    metadata: { toolUsed: "web-search", confidence: 0.9, duration: 12 },
  });

/** Representative state exercising every data field on KernelState. */
const representativeState = (): KernelState => ({
  taskId: "task-42",
  strategy: "reactive",
  kernelType: "react",
  steps: [
    step("s1", "thought", "I should search.", 1717999990000),
    step("s2", "action", "web-search(q)", 1717999991000),
    step("s3", "observation", "found it", 1717999992000),
  ],
  toolsUsed: new Set(["web-search", "final-answer"]),
  scratchpad: new Map([
    ["obs:1", "compressed result one"],
    ["obs:2", "compressed result two"],
  ]),
  iteration: 4,
  tokens: 1234,
  inputTokens: 900,
  outputTokens: 334,
  cost: 0.0123,
  status: "acting",
  output: "partial deliverable",
  error: null,
  priorThought: "previous reasoning",
  llmCalls: 5,
  meta: {
    maxIterations: 10,
    requiredTools: ["web-search"],
    entropy: {
      taskDescription: "find the thing",
      modelId: "test-model",
      temperature: 0.2,
    },
    controllerDecisions: [{ decision: "continue", reason: "progressing" }],
  },
  controllerDecisionLog: ["continue: progressing"],
  messages: [
    { role: "user", content: "find the thing" },
    {
      role: "assistant",
      content: "searching",
      toolCalls: [{ id: "tc1", name: "web-search", arguments: { q: "thing" } }],
    },
    { role: "tool_result", toolCallId: "tc1", toolName: "web-search", content: "found", isError: false },
  ],
  pendingGuidance: { loopDetected: false, actReminder: "call final-answer" },
  consecutiveLowDeltaCount: 1,
  maxOutputTokensOverride: 64000,
  maxOutputTokensRecoveryCount: 1,
  readyToAnswerNudgeCount: 2,
  environmentContext: { currentDate: "2026-06-10", region: "us" },
  lastMetaToolCall: "pulse",
  consecutiveMetaToolCount: 1,
});

describe("kernel-codec — lossless round-trip", () => {
  it("serializes to a JSON string with a versioned envelope", () => {
    const json = serializeKernelState(representativeState());
    expect(typeof json).toBe("string");
    const envelope = JSON.parse(json) as { codecVersion: number };
    expect(envelope.codecVersion).toBe(KERNEL_CODEC_VERSION);
  });

  it("round-trips every data field deep-equal (Map, Set, Date included)", () => {
    const original = representativeState();
    const restored = deserializeKernelState(serializeKernelState(original));

    // Collection types restored as real Map/Set, not plain objects/arrays.
    expect(restored.scratchpad instanceof Map).toBe(true);
    expect(restored.toolsUsed instanceof Set).toBe(true);
    // Dates revived as real Date objects.
    expect(restored.steps[0]!.timestamp instanceof Date).toBe(true);

    expect(restored).toEqual(original);
  });

  it("round-trips a minimal fresh state (nulls, empty collections)", () => {
    const minimal: KernelState = {
      taskId: "",
      strategy: "reactive",
      kernelType: "react",
      steps: [],
      toolsUsed: new Set(),
      scratchpad: new Map(),
      iteration: 0,
      tokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      cost: 0,
      status: "thinking",
      output: null,
      error: null,
      llmCalls: 0,
      meta: {},
      controllerDecisionLog: [],
      messages: [],
    };
    const restored = deserializeKernelState(serializeKernelState(minimal));
    expect(restored).toEqual(minimal);
    expect(restored.scratchpad.size).toBe(0);
    expect(restored.toolsUsed.size).toBe(0);
  });
});

describe("kernel-codec — meta sanitization (WARN-skip, never crash)", () => {
  it("skips function values in meta with a warning, preserving the rest", () => {
    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(" "));
    try {
      const state = {
        ...representativeState(),
        meta: {
          maxIterations: 7,
          // Simulates a non-serializable runtime object smuggled into meta.
          badFn: () => "boom",
          badSym: Symbol("nope"),
          nested: { keep: "yes", alsoBad: () => 1 },
        },
      } as unknown as KernelState;

      const restored = deserializeKernelState(serializeKernelState(state));
      const meta = restored.meta as Record<string, unknown>;
      expect(meta["maxIterations"]).toBe(7);
      expect(meta["badFn"]).toBeUndefined();
      expect(meta["badSym"]).toBeUndefined();
      expect((meta["nested"] as Record<string, unknown>)["keep"]).toBe("yes");
      expect((meta["nested"] as Record<string, unknown>)["alsoBad"]).toBeUndefined();
      expect(warnings.some((w) => w.includes("kernel-codec"))).toBe(true);
    } finally {
      console.warn = origWarn;
    }
  });

  it("breaks circular references in meta without crashing", () => {
    const circular: Record<string, unknown> = { name: "loop" };
    circular["self"] = circular;
    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(" "));
    try {
      const state = {
        ...representativeState(),
        meta: { maxIterations: 3, circular },
      } as unknown as KernelState;

      const restored = deserializeKernelState(serializeKernelState(state));
      const meta = restored.meta as Record<string, unknown>;
      expect(meta["maxIterations"]).toBe(3);
      expect((meta["circular"] as Record<string, unknown>)["name"]).toBe("loop");
      expect(warnings.some((w) => w.includes("kernel-codec"))).toBe(true);
    } finally {
      console.warn = origWarn;
    }
  });
});

describe("kernel-codec — envelope versioning and corrupt input", () => {
  it("refuses to decode a NEWER codec version with a descriptive error", () => {
    const json = JSON.stringify({ codecVersion: KERNEL_CODEC_VERSION + 1, state: {} });
    expect(() => deserializeKernelState(json)).toThrow(/codec/i);
  });

  it("throws descriptively on a non-envelope payload", () => {
    expect(() => deserializeKernelState(JSON.stringify({ nope: true }))).toThrow(/envelope|codec/i);
  });

  it("throws descriptively on corrupt JSON", () => {
    expect(() => deserializeKernelState("{not json")).toThrow();
  });
});
