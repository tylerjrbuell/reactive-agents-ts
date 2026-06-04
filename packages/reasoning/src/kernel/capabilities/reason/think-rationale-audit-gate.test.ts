// Run: bun test packages/reasoning/src/kernel/capabilities/reason/think-rationale-audit-gate.test.ts
//
// Opt-in rationale-audit gate (owner decision, 2026-06-04):
// The "## Decision Rationale (MANDATORY — every tool call)" block in the reactive
// think phase (think.ts) instructs the model to emit a <rationale> block before
// every tool call. It is an AUDIT feature (captures the "why" → rationaleLog →
// debrief), NOT a performance feature, and forces extra OUTPUT tokens per tool
// call on the decode-bound local tier. So it is gated OPT-IN:
//   emit ONLY when `input.auditRationale === true` OR `RA_RATIONALE_AUDIT === "1"`.
// Default (neither set) = NOT emitted.
//
// Seam: handleThinking carries the fully-assembled `systemPromptWithDriver`
// (including the rationale block) to `hooks.onThought(state, thought, {system})`
// at think.ts:914. We run the real think phase against a stub LLMService and a
// capturing onThought hook, then assert on the captured `system` prompt — this
// drives the REAL assembly with zero production restructure.
//
// Co-located inside packages/reasoning/src/kernel/** (kernel-warden authority).

import { describe, it, expect, afterEach } from "bun:test";
import { Effect, Layer, Stream } from "effect";
import { LLMService } from "@reactive-agents/llm-provider";
import type { StreamEvent } from "@reactive-agents/llm-provider";
import { NativeFCDriver } from "@reactive-agents/tools";
import { handleThinking } from "./think.js";
import {
  initialKernelState,
  noopHooks,
  type KernelContext,
  type KernelInput,
  type KernelState,
} from "../../state/kernel-state.js";
import { CONTEXT_PROFILES } from "../../../context/context-profile.js";
import type { ToolSchema } from "../attend/tool-formatting.js";

const RATIONALE_MARKER = "Decision Rationale (MANDATORY";

// A no-tool-call response — handleThinking reaches the onThought hook before any
// fast-path exit, so the assembled system prompt is captured regardless.
const cannedStreamEvents: readonly StreamEvent[] = [
  { type: "text_delta", text: "Considering the task." },
  { type: "content_complete", content: "Considering the task." },
  {
    type: "usage",
    usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12, estimatedCost: 0 },
  },
];

const stubLLM = Layer.succeed(LLMService, {
  complete: () =>
    Effect.succeed({
      content: "ok",
      stopReason: "end_turn",
      usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12, estimatedCost: 0 },
      model: "test-model",
    }) as any,
  stream: () => Effect.succeed(Stream.fromIterable(cannedStreamEvents) as any),
  completeStructured: () => Effect.succeed({ ok: true }) as any,
  embed: () => Effect.succeed([]),
  countTokens: () => Effect.succeed(0),
  getModelConfig: () => Effect.succeed({} as any),
  getStructuredOutputCapabilities: () => Effect.succeed({} as any),
  capabilities: () => Effect.succeed({} as any),
} as any);

const toolSchema: ToolSchema = {
  name: "file-write",
  description: "Write a file to disk.",
  parameters: [{ name: "path", type: "string", required: true }],
};

const makeContext = (input: KernelInput): KernelContext => ({
  input,
  profile: CONTEXT_PROFILES.local,
  compression: { budget: 800, previewItems: 5, autoStore: true, codeTransform: true },
  toolService: { _tag: "None" },
  hooks: noopHooks,
  toolCallingDriver: new NativeFCDriver(),
  memoryService: { _tag: "None" },
});

// Capture the assembled system prompt that the think phase hands to onThought.
const captureThinkSystemPrompt = async (input: KernelInput): Promise<string> => {
  let captured = "";
  const hooks = {
    ...noopHooks,
    onThought: (_s: KernelState, _t: string, prompt?: { system: string }) => {
      captured = prompt?.system ?? "";
      return Effect.void;
    },
  };
  const baseCtx = makeContext(input);
  const context: KernelContext = { ...baseCtx, hooks };
  const state: KernelState = {
    ...initialKernelState({ strategy: "reactive", kernelType: "reactive", maxIterations: 8 }),
    messages: [{ role: "user", content: "Write the config file." }],
  };
  await Effect.runPromise(handleThinking(state, context).pipe(Effect.provide(stubLLM)));
  return captured;
};

const baseInput = (extra: Partial<KernelInput> = {}): KernelInput => ({
  task: "Write the config file.",
  availableToolSchemas: [toolSchema],
  ...extra,
});

afterEach(() => {
  delete process.env.RA_RATIONALE_AUDIT;
});

describe("reactive think phase — opt-in rationale-audit gate", () => {
  it("DEFAULT (auditRationale unset, no env): the prompt OMITS the rationale instructions", async () => {
    delete process.env.RA_RATIONALE_AUDIT;
    const system = await captureThinkSystemPrompt(baseInput());
    expect(system).not.toContain(RATIONALE_MARKER);
  });

  it("auditRationale=true: the prompt CONTAINS the rationale instructions", async () => {
    delete process.env.RA_RATIONALE_AUDIT;
    const system = await captureThinkSystemPrompt(baseInput({ auditRationale: true }));
    expect(system).toContain(RATIONALE_MARKER);
  });

  it("RA_RATIONALE_AUDIT=1 (env override, field unset): the prompt CONTAINS the rationale instructions", async () => {
    const prev = process.env.RA_RATIONALE_AUDIT;
    process.env.RA_RATIONALE_AUDIT = "1";
    try {
      const system = await captureThinkSystemPrompt(baseInput());
      expect(system).toContain(RATIONALE_MARKER);
    } finally {
      if (prev === undefined) delete process.env.RA_RATIONALE_AUDIT;
      else process.env.RA_RATIONALE_AUDIT = prev;
    }
  });

  it("auditRationale=false explicitly: the prompt OMITS the rationale instructions", async () => {
    delete process.env.RA_RATIONALE_AUDIT;
    const system = await captureThinkSystemPrompt(baseInput({ auditRationale: false }));
    expect(system).not.toContain(RATIONALE_MARKER);
  });
});
