// Run: bun test packages/reasoning/tests/context/curator-performance.test.ts --timeout 15000
//
// PERFORMANCE — what S2.5 ContextCurator costs you per iteration.
//
// These tests are micro-benchmarks frozen as assertions. They answer the
// questions agent authors actually ask before turning the section on:
//
//   "How many extra tokens do I pay per observation?"
//   "Will this blow my context budget if the agent calls 100 tools?"
//   "Is the wrapping overhead bounded per observation, or unbounded?"
//   "Does the curator add measurable latency vs the no-section baseline?"
//
// The numbers below are *characteristic* — the assertions use ranges, not
// exact equality, so a small refactor of section formatting won't break the
// build but a regression that doubles the per-observation tax WILL.

import { describe, it, expect } from "bun:test";
import {
  defaultContextCurator,
  buildRecentObservationsSection,
  renderObservationForPrompt,
  CONTEXT_PROFILES,
  type GuidanceContext,
} from "../../src/index.js";
import type { KernelState } from "../../src/strategies/kernel/kernel-state.js";
import type { ReasoningStep } from "../../src/types/step.js";
import type { ObservationResult } from "../../src/types/observation.js";

// ── Fixtures ────────────────────────────────────────────────────────────────
const PAYLOAD = "result data line"; // 16 chars baseline payload

const obs = (
  toolName: string,
  trustLevel: "trusted" | "untrusted",
  text: string,
): ObservationResult => ({
  success: true,
  toolName,
  displayText: text,
  category: trustLevel === "trusted" ? "scratchpad" : "web-search",
  resultKind: trustLevel === "trusted" ? "side-effect" : "data",
  preserveOnCompaction: false,
  trustLevel,
  ...(trustLevel === "trusted" ? { trustJustification: "grandfather-phase-1" } : {}),
});

const step = (o: ObservationResult, i: number): ReasoningStep => ({
  id: `s${i}` as ReasoningStep["id"],
  type: "observation",
  content: o.displayText,
  timestamp: new Date(2026, 3, 25, 23, i, 0),
  metadata: { observationResult: o },
});

const stateOf = (steps: ReasoningStep[]): KernelState =>
  ({
    taskId: "perf",
    strategy: "reactive",
    kernelType: "react",
    steps,
    toolsUsed: new Set<string>(),
    scratchpad: new Map(),
    iteration: 0,
    tokens: 0,
    cost: 0,
    status: "thinking",
    output: null,
    error: null,
    llmCalls: 0,
    meta: {},
    controllerDecisionLog: [],
    messages: [],
    pendingGuidance: undefined,
    consecutiveLowDeltaCount: 0,
    readyToAnswerNudgeCount: 0,
    lastMetaToolCall: undefined,
    consecutiveMetaToolCount: 0,
  } as KernelState);

const baseInput = {
  task: "perf",
  availableToolSchemas: [{ name: "web-search", description: "", parameters: [] }],
  requiredTools: [] as string[],
} as never;

const noGuidance: GuidanceContext = { requiredToolsPending: [], loopDetected: false };

// ── Per-observation cost characteristics ────────────────────────────────────

describe("S2.5 perf — per-observation tax", () => {
  it("untrusted wrapper adds a bounded, predictable overhead per observation", () => {
    const o = obs("web-search", "untrusted", PAYLOAD);
    const rendered = renderObservationForPrompt(o);
    const overhead = rendered.length - PAYLOAD.length;
    // Overhead = `<tool_output tool="web-search">\n` (32) + `\n</tool_output>` (15) = 47
    // Tolerance: ±10 chars to allow toolName length variance and minor formatting tweaks.
    expect(overhead).toBeGreaterThan(35);
    expect(overhead).toBeLessThan(60);
  });

  it("trusted observations pay ZERO wrapping tax — the value of the trust signal", () => {
    const o = obs("recall", "trusted", PAYLOAD);
    const rendered = renderObservationForPrompt(o);
    // The exact bytes of the payload come back, no header, no wrapper.
    expect(rendered).toBe(PAYLOAD);
    expect(rendered.length).toBe(PAYLOAD.length);
  });

  it("per-observation tax is INDEPENDENT of payload size (constant overhead)", () => {
    // The wrapper is fixed-size; growing payloads pay no growing tax.
    const small = renderObservationForPrompt(obs("web-search", "untrusted", "x"));
    const big = renderObservationForPrompt(
      obs("web-search", "untrusted", "x".repeat(10_000)),
    );
    const smallOverhead = small.length - 1;
    const bigOverhead = big.length - 10_000;
    expect(smallOverhead).toBe(bigOverhead);
  });
});

// ── Section-level scaling ───────────────────────────────────────────────────

describe("S2.5 perf — section scaling vs limit", () => {
  it("section size is bounded by `limit`, not by total step count", () => {
    // 1000 observations, but limit=5 caps the rendered set.
    const many: ReasoningStep[] = Array.from({ length: 1000 }, (_, i) =>
      step(obs("web-search", "untrusted", `r${i}`), i),
    );
    const sectionSmall = buildRecentObservationsSection(many, 5)!;
    const sectionLarger = buildRecentObservationsSection(many, 50)!;

    // The 50-limit section is roughly 10x the 5-limit section (constant
    // header + per-observation overhead → linear in `limit`).
    const ratio = sectionLarger.length / sectionSmall.length;
    expect(ratio).toBeGreaterThan(7);
    expect(ratio).toBeLessThan(15);
  });

  it("section size scales LINEARLY in limit (not super-linearly)", () => {
    const many: ReasoningStep[] = Array.from({ length: 100 }, (_, i) =>
      step(obs("web-search", "untrusted", `r${i}`), i),
    );
    const s10 = buildRecentObservationsSection(many, 10)!.length;
    const s20 = buildRecentObservationsSection(many, 20)!.length;
    const s40 = buildRecentObservationsSection(many, 40)!.length;

    // doubling the limit ≈ doubling the section size (within 15%).
    expect(s20 / s10).toBeGreaterThan(1.85);
    expect(s20 / s10).toBeLessThan(2.15);
    expect(s40 / s20).toBeGreaterThan(1.85);
    expect(s40 / s20).toBeLessThan(2.15);
  });

  it("realistic agent ceiling: limit=10 with 500-char tool outputs ≈ ~5.5KB section", () => {
    // What a typical "summarize web results" agent would actually see.
    const realistic: ReasoningStep[] = Array.from({ length: 10 }, (_, i) =>
      step(obs("web-search", "untrusted", "x".repeat(500)), i),
    );
    const section = buildRecentObservationsSection(realistic, 10)!;
    // 10 observations × (~500 payload + ~47 overhead + 2 newline join) + header
    // ≈ 5.5KB. Pin a generous range so a 2× regression bites but normal
    // formatting tweaks don't.
    expect(section.length).toBeGreaterThan(4_500);
    expect(section.length).toBeLessThan(7_000);
  });
});

// ── End-to-end latency (curator wall-clock) ─────────────────────────────────

describe("S2.5 perf — curator wall-clock", () => {
  it("curator.curate() is sub-millisecond per call at realistic limits", () => {
    const realistic: ReasoningStep[] = Array.from({ length: 10 }, (_, i) =>
      step(obs("web-search", "untrusted", "x".repeat(500)), i),
    );
    const state = stateOf(realistic);
    const profile = { ...CONTEXT_PROFILES.local, recentObservationsLimit: 10 };

    // Warmup (defeat first-call JIT effects).
    for (let i = 0; i < 5; i++) {
      defaultContextCurator.curate(state, baseInput, profile, noGuidance, undefined, {
        includeRecentObservations: 10,
      });
    }

    const start = performance.now();
    const N = 500;
    for (let i = 0; i < N; i++) {
      defaultContextCurator.curate(state, baseInput, profile, noGuidance, undefined, {
        includeRecentObservations: 10,
      });
    }
    const avgMs = (performance.now() - start) / N;
    // Sub-millisecond per call on any reasonable hardware. Generous ceiling
    // (2ms) so this doesn't flake on slow CI runners but a 10× regression bites.
    expect(avgMs).toBeLessThan(2);
  });

  it("section-on adds <1ms vs section-off at realistic limits", () => {
    const realistic: ReasoningStep[] = Array.from({ length: 10 }, (_, i) =>
      step(obs("web-search", "untrusted", "x".repeat(500)), i),
    );
    const state = stateOf(realistic);
    const profile = CONTEXT_PROFILES.local;

    const N = 300;

    // Warmup.
    for (let i = 0; i < 5; i++) {
      defaultContextCurator.curate(state, baseInput, profile, noGuidance);
    }

    const offStart = performance.now();
    for (let i = 0; i < N; i++) {
      defaultContextCurator.curate(state, baseInput, profile, noGuidance);
    }
    const offMs = performance.now() - offStart;

    const onStart = performance.now();
    for (let i = 0; i < N; i++) {
      defaultContextCurator.curate(state, baseInput, profile, noGuidance, undefined, {
        includeRecentObservations: 10,
      });
    }
    const onMs = performance.now() - onStart;

    const overheadPerCallMs = (onMs - offMs) / N;
    // The section-rendering work — filter, slice, map, join — is pure string
    // ops on a small array. Should be well under 1ms per call. (Negative
    // values are fine — they just mean noise dominates the difference.)
    expect(overheadPerCallMs).toBeLessThan(1);
  });
});
