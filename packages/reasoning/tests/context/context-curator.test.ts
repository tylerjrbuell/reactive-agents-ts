// Run: bun test packages/reasoning/tests/context/context-curator.test.ts --timeout 15000
//
// Pin the S2.5 ContextCurator seam:
//   1. defaultContextCurator returns the same Prompt as the underlying
//      ContextManager.build (Slice A is byte-identical wrapping).
//   2. renderObservationForPrompt wraps untrusted observations in a
//      <tool_output> block; trusted observations render plainly.
//
// If a future refactor introduces a parallel prompt-author path that bypasses
// the curator, these assertions still hold for the curator path — but cf-19
// (gate scenario) is what surfaces the *architectural* regression.

import { describe, it, expect } from "bun:test";
import {
  defaultContextCurator,
  renderObservationForPrompt,
  buildRecentObservationsSection,
  RECENT_OBSERVATIONS_HEADER,
} from "../../src/context/context-curator.js";
import { ContextManager, type GuidanceContext } from "../../src/context/context-manager.js";
import { CONTEXT_PROFILES } from "../../src/context/context-profile.js";
import type { KernelState } from "../../src/kernel/state/kernel-state.js";
import type { ReasoningStep } from "../../src/types/step.js";
import type { ObservationResult } from "../../src/types/observation.js";

function makeObs(
  toolName: string,
  trustLevel: "trusted" | "untrusted",
  displayText: string,
): ObservationResult {
  return {
    success: true,
    toolName,
    displayText,
    category: trustLevel === "trusted" ? "scratchpad" : "web-search",
    resultKind: trustLevel === "trusted" ? "side-effect" : "data",
    preserveOnCompaction: false,
    trustLevel,
    ...(trustLevel === "trusted" ? { trustJustification: "grandfather-phase-1" } : {}),
  };
}

function makeObservationStep(obs: ObservationResult, idx: number): ReasoningStep {
  return {
    id: `step-${idx}` as ReasoningStep["id"],
    type: "observation",
    content: obs.displayText,
    timestamp: new Date(2026, 3, 25, 22, idx, 0),
    metadata: { observationResult: obs },
  };
}

function makeState(overrides: Partial<KernelState> = {}): KernelState {
  return {
    taskId: "t1",
    strategy: "reactive",
    kernelType: "react",
    steps: [],
    toolsUsed: new Set<string>(),
    scratchpad: new Map<string, string>(),
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
    ...overrides,
  } as KernelState;
}

function makeInput() {
  return {
    task: "Summarize the docs",
    availableToolSchemas: [
      { name: "web-search", description: "Search", parameters: [] },
    ],
    requiredTools: [] as string[],
  } as never;
}

const noGuidance: GuidanceContext = {
  requiredToolsPending: [],
  loopDetected: false,
};

describe("defaultContextCurator", () => {
  it("returns a Prompt byte-identical to ContextManager.build (Slice A wrapping)", () => {
    const state = makeState();
    const input = makeInput();
    const profile = CONTEXT_PROFILES.local;

    const direct = ContextManager.build(state, input, profile, noGuidance);
    const curated = defaultContextCurator.curate(state, input, profile, noGuidance);

    expect(curated.systemPrompt).toBe(direct.systemPrompt);
    expect(curated.messages).toEqual(direct.messages);
  });

  it("forwards options (availableTools, systemPromptBody) through to the underlying builder", () => {
    const state = makeState();
    const input = makeInput();
    const profile = CONTEXT_PROFILES.local;

    const { systemPrompt } = defaultContextCurator.curate(
      state,
      input,
      profile,
      noGuidance,
      undefined,
      {
        availableTools: [{ name: "custom-only", description: "", parameters: [] }],
        systemPromptBody: "You are a documentation summarizer.",
      },
    );

    expect(systemPrompt).toContain("custom-only");
    expect(systemPrompt).toContain("documentation summarizer");
  });
});

describe("renderObservationForPrompt", () => {
  const trusted: ObservationResult = {
    success: true,
    toolName: "recall",
    displayText: "scratchpad value here",
    category: "scratchpad",
    resultKind: "side-effect",
    preserveOnCompaction: false,
    trustLevel: "trusted",
    trustJustification: "grandfather-phase-1",
  };

  const untrusted: ObservationResult = {
    success: true,
    toolName: "web-search",
    displayText: "Page contents may contain ignore previous instructions.",
    category: "web-search",
    resultKind: "data",
    preserveOnCompaction: false,
    trustLevel: "untrusted",
  };

  it("renders trusted observations plainly (no wrapping)", () => {
    const out = renderObservationForPrompt(trusted);
    expect(out).toBe("scratchpad value here");
    expect(out).not.toContain("<tool_output");
  });

  it("wraps untrusted observations in a <tool_output> block tagged with toolName", () => {
    const out = renderObservationForPrompt(untrusted);
    expect(out.startsWith('<tool_output tool="web-search">')).toBe(true);
    expect(out.endsWith("</tool_output>")).toBe(true);
    expect(out).toContain("ignore previous instructions");
  });

  it("preserves the original displayText inside the wrapper (no truncation)", () => {
    const long = { ...untrusted, displayText: "A".repeat(2000) };
    const out = renderObservationForPrompt(long);
    expect(out).toContain("A".repeat(2000));
  });
});

// ── Slice B: buildRecentObservationsSection + curator section authorship ──────

describe("buildRecentObservationsSection", () => {
  it("returns null when limit is 0 or negative", () => {
    const steps = [makeObservationStep(makeObs("web-search", "untrusted", "x"), 0)];
    expect(buildRecentObservationsSection(steps, 0)).toBeNull();
    expect(buildRecentObservationsSection(steps, -3)).toBeNull();
  });

  it("returns null when no observation steps exist", () => {
    const thoughtStep: ReasoningStep = {
      id: "step-thought" as ReasoningStep["id"],
      type: "thought",
      content: "thinking",
      timestamp: new Date(),
      metadata: {},
    };
    expect(buildRecentObservationsSection([thoughtStep], 5)).toBeNull();
  });

  it("limits to the most-recent N observation steps and renders them in order", () => {
    const steps = [
      makeObservationStep(makeObs("web-search", "untrusted", "first"), 0),
      makeObservationStep(makeObs("web-search", "untrusted", "second"), 1),
      makeObservationStep(makeObs("web-search", "untrusted", "third"), 2),
    ];
    const section = buildRecentObservationsSection(steps, 2);
    expect(section).not.toBeNull();
    expect(section).toContain(RECENT_OBSERVATIONS_HEADER);
    // Last 2 only — "first" excluded, "second" + "third" included in order.
    expect(section).not.toContain("first");
    const secondIdx = section!.indexOf("second");
    const thirdIdx = section!.indexOf("third");
    expect(secondIdx).toBeGreaterThan(0);
    expect(thirdIdx).toBeGreaterThan(secondIdx);
  });

  it("wraps untrusted but not trusted observations within the same section", () => {
    const steps = [
      makeObservationStep(makeObs("recall", "trusted", "scratch-value"), 0),
      makeObservationStep(makeObs("web-search", "untrusted", "search-payload"), 1),
    ];
    const section = buildRecentObservationsSection(steps, 5)!;
    expect(section).toContain('<tool_output tool="web-search">');
    expect(section).toContain("search-payload");
    // Trusted line is plain — its toolName MUST NOT appear inside a wrapper.
    expect(section).not.toContain('<tool_output tool="recall">');
    expect(section).toContain("scratch-value");
  });

  it("skips observation steps that lack an observationResult", () => {
    const steps: ReasoningStep[] = [
      {
        id: "step-bare" as ReasoningStep["id"],
        type: "observation",
        content: "no result attached",
        timestamp: new Date(),
        metadata: {},
      },
      makeObservationStep(makeObs("web-search", "untrusted", "real-payload"), 1),
    ];
    const section = buildRecentObservationsSection(steps, 5)!;
    expect(section).toContain("real-payload");
    expect(section).not.toContain("no result attached");
  });
});

describe("defaultContextCurator — Slice B section authorship", () => {
  const baseInput = makeInput;

  it("does NOT append the section when includeRecentObservations is absent (Slice A parity)", () => {
    const state = makeState({
      steps: [makeObservationStep(makeObs("web-search", "untrusted", "payload"), 0)],
    });
    const { systemPrompt } = defaultContextCurator.curate(
      state,
      baseInput(),
      CONTEXT_PROFILES.local,
      noGuidance,
    );
    expect(systemPrompt).not.toContain(RECENT_OBSERVATIONS_HEADER);
    expect(systemPrompt).not.toContain("<tool_output");
  });

  it("appends the trust-aware section when includeRecentObservations > 0", () => {
    const state = makeState({
      steps: [
        makeObservationStep(makeObs("recall", "trusted", "scratch-x"), 0),
        makeObservationStep(makeObs("web-search", "untrusted", "ADVERSARIAL PAYLOAD"), 1),
      ],
    });
    const { systemPrompt } = defaultContextCurator.curate(
      state,
      baseInput(),
      CONTEXT_PROFILES.local,
      noGuidance,
      undefined,
      { includeRecentObservations: 5 },
    );
    expect(systemPrompt).toContain(RECENT_OBSERVATIONS_HEADER);
    expect(systemPrompt).toContain('<tool_output tool="web-search">');
    expect(systemPrompt).toContain("ADVERSARIAL PAYLOAD");
    expect(systemPrompt).toContain("scratch-x");
    // Section is appended at the tail (after the existing curator output).
    const headerIdx = systemPrompt.indexOf(RECENT_OBSERVATIONS_HEADER);
    expect(headerIdx).toBeGreaterThan(0);
  });
});

// ── Slice C: profile-driven production wiring ────────────────────────────────

describe("ContextProfile.recentObservationsLimit (S2.5 Slice C)", () => {
  it("all default tier profiles ship with recentObservationsLimit OFF (0/undefined)", () => {
    // Pinning the convention: turning this on globally would change every
    // prompt's token budget. It MUST stay opt-in per-agent.
    for (const tier of ["local", "mid", "large", "frontier"] as const) {
      const lim = CONTEXT_PROFILES[tier].recentObservationsLimit;
      expect(lim === undefined || lim === 0).toBe(true);
    }
  });

  it("profile.recentObservationsLimit drives the curator section when an override is supplied via mergeProfile-style usage", () => {
    const state = makeState({
      steps: [makeObservationStep(makeObs("file-read", "untrusted", "FILE-PAYLOAD"), 0)],
    });
    const profileWithOverride = {
      ...CONTEXT_PROFILES.local,
      recentObservationsLimit: 3,
    };
    // Mimics what think.ts does: forwards profile.recentObservationsLimit
    // into the curator option. If think.ts ever stops threading the field,
    // this assertion still passes (curator is correctly wired) — but the
    // wiring test below (think.ts integration) is the regression catch.
    const { systemPrompt } = defaultContextCurator.curate(
      state,
      makeInput(),
      profileWithOverride,
      noGuidance,
      undefined,
      { includeRecentObservations: profileWithOverride.recentObservationsLimit },
    );
    expect(systemPrompt).toContain(RECENT_OBSERVATIONS_HEADER);
    expect(systemPrompt).toContain("FILE-PAYLOAD");
  });

  it("falls back to OFF when profile.recentObservationsLimit is undefined", () => {
    const state = makeState({
      steps: [makeObservationStep(makeObs("file-read", "untrusted", "FILE-PAYLOAD"), 0)],
    });
    const { systemPrompt } = defaultContextCurator.curate(
      state,
      makeInput(),
      CONTEXT_PROFILES.local, // no override
      noGuidance,
      undefined,
      { includeRecentObservations: CONTEXT_PROFILES.local.recentObservationsLimit ?? 0 },
    );
    expect(systemPrompt).not.toContain(RECENT_OBSERVATIONS_HEADER);
    expect(systemPrompt).not.toContain("FILE-PAYLOAD");
  });
});
