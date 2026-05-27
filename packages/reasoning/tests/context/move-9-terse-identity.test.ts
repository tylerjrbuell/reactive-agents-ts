/**
 * move-9-terse-identity.test.ts — Terse-identity render truth-table.
 *
 * Locks the conditions under which identitySection swaps from default
 * "You are a reasoning agent..." (which primes verbosity) to the
 * Mastra-equivalent "You are a helpful assistant. Answer directly..."
 * (which suppresses reasoning preamble on local-tier qwen3.5).
 *
 * Drift consequence: over-applying terse identity causes quality
 * regression on tool / multi-step tasks where reasoning bias is
 * load-bearing. Under-applying gives back the verbosity-reduction lift.
 */
import { describe, expect, it } from "bun:test";
import { ContextManager } from "../../src/context/context-manager.js";
import type { GuidanceContext } from "../../src/context/context-manager.js";
import type { ContextProfile } from "../../src/context/context-profile.js";
import type {
  KernelInput,
  KernelState,
} from "../../src/kernel/state/kernel-state.js";

function makeState(): KernelState {
  return {
    iteration: 0,
    status: "running",
    output: null,
    error: null,
    steps: [],
    messages: [],
    toolsUsed: new Set(),
    meta: { maxIterations: 10 },
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
  return { tier: "local", maxTokens: 8000 } as ContextProfile;
}
const noGuidance: GuidanceContext = {
  requiredToolsPending: [],
  loopDetected: false,
};

describe("MOVE-9 — terse identity prompt for trivial-fact shape", () => {
  it("trivial-fact knowledge task → terse identity, no 'reasoning agent' phrase", () => {
    const out = ContextManager.build(
      makeState(),
      makeInput({ task: "What is the capital of France?" }),
      makeProfile(),
      noGuidance,
    );
    expect(out.systemPrompt).toContain("Answer the question directly");
    expect(out.systemPrompt).toContain("Do not include reasoning");
    expect(out.systemPrompt).not.toContain("reasoning agent");
  });

  it("complex task → full reasoning identity preserved", () => {
    const out = ContextManager.build(
      makeState(),
      makeInput({
        task: "Compare and contrast eventual vs strong consistency. Critique the trade-offs.",
      }),
      makeProfile(),
      noGuidance,
    );
    // Identity primes thinking on complex shape — terse path NOT taken.
    expect(out.systemPrompt).not.toContain("Do not include reasoning");
  });

  it("trivial+tool task → terse identity NOT applied (tool needs reasoning bias)", () => {
    const out = ContextManager.build(
      makeState(),
      makeInput({
        task: "Use the calculator tool to compute 5 + 5.",
      }),
      makeProfile(),
      noGuidance,
    );
    expect(out.systemPrompt).not.toContain("Do not include reasoning");
  });

  it("custom systemPrompt → terse path bypassed (caller intent wins)", () => {
    const out = ContextManager.build(
      makeState(),
      makeInput({
        task: "What is the capital of France?",
        systemPrompt: "You are a custom-trained model.",
      }),
      makeProfile(),
      noGuidance,
    );
    expect(out.systemPrompt).toContain("You are a custom-trained model.");
    expect(out.systemPrompt).not.toContain("Do not include reasoning");
  });

  it("trivial-list task ('List RGB colors') → terse APPLIED (MOVE-9b widening)", () => {
    // After MOVE-9b: short list cue on trivial+no-tools → list-trivial form
    // → terse identity fires.
    const out = ContextManager.build(
      makeState(),
      makeInput({ task: "List the RGB colors." }),
      makeProfile(),
      noGuidance,
    );
    expect(out.systemPrompt).toContain("Answer the question directly");
  });

  it("moderate-list task → terse NOT applied (preserves reasoning bias)", () => {
    const out = ContextManager.build(
      makeState(),
      makeInput({
        task: "Analyze and list the trade-offs of NoSQL vs SQL for high-traffic systems.",
      }),
      makeProfile(),
      noGuidance,
    );
    // Moderate complexity → list stays "structured" → terse skipped.
    expect(out.systemPrompt).not.toContain("Do not include reasoning");
  });
});

// ── MOVE-10a — single-tool trivial path ──────────────────────────────────────

describe("MOVE-10a — terse-tool identity for trivial+single-tool", () => {
  it("trivial+single-tool task → TERSE_TOOL_PROMPT applied", () => {
    const out = ContextManager.build(
      makeState(),
      makeInput({
        // "Use the X tool" cue + digits → trivial+needsTools shape.
        task: "Use the calc tool to compute 5+5.",
        availableToolSchemas: [
          { name: "calc", description: "Calculator", parameters: [] },
        ],
      }),
      makeProfile(),
      noGuidance,
    );
    // Tool-terse prompt mentions tool usage explicitly.
    expect(out.systemPrompt).toContain("Use the provided tools");
    expect(out.systemPrompt).toContain("return the result directly");
  });

  it("trivial+single-tool: tool schemas still rendered (quality preserved)", () => {
    const out = ContextManager.build(
      makeState(),
      makeInput({
        task: "Use the calc tool to compute 5+5.",
        availableToolSchemas: [
          { name: "calc", description: "Calculator", parameters: [] },
        ],
      }),
      makeProfile(),
      noGuidance,
    );
    // Static-context still includes tool schemas (needsTools=true bypasses
    // strip). Model can SEE tool to call it.
    expect(out.systemPrompt).toContain("calc");
  });

  it("trivial+no-tools (k1 style) → fact prompt, NOT tool prompt", () => {
    const out = ContextManager.build(
      makeState(),
      makeInput({ task: "What is the capital of France?" }),
      makeProfile(),
      noGuidance,
    );
    expect(out.systemPrompt).toContain("Answer the question directly");
    expect(out.systemPrompt).not.toContain("Use the provided tools");
  });

  it("trivial+3-tools → TERSE_TOOL NOT applied (multi-tool selection needs reasoning)", () => {
    const out = ContextManager.build(
      makeState(),
      makeInput({
        task: "Use the calc tool to compute 5+5.",
        availableToolSchemas: [
          { name: "calc", description: "Calculator", parameters: [] },
          { name: "search", description: "Search", parameters: [] },
          { name: "fetch", description: "Fetch", parameters: [] },
        ],
      }),
      makeProfile(),
      noGuidance,
    );
    // 3 business tools > threshold 2 → terse skipped, reasoning identity kept.
    expect(out.systemPrompt).not.toContain("return the result directly");
  });

  it("trivial+1-tool but multi-step cue → terse NOT applied", () => {
    const out = ContextManager.build(
      makeState(),
      makeInput({
        task: "Use the calc tool to compute 5+5. Then explain the result.",
        availableToolSchemas: [
          { name: "calc", description: "Calculator", parameters: [] },
        ],
      }),
      makeProfile(),
      noGuidance,
    );
    // "Then" → needsMultiStep → terse predicate inhibited.
    expect(out.systemPrompt).not.toContain("return the result directly");
  });

  it("META-tools don't count toward TERSE_SINGLE_TOOL_THRESHOLD", () => {
    const out = ContextManager.build(
      makeState(),
      makeInput({
        task: "Use the calc tool to compute 5+5.",
        // 1 business tool + 3 meta tools = still single-tool-business
        availableToolSchemas: [
          { name: "calc", description: "Calculator", parameters: [] },
          { name: "final-answer", description: "Deliver final", parameters: [] },
          { name: "recall", description: "Recall stored", parameters: [] },
          { name: "brief", description: "Brief", parameters: [] },
        ],
      }),
      makeProfile(),
      noGuidance,
    );
    // Meta-tools excluded from count → terse-tool still fires.
    expect(out.systemPrompt).toContain("return the result directly");
  });
});
