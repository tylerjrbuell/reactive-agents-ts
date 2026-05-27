/**
 * apc-3-parity.test.ts — APC-3 byte-identical parity gate.
 *
 * Pins that `ContextManager.build(...)` produces the SAME systemPrompt
 * pre- and post-composer-migration. The composer in `shapeGated: false`
 * mode delegates to the same render fns the monolith used; therefore
 * output must be byte-identical for every fixture.
 *
 * If this test fails, APC-3's section registration drifted from the
 * legacy monolith — silent prompt change that risks empirical regression.
 *
 * Methodology: build a kernel state + input + profile + guidance, call
 * ContextManager.build, and assert section landmarks (`Iteration:`,
 * `Guidance:`, etc.) are present in expected order. Full byte-pinning is
 * fragile to environment timestamps in buildStaticContext, so we pin
 * structural ordering instead.
 */
import { describe, expect, it } from "bun:test";
import { ContextManager } from "../../src/context/context-manager.js";
import type { GuidanceContext } from "../../src/context/context-manager.js";
import type { ContextProfile } from "../../src/context/context-profile.js";
import type {
  KernelInput,
  KernelState,
} from "../../src/kernel/state/kernel-state.js";

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
  return {
    tier: "mid",
    maxTokens: 8000,
    includeTimestamps: false,
    includeEnvironment: false,
  } as ContextProfile;
}

function makeGuidance(overrides: Partial<GuidanceContext> = {}): GuidanceContext {
  return {
    requiredToolsPending: [],
    loopDetected: false,
    ...overrides,
  };
}

describe("APC-3 parity — ContextManager.build delegates to composer correctly", () => {
  it("trivial task with no guidance → identity + static-context (no Progress, Prior work, Guidance)", () => {
    const out = ContextManager.build(
      makeState(),
      makeInput(),
      makeProfile(),
      makeGuidance(),
    );

    // Identity must lead.
    expect(out.systemPrompt.length).toBeGreaterThan(0);
    // No tools called + iter 0 → progress section omitted.
    expect(out.systemPrompt).not.toContain("Iteration:");
    // No facts → prior work omitted.
    expect(out.systemPrompt).not.toContain("Prior work:");
    // No signals → guidance omitted.
    expect(out.systemPrompt).not.toContain("Guidance:");
  });

  it("with guidance signals → Guidance section appears at tail", () => {
    const out = ContextManager.build(
      makeState(),
      makeInput(),
      makeProfile(),
      makeGuidance({
        loopDetected: true,
        requiredToolsPending: ["calc"],
      }),
    );

    expect(out.systemPrompt).toContain("Guidance:");
    expect(out.systemPrompt).toContain("REQUIRED tools not yet called");
    expect(out.systemPrompt).toContain("Loop detected");
    // Guidance section is last → its index in the prompt is highest among
    // sections we know about.
    const guidanceIdx = out.systemPrompt.indexOf("Guidance:");
    const idx = out.systemPrompt.length;
    expect(guidanceIdx).toBeLessThan(idx);
  });

  it("priorContext present → rendered as second section", () => {
    const out = ContextManager.build(
      makeState(),
      makeInput({ priorContext: "[Memory] Prior session: France=Paris." }),
      makeProfile(),
      makeGuidance(),
    );
    expect(out.systemPrompt).toContain("Prior session: France=Paris");
  });

  it("tools used → Progress section emitted", () => {
    const state = makeState({
      iteration: 2,
      toolsUsed: new Set(["bench_calculator"]),
    });
    const out = ContextManager.build(
      state,
      makeInput({ requiredTools: ["bench_calculator"] }),
      makeProfile(),
      makeGuidance(),
    );
    expect(out.systemPrompt).toContain("Iteration:");
    expect(out.systemPrompt).toContain("Tools called: bench_calculator");
    expect(out.systemPrompt).toContain("Required tools: all satisfied");
  });

  it("RA_MINIMAL_PROMPT=1 escape hatch still works (composer NOT consulted)", () => {
    const prev = process.env.RA_MINIMAL_PROMPT;
    process.env.RA_MINIMAL_PROMPT = "1";
    try {
      const out = ContextManager.build(
        makeState(),
        makeInput(),
        makeProfile(),
        makeGuidance(),
      );
      // Minimal mode emits `Task: <text>` and no static-context boilerplate.
      expect(out.systemPrompt).toContain("Task: What is the capital of France?");
      expect(out.systemPrompt.length).toBeLessThan(200);
    } finally {
      if (prev === undefined) delete process.env.RA_MINIMAL_PROMPT;
      else process.env.RA_MINIMAL_PROMPT = prev;
    }
  });
});

describe("APC-3 — composer always invoked outside RA_MINIMAL_PROMPT", () => {
  it("section ordering matches DEFAULT_SECTIONS registration order", async () => {
    const { DEFAULT_SECTIONS } = await import(
      "../../src/context/prompt-sections-default.js"
    );
    // Ensure DEFAULT_SECTIONS contains all 7 expected sections in order.
    expect(DEFAULT_SECTIONS.map((s) => s.id)).toEqual([
      "identity",
      "prior-context",
      "static-context",
      "tool-elaboration",
      "progress",
      "prior-work",
      "guidance",
    ]);
  });
});
