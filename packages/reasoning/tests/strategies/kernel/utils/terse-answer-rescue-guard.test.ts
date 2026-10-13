// Run: bun test packages/reasoning/tests/strategies/kernel/utils/terse-answer-rescue-guard.test.ts --timeout 15000
/**
 * W1.5-defect — terse-answer rescue guard (kernel-warden fix wave).
 *
 * Live signature (post-w1 S2 capture, commit 909a1b98; fixtures/post-w1/
 * MANIFEST.md rows 1-5): 5/5 runs had visible content '3052' at natural stop
 * (end_turn) with 6-9.5K chars of UNLABELED reasoning prose in the thinking
 * channel (no FINAL ANSWER / ACTION / code-block markers). The W1.3-activated
 * rescue guard fell through `rescueFromThinking` branches 1-3 to branch 4
 * ("last 1-2 substantive paragraphs of thinking") and shipped a 525-1,915-
 * char mid-sentence reasoning tail as the deliverable, destroying the model's
 * correct terse answer.
 *
 * The fix gate (deterministic, Golden Rule 5 — computed from the stop reason
 * already on the exchange, no LLM judgment): branch 4 may only override a
 * NON-EMPTY visible answer when the exchange was TRUNCATED (max_tokens /
 * stop_sequence). Structured rescues (branches 1-3: the model's own explicit
 * markers) and the empty-visible-content starved path are unaffected —
 * pinned by the W1.3 consumption arms in thinking-channel-consumption.
 * test.ts next door.
 */
import { describe, it, expect } from "bun:test";
import { Effect, Layer, Stream } from "effect";
import { LLMService } from "@reactive-agents/llm-provider";
import type {
  CompletionRequest,
  CompletionResponse,
  StreamEvent,
  StructuredCompletionRequest,
} from "@reactive-agents/llm-provider";
import { handleThinking } from "../../../../src/kernel/capabilities/reason/think.js";
import { rescueFromThinking } from "../../../../src/kernel/utils/stream-parser.js";
import {
  noopHooks,
  type KernelContext,
  type KernelState,
} from "../../../../src/kernel/state/kernel-state.js";
import { CONTEXT_PROFILES } from "../../../../src/context/context-profile.js";
import { TextParseDriver } from "@reactive-agents/tools";

// ── State/context factories (mirrors thinking-channel-consumption.test.ts) ──

function makeState(): KernelState {
  return {
    taskId: "test-task",
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
    meta: { maxIterations: 10 },
    controllerDecisionLog: [],
    messages: [],
  };
}

function makeContext(): KernelContext {
  return {
    input: {
      // The S2 task spec shape: demands ONLY the final number.
      task: "Compute the total and reply with ONLY the final number.",
      availableToolSchemas: [],
    },
    profile: CONTEXT_PROFILES["mid"],
    compression: {
      enabled: false,
      maxResultChars: 4000,
      previewLines: 10,
      arrayPreviewItems: 5,
    },
    toolService: { _tag: "None" },
    hooks: noopHooks,
    toolCallingDriver: new TextParseDriver(),
  };
}

function makeStreamLayer(events: readonly StreamEvent[]): Layer.Layer<LLMService> {
  return Layer.succeed(
    LLMService,
    LLMService.of({
      complete: (_request: CompletionRequest) =>
        Effect.succeed<CompletionResponse>({
          content: "",
          stopReason: "end_turn",
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCost: 0 },
          model: "test",
        }),
      stream: (_request: CompletionRequest) => Effect.succeed(Stream.fromIterable(events)),
      completeStructured: <A>(_request: StructuredCompletionRequest<A>) =>
        Effect.die("unused in terse-answer guard test"),
      embed: (texts: readonly string[]) =>
        Effect.succeed(texts.map(() => new Array<number>(768).fill(0))),
      countTokens: (messages: readonly unknown[]) => Effect.succeed(messages.length * 10),
      getModelConfig: () => Effect.succeed({ provider: "ollama", model: "qwen3:4b" }),
      getStructuredOutputCapabilities: () =>
        Effect.succeed({
          nativeJsonMode: false,
          jsonSchemaEnforcement: false,
          prefillSupport: false,
          grammarConstraints: false,
        }),
      capabilities: () =>
        Effect.succeed({
          supportsToolCalling: false,
          supportsStreaming: true,
          supportsSystemPrompt: true,
          supportsLogprobs: false,
          supportsNativeStreaming: true,
          supportsPromptCaching: false,
        }),
    }),
  );
}

// ── Fixture mirroring the post-w1 S2 trace excerpt shape ─────────────────────
// (wiki/.../fixtures/post-w1/01M4T3HP...jsonl, condensed): unlabeled math
// prose with > 80-char paragraphs, NO FINAL ANSWER marker, NO ACTION line,
// NO code block. Branch 4's regex would return the tail below.

const S2_LIKE_THINKING =
  "Okay, let me work through this grain problem step by step. The customer starts with 143 crates, " +
  "three arrive damaged, so that leaves 140 usable. Then they buy half of all remaining grain on " +
  "Tuesday, which is 813 units, so the total after Tuesday is 1626. " +
  "Wait, but maybe the damaged crates were never part of the 143? Let me recompute the half. " +
  "Half of 1626 is 813, add the initial 1423 and I get 2236, minus the 48 refund leaves 2188. " +
  "Actually no, I mixed up the weeks. Restart: Monday 1240, Tuesday doubled to 2480, Wednesday the " +
  "crates shipped 716 away leaving 1764, Thursday they paid half again which is 882, and 882 plus " +
  "the 2170 carryover gives 3052. So, that's what they pay on Thursday. Therefore, the answer is " +
  "3052. But I need to check if that's correct. Alternatively, maybe the 3 damaged crates are not " +
  "part of the 143? But that reading seems unnatural given the phrasing about shipments arriving " +
  "after the initial inventory, so my first interpretation should stand and I should just present " +
  "the number the task asked for, which is 3052.";

const VISIBLE_ANSWER = "3052";

function runThink(events: readonly StreamEvent[]): Promise<KernelState> {
  return Effect.runPromise(
    handleThinking(makeState(), makeContext()).pipe(Effect.provide(makeStreamLayer(events))),
  );
}

function thoughtStepContent(state: KernelState): string | null {
  const step = state.steps.find((s) => s.type === "thought");
  return step ? step.content : null;
}

// ── Defect arm: live S2 shape through the kernel seam ───────────────────────

describe("W1.5 defect — terse answer survives end_turn thinking", () => {
  it("visible '3052' + unlabeled reasoning thinking at end_turn → thought STAYS '3052'", async () => {
    const events: readonly StreamEvent[] = [
      { type: "thinking_delta", thinking: S2_LIKE_THINKING },
      { type: "text_delta", text: VISIBLE_ANSWER },
      { type: "content_complete", content: VISIBLE_ANSWER },
      {
        type: "usage",
        usage: { inputTokens: 310, outputTokens: 2866, totalTokens: 3176, estimatedCost: 0 },
      },
    ];

    const state = await runThink(events);
    const content = thoughtStepContent(state);

    // At HEAD (pre-gate) this is branch-4 prose (525-1,915 ch reasoning tail,
    // 5/5 in the live capture). Post-gate the correct visible answer survives.
    expect(content).toBe(VISIBLE_ANSWER);
    // The thinking itself is NOT lost: W1.3 metadata stamp still records it.
    const step = state.steps.find((s) => s.type === "thought");
    expect(step?.metadata?.thinking).toBe(S2_LIKE_THINKING);
  }, 15000);
});

// ── Design-shape arms: rescue stays reachable for its real targets ──────────

describe("W1.5 defect — rescue design shapes preserved", () => {
  it("truncated exchange (stop_sequence) + short visible + answer only in thinking prose → branch 4 still rescues", async () => {
    // The brief's design shape: exchange cut before the model finished the
    // visible answer, conclusion only in thinking prose. stop_sequence (not
    // max_tokens, which exits into token-budget recovery before rescue)
    // marks the truncation at the rescue site.
    const events: readonly StreamEvent[] = [
      { type: "thinking_delta", thinking: S2_LIKE_THINKING },
      { type: "text_delta", text: "30" },
      { type: "content_complete", content: "30", stopReason: "stop_sequence" },
      {
        type: "usage",
        usage: { inputTokens: 310, outputTokens: 2866, totalTokens: 3176, estimatedCost: 0 },
      },
    ];

    const state = await runThink(events);
    const content = thoughtStepContent(state);

    // Rescue FIRES for the truncated shape: the thinking's substantive tail
    // replaces the cut-off visible fragment.
    expect(content).not.toBe("30");
    expect(content).toContain("3052");
    expect((content ?? "").length).toBeGreaterThan(80);
  }, 15000);
});

// ── Unit arms on the gate itself ─────────────────────────────────────────────

describe("W1.5 defect — rescueFromThinking branch-4 gate (unit)", () => {
  it("non-empty content + NOT truncated → prose branch yields null (answer survives)", () => {
    expect(rescueFromThinking(S2_LIKE_THINKING, VISIBLE_ANSWER)).toBeNull();
  }, 15000);

  it("non-empty content + truncated → prose branch still returns the conclusion tail", () => {
    const rescued = rescueFromThinking(S2_LIKE_THINKING, "30", { exchangeTruncated: true });
    expect(rescued).not.toBeNull();
    expect(rescued).toContain("3052");
  }, 15000);

  it("EMPTY content → prose branch remains reachable (starved shape, unchanged)", () => {
    const rescued = rescueFromThinking(S2_LIKE_THINKING, "");
    expect(rescued).not.toBeNull();
    expect(rescued).toContain("3052");
  }, 15000);

  it("structured markers (branches 1-3) are NEVER gated: FA / code-block rescues fire at end_turn with non-empty content", () => {
    // Branch 1: explicit FINAL ANSWER marker.
    const faThinking =
      "Let me reason about this at length for well over a hundred characters to pass the " +
      "length gate, and then conclude: FINAL ANSWER: 42";
    expect(rescueFromThinking(faThinking, "Sure")).toBe("FINAL ANSWER: 42");
    // Branch 3: code block IS the answer.
    const codeThinking =
      "Reasoning at length here first to clear one hundred characters for the gate. " +
      "```python\nprint(3052)\n```";
    expect(rescueFromThinking(codeThinking, "Sure")).toContain("print(3052)");
  }, 15000);
});
