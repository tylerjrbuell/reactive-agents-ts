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
