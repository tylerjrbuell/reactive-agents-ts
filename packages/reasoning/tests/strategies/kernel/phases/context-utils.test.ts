// Run: bun test packages/reasoning/tests/strategies/kernel/phases/context-utils.test.ts --timeout 15000
import { describe, it, expect } from "bun:test";
import { readFileSync } from "fs";
import {
  buildSystemPrompt,
  toProviderMessage,
  buildToolSchemas,
  buildConversationMessages,
} from "../../../../src/strategies/kernel/phases/context-utils.js";
import { defaultAdapter } from "@reactive-agents/llm-provider";
import { initialKernelState } from "../../../../src/strategies/kernel/kernel-state.js";
import type { KernelMessage, KernelState } from "../../../../src/strategies/kernel/kernel-state.js";
import { CONTEXT_PROFILES } from "../../../../src/context/context-profile.js";

// ── Structural checks ─────────────────────────────────────────────────────────

const src = readFileSync(
  new URL("../../../../src/strategies/kernel/phases/context-utils.ts", import.meta.url),
  "utf8"
);
const kernelStateSrc = readFileSync(
  new URL("../../../../src/strategies/kernel/kernel-state.ts", import.meta.url),
  "utf8"
);
const kernelRunnerSrc = readFileSync(
  new URL("../../../../src/strategies/kernel/kernel-runner.ts", import.meta.url),
  "utf8"
);

describe("context-utils.ts structural", () => {
  it("does not reference synthesizedContext", () => {
    expect(src).not.toContain("synthesizedContext");
  });
  // Phase 4 gate: steeringNudge must NOT be injected as a user message by context-utils
  it("does not inject steeringNudge as a user message", () => {
    expect(src).not.toContain("steeringNudge");
  });
  it("does not have thoughtPrompt parameter", () => {
    expect(src).not.toContain("thoughtPrompt");
  });
  // Phase 2 gate: auto-forward injection must be gone from context-utils
  it("does not inject auto-forward content", () => {
    expect(src).not.toContain("autoForwardSection");
    expect(src).not.toContain("Auto-forwarded:");
  });
});

describe("kernel-state.ts structural", () => {
  // Phase 4 gate: steeringNudge field must be gone from KernelState — replaced by pendingGuidance
  it("does not have steeringNudge field", () => {
    expect(kernelStateSrc).not.toContain("steeringNudge");
  });
  it("has pendingGuidance field", () => {
    expect(kernelStateSrc).toContain("pendingGuidance");
  });
});

describe("kernel-runner.ts structural", () => {
  // Phase 4 gate: kernel-runner must route guidance through pendingGuidance, not steeringNudge
  // Note: icsResult.steeringNudge (the ICS coordinator's return field) is intentionally kept
  // in the ICS coordinator's interface — the check here is that kernel-runner doesn't SET
  // steeringNudge on KernelState (which would have the pattern "steeringNudge: ").
  it("does not set steeringNudge on KernelState", () => {
    expect(kernelRunnerSrc).not.toContain("steeringNudge: ");
  });
  it("writes pendingGuidance to state for harness signals", () => {
    expect(kernelRunnerSrc).toContain("pendingGuidance");
  });
});

// ── buildConversationMessages — no auto-forward injection ────────────────────

describe("buildConversationMessages", () => {
  function makeBaseState(overrides: Partial<KernelState> = {}): KernelState {
    return initialKernelState(
      { task: "test task", messages: [{ role: "user", content: "test task" }] },
      { taskId: "t1", strategy: "reactive", kernelType: "react" },
    ) as KernelState & typeof overrides extends never ? KernelState : KernelState & typeof overrides;
  }

  it("never injects [Auto-forwarded:] content into conversation messages", () => {
    const state = makeBaseState();
    const input = { task: "test task", messages: [{ role: "user", content: "test task" }] } as any;
    const profile = CONTEXT_PROFILES.local;
    const messages = buildConversationMessages(state, input, profile, defaultAdapter);
    const hasAutoForward = messages.some(
      (m) => typeof m.content === "string" && m.content.includes("[Auto-forwarded:"),
    );
    expect(hasAutoForward).toBe(false);
  }, 15000);
});

// ── buildSystemPrompt ─────────────────────────────────────────────────────────

describe("buildSystemPrompt", () => {
  it("returns a non-empty string when no custom prompt provided", () => {
    // task is ignored (seeded as messages[0] by the execution engine instead)
    const result = buildSystemPrompt("Write a haiku", undefined, "mid");
    expect(result.length).toBeGreaterThan(5);
    expect(typeof result).toBe("string");
  });

  it("includes custom system prompt when provided", () => {
    const result = buildSystemPrompt("task", "You are a poet.", "mid");
    expect(result).toContain("You are a poet.");
  });

  it("returns a non-empty string for all tiers", () => {
    for (const tier of ["local", "mid", "large", "frontier"] as const) {
      expect(buildSystemPrompt("task", undefined, tier).length).toBeGreaterThan(5);
    }
  });
});

// ── toProviderMessage ─────────────────────────────────────────────────────────

describe("toProviderMessage", () => {
  it("converts a user message", () => {
    const msg: KernelMessage = { role: "user", content: "hello" };
    const result = toProviderMessage(msg);
    expect(result.role).toBe("user");
    expect(result.content).toContain("hello");
  });

  it("converts an assistant message without toolCalls", () => {
    const msg: KernelMessage = { role: "assistant", content: "I will search." };
    const result = toProviderMessage(msg);
    expect(result.role).toBe("assistant");
  });

  it("converts a tool_result message", () => {
    const msg: KernelMessage = {
      role: "tool_result",
      toolCallId: "call-1",
      toolName: "web-search",
      content: "Results here",
    };
    const result = toProviderMessage(msg);
    // Should not throw and should have content
    expect(result).toBeDefined();
  });
});

// ── buildToolSchemas ──────────────────────────────────────────────────────────

describe("buildToolSchemas", () => {
  const mockProfile = { tier: "mid" as const, maxTokens: 4096, temperature: 0.7 } as any;

  function makeState(overrides: any = {}): KernelState {
    return {
      taskId: "t1", strategy: "reactive", kernelType: "react",
      steps: [], toolsUsed: new Set(), scratchpad: new Map(),
      iteration: 0, tokens: 0, cost: 0, status: "thinking",
      output: null, error: null, llmCalls: 0,
      meta: { gateBlockedTools: [] }, controllerDecisionLog: [], messages: [],
      ...overrides,
    } as KernelState;
  }

  const schemas = [
    { name: "web-search", description: "Search", parameters: {} },
    { name: "file-write", description: "Write", parameters: {} },
  ];

  it("returns all schemas when nothing is gate-blocked", () => {
    const input = { availableToolSchemas: schemas, requiredTools: [], task: "test" } as any;
    const result = buildToolSchemas(makeState(), input, mockProfile);
    expect(result.length).toBeGreaterThanOrEqual(2);
  });

  it("removes gate-blocked tools when required tools are still unmet", () => {
    const state = makeState({ meta: { gateBlockedTools: ["file-write"] } });
    const input = {
      availableToolSchemas: schemas,
      requiredTools: ["web-search"],
      task: "test",
    } as any;
    const result = buildToolSchemas(state, input, mockProfile);
    expect(result.find((s: any) => s.name === "file-write")).toBeUndefined();
    expect(result.find((s: any) => s.name === "web-search")).toBeDefined();
  });

  it("does not filter when required tools are already met", () => {
    const state = makeState({
      meta: { gateBlockedTools: ["file-write"] },
      toolsUsed: new Set(["web-search"]),
    });
    const input = {
      availableToolSchemas: schemas,
      requiredTools: ["web-search"],
      task: "test",
    } as any;
    const result = buildToolSchemas(state, input, mockProfile);
    // Required tool is met, so gate-blocking doesn't apply
    expect(result.find((s: any) => s.name === "web-search")).toBeDefined();
  });
});
