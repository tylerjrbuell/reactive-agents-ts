// Run: bun test packages/reasoning/src/kernel/capabilities/act/conversation-assembly.test.ts
//
// 2026-07-30: root cause of a live run silently losing 21 of 25 requested
// commits. When a tool result's full scratchpad value exceeds
// TOOL_RESULT_INLINE_CAP, the old code did `fullFromScratchpad.slice(0, CAP)`
// — a blind character cut with no notion of item/line boundaries. For JSON
// data this guarantees a corrupted mid-string cut and silently drops
// whatever fell past it, with only a generic "...truncated (N chars)" note
// (no honest count of how many real items survived).
//
// The fix: fall back to `obsStep.content` — the ALREADY-computed
// compressToolResult preview — which carries an honest "M of N shown" count
// and a working recall() hint, instead of re-truncating the raw full text.
import { describe, expect, it } from "bun:test";
import type { ProviderAdapter } from "@reactive-agents/llm-provider";
import { NativeFCDriver } from "@reactive-agents/tools";
import { assembleConversation } from "./conversation-assembly.js";
import { initialKernelState, noopHooks, type KernelContext } from "../../state/kernel-state.js";
import { makeStep } from "../sense/step-utils.js";
import { makeObservationResult } from "../../utils/observation-helpers.js";
import { CONTEXT_PROFILES } from "../../../context/context-profile.js";

const context: KernelContext = {
  input: { task: "Find the last 25 commits.", availableToolSchemas: [] },
  profile: CONTEXT_PROFILES.local,
  compression: { budget: 800, previewItems: 5, autoStore: true, codeTransform: true },
  toolService: { _tag: "None" },
  hooks: noopHooks,
  toolCallingDriver: new NativeFCDriver(),
  memoryService: { _tag: "None" },
};

const adapter: ProviderAdapter = {};

const baseState = () => ({
  ...initialKernelState({ strategy: "reactive", kernelType: "reactive", maxIterations: 8 }),
  messages: [{ role: "user" as const, content: "Find the last 25 commits." }],
});

describe("assembleConversation — tool-result inline vs. compressed-preview fallback", () => {
  it("uses the compressed preview, not a blind slice, when the full result exceeds the inline cap", () => {
    const state = baseState();
    const compressedPreview =
      "[gh-cli result — compressed preview]\nType: Array(25)\nPreview (first 5 of 25):\n  [0] sha=abc1234 message=fix one\n  ...20 more\n  — full data is stored. Use recall(\"_tool_result_1\", arrayStart: 5, arrayCount: 20).";
    const obsStep = makeStep("observation", compressedPreview, {
      toolCallId: "tc1",
      storedKey: "_tool_result_1",
    });
    const allSteps = [
      makeStep("action", "[ACT] gh-cli", { toolCall: { id: "tc1", name: "gh-cli", arguments: {} } }),
      obsStep,
    ];
    // Full raw text WELL over the inline cap — 25 real commits' worth of JSON.
    const hugeFullText = Array.from(
      { length: 25 },
      (_, i) => `{"sha":"c${i}","message":"commit number ${i} with some extra padding text to grow the payload well past the four thousand character inline cap so this test actually exercises the fallback branch"}`,
    ).join("\n");
    const sharedScratchpad = new Map([["_tool_result_1", hugeFullText]]);

    const result = assembleConversation({
      state,
      context,
      adapter,
      allSteps,
      normalizedPendingCalls: [{ id: "tc1", name: "gh-cli", arguments: {} }],
      newToolsUsed: new Set(["gh-cli"]),
      sharedScratchpad,
    });

    const toolMsg = result.messages.find((m) => m.role === "tool_result" && m.toolCallId === "tc1");
    expect(toolMsg).toBeDefined();
    // Must be the honest, structured preview — never the raw text, and never
    // a character-sliced fragment of it (which would still start with the
    // raw text's own opening bytes but cut off mid-record).
    expect(toolMsg?.content).toBe(compressedPreview);
    expect(toolMsg?.content).not.toContain("commit number 0");
  });

  it("still inlines the full result whole when it fits within the inline cap (unchanged G-4 behavior)", () => {
    const state = baseState();
    const compressedPreview = "[gh-cli result — compressed preview]\nType: Array(2)\n...";
    const obsStep = makeStep("observation", compressedPreview, {
      toolCallId: "tc1",
      storedKey: "_tool_result_1",
    });
    const allSteps = [
      makeStep("action", "[ACT] gh-cli", { toolCall: { id: "tc1", name: "gh-cli", arguments: {} } }),
      obsStep,
    ];
    const smallFullText = '{"sha":"c0","message":"one"}\n{"sha":"c1","message":"two"}';
    const sharedScratchpad = new Map([["_tool_result_1", smallFullText]]);

    const result = assembleConversation({
      state,
      context,
      adapter,
      allSteps,
      normalizedPendingCalls: [{ id: "tc1", name: "gh-cli", arguments: {} }],
      newToolsUsed: new Set(["gh-cli"]),
      sharedScratchpad,
    });

    const toolMsg = result.messages.find((m) => m.role === "tool_result" && m.toolCallId === "tc1");
    expect(toolMsg?.content).toBe(smallFullText);
  });
});

describe("assembleConversation — required-tools-satisfied completion nudge", () => {
  // Live-model QA, 2026-08-16 (cogito:8b/gemma4:e4b/qwen3:4b, rw-4/rw-8/rw-9 —
  // all single-quantity required-tools tasks): this branch used to say
  // NOTHING once the model's required tools were satisfied, on the theory
  // that "called once" is too weak a signal to justify the aggressive
  // "FINAL ANSWER now" push used for multi-quantity tasks. Measured cost:
  // smaller local models routinely satisfied their required tools, then just
  // stopped without ever calling final-answer, because nothing told them
  // finishing was an option — the harness had to fall back to
  // harness_deliverable + output-gate reformatting on nearly every run.
  it("sends a soft, informational finish nudge (not silence) once single-quantity required tools are satisfied", () => {
    const state = baseState();
    const obsStep = makeStep("observation", "[http-get result] 200 OK", { toolCallId: "tc1", observationResult: makeObservationResult("http-get", true, "[http-get result] 200 OK") });
    const allSteps = [
      makeStep("action", "[ACT] http-get", { toolCall: { id: "tc1", name: "http-get", arguments: {} } }),
      obsStep,
    ];
    const contextWithRequiredTools: KernelContext = {
      ...context,
      input: { ...context.input, requiredTools: ["http-get"] },
    };

    const result = assembleConversation({
      state,
      context: contextWithRequiredTools,
      adapter,
      allSteps,
      normalizedPendingCalls: [{ id: "tc1", name: "http-get", arguments: {} }],
      newToolsUsed: new Set(["http-get"]),
      sharedScratchpad: new Map(),
    });

    expect(result.completionNudgeSent).toBe(true);
    expect(result.actReminder).toBeDefined();
    expect(result.actReminder).toContain("Required tool calls are satisfied");
    expect(result.actReminder).toContain("final answer");
    // Soft/optional phrasing — must NOT use the mandatory multi-quantity
    // push, which would override the model's judgment on whether it's
    // actually done researching.
    expect(result.actReminder).not.toContain("FINAL ANSWER");
  });

  it("sends the nudge only once — state.meta.completionNudgeSent suppresses repeats", () => {
    const state = {
      ...baseState(),
      meta: { ...baseState().meta, completionNudgeSent: true },
    };
    const obsStep = makeStep("observation", "[http-get result] 200 OK", { toolCallId: "tc1", observationResult: makeObservationResult("http-get", true, "[http-get result] 200 OK") });
    const allSteps = [
      makeStep("action", "[ACT] http-get", { toolCall: { id: "tc1", name: "http-get", arguments: {} } }),
      obsStep,
    ];
    const contextWithRequiredTools: KernelContext = {
      ...context,
      input: { ...context.input, requiredTools: ["http-get"] },
    };

    const result = assembleConversation({
      state,
      context: contextWithRequiredTools,
      adapter,
      allSteps,
      normalizedPendingCalls: [{ id: "tc1", name: "http-get", arguments: {} }],
      newToolsUsed: new Set(["http-get"]),
      sharedScratchpad: new Map(),
    });

    expect(result.actReminder).toBeUndefined();
  });

  it("sends the finish nudge even with no requiredTools contract, once any tool succeeds", () => {
    // Live QA repro, 2026-08-16: gemma4:e4b, `.run('Whats the price of XRP
    // and bitcoin?')` — no `.withRequiredTools()`, no task-level tools
    // contract. It called crypto-price, got real data, then stopped without
    // writing a closing sentence, because reqTools.length === 0 skipped this
    // whole nudge branch outright regardless of tool use. The harness had to
    // fall back to harness_deliverable + an extra output-gate LLM resynthesis
    // call for what should have been the model's own one-line answer.
    const state = baseState();
    const obsStep = makeStep("observation", "[crypto-price result] BTC $63,093", {
      toolCallId: "tc1",
      observationResult: makeObservationResult("crypto-price", true, "[crypto-price result] BTC $63,093"),
    });
    const allSteps = [
      makeStep("action", "[ACT] crypto-price", { toolCall: { id: "tc1", name: "crypto-price", arguments: {} } }),
      obsStep,
    ];
    // No requiredTools in context.input at all — the plain bare-.run() shape.

    const result = assembleConversation({
      state,
      context,
      adapter,
      allSteps,
      normalizedPendingCalls: [{ id: "tc1", name: "crypto-price", arguments: {} }],
      newToolsUsed: new Set(["crypto-price"]),
      sharedScratchpad: new Map(),
    });

    expect(result.completionNudgeSent).toBe(true);
    expect(result.actReminder).toBeDefined();
    expect(result.actReminder).toContain("You have tool results above");
    expect(result.actReminder).toContain("final answer");
  });

  it("does NOT send any nudge when no tools were used at all (nothing to finish from)", () => {
    const state = baseState();
    // No tool calls this turn — assembleConversation's early-return for
    // zero toolCallsForHistory already covers this, but pin it explicitly
    // so the no-contract broadening above can't accidentally regress it.
    const result = assembleConversation({
      state,
      context,
      adapter,
      allSteps: [],
      normalizedPendingCalls: [],
      newToolsUsed: new Set(),
      sharedScratchpad: new Map(),
    });

    expect(result.actReminder).toBeUndefined();
    expect(result.completionNudgeSent).toBe(false);
  });
});
