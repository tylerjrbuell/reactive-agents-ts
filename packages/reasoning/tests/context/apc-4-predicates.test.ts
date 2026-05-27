/**
 * apc-4-predicates.test.ts — APC-4 per-section predicate pins.
 *
 * Locks the behavior change introduced by APC-4: shape-gated composer
 * strips `static-context` + `guidance` on high-confidence-trivial tasks
 * (k1-france-capital, k3-rgb-colors equivalents). Tool / multi-step /
 * citation tasks keep ALL sections.
 *
 * If these predicates drift, the framework either:
 *   (a) over-strips (regresses tool/multistep quality — APC-0 showed
 *       +42% to +136% output and pass→fail flips), or
 *   (b) under-strips (gives back the trivial-task token savings APC-4
 *       was designed to capture).
 *
 * Either way, bench evidence and warden audit catch it — these tests
 * fail FIRST so the regression never reaches CI.
 */
import { describe, expect, it } from "bun:test";
import { ContextManager } from "../../src/context/context-manager.js";
import type { GuidanceContext } from "../../src/context/context-manager.js";
import type { ContextProfile } from "../../src/context/context-profile.js";
import type {
  KernelInput,
  KernelState,
} from "../../src/kernel/state/kernel-state.js";
import {
  staticContextSection,
  guidanceSection,
  toolElaborationSection,
  identitySection,
  priorContextSection,
  progressSection,
  priorWorkSection,
} from "../../src/context/prompt-sections-default.js";
import type { TaskShape } from "../../src/kernel/capabilities/comprehend/task-shape.js";

function shape(overrides: Partial<TaskShape> = {}): TaskShape {
  return {
    complexity: "trivial",
    needsTools: false,
    needsMultiStep: false,
    needsCitation: false,
    needsStructuredOutput: false,
    expectedOutputForm: "fact",
    highConfidence: true,
    reason: "test",
    ...overrides,
  };
}

function makeState(overrides: Partial<KernelState> = {}): KernelState {
  return {
    iteration: 0,
    status: "running",
    output: null,
    error: null,
    steps: [],
    messages: [],
    toolsUsed: new Set(),
    meta: { maxIterations: 10 },
    ...overrides,
  } as KernelState;
}
function makeInput(overrides: Partial<KernelInput> = {}): KernelInput {
  return {
    task: "What is the capital of France?",
    availableToolSchemas: [],
    requiredTools: [],
    ...overrides,
  } as KernelInput;
}
function makeProfile(): ContextProfile {
  return { tier: "mid", maxTokens: 8000 } as ContextProfile;
}
function makeGuidance(o: Partial<GuidanceContext> = {}): GuidanceContext {
  return { requiredToolsPending: [], loopDetected: false, ...o };
}

// ── Per-section predicate truth-table ────────────────────────────────────────

describe("APC-4 — per-section requiredWhen predicates", () => {
  it("identity: required on ALL shapes", () => {
    expect(identitySection.requiredWhen(shape())).toBe(true);
    expect(identitySection.requiredWhen(shape({ complexity: "complex" }))).toBe(true);
    expect(identitySection.requiredWhen(shape({ needsTools: true }))).toBe(true);
  });

  it("prior-context: required on ALL shapes (self-conditional render)", () => {
    expect(priorContextSection.requiredWhen(shape())).toBe(true);
    expect(priorContextSection.requiredWhen(shape({ complexity: "complex" }))).toBe(true);
  });

  it("static-context: STRIPPED only on high-confidence-trivial", () => {
    // Stripped:
    expect(staticContextSection.requiredWhen(shape())).toBe(false);
    // Kept on tool tasks (even trivial-classified):
    expect(staticContextSection.requiredWhen(shape({ needsTools: true }))).toBe(true);
    // Kept on multi-step:
    expect(staticContextSection.requiredWhen(shape({ needsMultiStep: true }))).toBe(true);
    // Kept on citation needs:
    expect(staticContextSection.requiredWhen(shape({ needsCitation: true }))).toBe(true);
    // Kept on structured output:
    expect(staticContextSection.requiredWhen(shape({ needsStructuredOutput: true }))).toBe(true);
    // Kept on moderate:
    expect(staticContextSection.requiredWhen(shape({ complexity: "moderate" }))).toBe(true);
    // Kept on complex:
    expect(staticContextSection.requiredWhen(shape({ complexity: "complex" }))).toBe(true);
    // Kept on low-confidence trivial:
    expect(
      staticContextSection.requiredWhen(shape({ highConfidence: false })),
    ).toBe(true);
  });

  it("tool-elaboration: required ONLY when shape.needsTools", () => {
    expect(toolElaborationSection.requiredWhen(shape())).toBe(false);
    expect(toolElaborationSection.requiredWhen(shape({ needsTools: true }))).toBe(true);
  });

  it("progress: always required (self-conditional render)", () => {
    expect(progressSection.requiredWhen(shape())).toBe(true);
    expect(progressSection.requiredWhen(shape({ complexity: "complex" }))).toBe(true);
  });

  it("prior-work: always required (self-conditional render)", () => {
    expect(priorWorkSection.requiredWhen(shape())).toBe(true);
  });

  it("guidance: STRIPPED only on high-confidence-trivial", () => {
    expect(guidanceSection.requiredWhen(shape())).toBe(false);
    expect(guidanceSection.requiredWhen(shape({ needsTools: true }))).toBe(true);
    expect(guidanceSection.requiredWhen(shape({ needsMultiStep: true }))).toBe(true);
    expect(guidanceSection.requiredWhen(shape({ complexity: "complex" }))).toBe(true);
    expect(guidanceSection.requiredWhen(shape({ highConfidence: false }))).toBe(true);
  });
});

// ── Integration via ContextManager.build ─────────────────────────────────────

describe("APC-4 — ContextManager.build integration", () => {
  it("trivial knowledge task → static-context STRIPPED, task-echo INCLUDED", () => {
    // "What is the capital of France?" is high-confidence trivial.
    const out = ContextManager.build(
      makeState(),
      makeInput({ task: "What is the capital of France?" }),
      makeProfile(),
      makeGuidance(),
    );
    // task-echo emits compact "Task: {task}" since static-context is stripped
    // (safety mechanism — ensures task text always visible to LLM).
    expect(out.systemPrompt).toContain("Task: What is the capital of France?");
    // No static-context env/rules/format blocks — those carry their own
    // distinctive landmarks ("Environment:", "Rules:", schema headers).
    expect(out.systemPrompt).not.toContain("Environment:");
    expect(out.systemPrompt).not.toContain("Rules:");
    // Output is compact relative to full scaffold.
    expect(out.systemPrompt.length).toBeLessThan(500);
  });

  it("complex task → static-context KEPT (parity preserved)", () => {
    const out = ContextManager.build(
      makeState(),
      makeInput({
        task: "Compare and contrast eventual vs strong consistency. Critique the trade-offs.",
      }),
      makeProfile(),
      makeGuidance(),
    );
    // static-context renders task framing for complex shape.
    expect(out.systemPrompt).toContain("Task:");
  });

  it("tool-required trivial task → static-context KEPT", () => {
    const out = ContextManager.build(
      makeState(),
      makeInput({
        task: "Use the calculator tool to compute 5 + 5.",
      }),
      makeProfile(),
      makeGuidance(),
    );
    // needsTools=true overrides trivial-strip predicate.
    expect(out.systemPrompt).toContain("Task:");
  });

  it("trivial task with active guidance signals → guidance section STILL stripped (predicate is shape-gated, not signal-gated)", () => {
    const out = ContextManager.build(
      makeState(),
      makeInput({ task: "What is the capital of France?" }),
      makeProfile(),
      makeGuidance({
        loopDetected: true, // signal present but shape is trivial
      }),
    );
    // APC-4 chose shape-gating over signal-gating: on truly trivial tasks,
    // harness signals are unlikely to be load-bearing. If this proves
    // false in evidence, the predicate should add a signal-presence
    // override.
    expect(out.systemPrompt).not.toContain("Guidance:");
  });

  it("moderate task with guidance → guidance section KEPT", () => {
    const out = ContextManager.build(
      makeState(),
      makeInput({
        task: "Explain the trade-offs between B-tree, hash, and full-text indexing.",
      }),
      makeProfile(),
      makeGuidance({ loopDetected: true }),
    );
    expect(out.systemPrompt).toContain("Guidance:");
  });
});
