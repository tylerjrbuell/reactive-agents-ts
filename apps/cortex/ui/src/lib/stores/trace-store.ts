import { derived, type Readable } from "svelte/store";
import { throughputOfCalls, type Throughput, type ThroughputSample } from "@reactive-agents/ui-core";
import type { RunState } from "./run-store.js";
import { throughputSampleOf } from "../llm-throughput.js";

/** `llmCalls` + `throughput` for a frame, or nothing when the loop made no timed call. */
function speedOf(calls: readonly ThroughputSample[]): Pick<CortexTraceFrame, "llmCalls" | "throughput"> {
  if (calls.length === 0) return {};
  const throughput = throughputOfCalls(calls);
  return { llmCalls: calls, ...(throughput ? { throughput } : {}) };
}

export interface ConvMessage {
  readonly role: string;
  readonly content: string;
}

export interface CortexTraceFrame {
  readonly iteration: number;
  /** Human-readable summary: tool list or "(reasoning)" */
  readonly thought: string;
  /** Raw LLM thinking text from ReasoningStepCompleted.thought */
  readonly llmThought?: string;
  /** Raw LLM response before parsing (ReasoningStepCompleted.rawResponse) */
  readonly rawResponse?: string;
  /** Full conversation messages sent to LLM (RSC.messages) */
  readonly messages?: readonly ConvMessage[];
  /** Action/tool invocation text from RSC.action */
  readonly action?: string;
  /** Tool result / observation from RSC.observation */
  readonly observation?: string;
  readonly toolName?: string;
  readonly toolArgs?: unknown;
  readonly entropy?: number;
  readonly tokensUsed: number;
  readonly tokensIn?: number;
  readonly tokensOut?: number;
  readonly billedTokens?: number;
  readonly reasoningTokens?: number;
  readonly durationMs: number;
  readonly ts: number;
  readonly kind?: "step" | "final";
  /** Tool names called this iteration (from ReasoningIterationProgress.toolsThisStep) */
  readonly toolsThisStep?: readonly string[];
  /** Model/provider used for this iteration */
  readonly model?: string;
  readonly provider?: string;
  readonly estimatedCost?: number;
  /** This loop's LLM calls' throughput fields (`LLMRequestCompleted` durationMs / tokensOut / firstTokenMs). */
  readonly llmCalls?: readonly ThroughputSample[];
  /** Output speed and time to first token over `llmCalls` (ui-core `throughputOfCalls`); absent when no call gives a rate. */
  readonly throughput?: Throughput;
}

/** Backward-compatible alias — prefer `CortexTraceFrame` in UI code. */
export type IterationFrame = CortexTraceFrame;

/** Per-field ceiling on text kept in trace frames — a runaway tool result or answer must not bloat every re-derive. */
export const FRAME_TEXT_CAP = 200_000;

/** Cap a string for storage in a frame, leaving an explicit marker when it was cut. */
export function capFrameText(text: string, cap = FRAME_TEXT_CAP): string {
  return text.length > cap ? `${text.slice(0, cap)}\n…[truncated ${text.length - cap} chars]` : text;
}

function readTokens(p: Record<string, unknown>): number {
  const raw = p.tokensUsed;
  if (typeof raw === "number") return raw;
  if (raw && typeof raw === "object" && "total" in raw && typeof (raw as { total: unknown }).total === "number") {
    return (raw as { total: number }).total;
  }
  return 0;
}

function safeMessages(raw: unknown): readonly ConvMessage[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const msgs = raw
    .filter((m): m is { role: string; content: string } =>
      m && typeof m === "object" && typeof (m as { role?: unknown }).role === "string",
    )
    .map((m) => ({
      role: m.role as string,
      content: capFrameText(typeof m.content === "string" ? m.content : JSON.stringify(m.content)),
    }));
  return msgs.length > 0 ? msgs : undefined;
}

/**
 * Derives rich, expandable trace rows from framework events.
 *
 * Data sources (in priority order):
 *
 * 1. `ReasoningStepCompleted` — carries thought, action, observation, rawResponse, messages
 *    when emitted by the main reasoning kernel. Internal sub-system events (structured-output,
 *    classify-tool-relevance) are excluded by the server's IGNORED_INTERNAL_RUN_IDS filter.
 *
 * 2. `ReasoningIterationProgress` — provides iteration number, toolsThisStep, max iterations.
 *    Creates the frame boundary — one frame per Think→Act→Observe cycle.
 *
 * 3. `LLMRequestCompleted` — provides tokensUsed, durationMs, model, provider, estimatedCost.
 *
 * 4. `ToolCallCompleted` — provides tool latency.
 *
 * 5. `FinalAnswerProduced` — creates a "final" frame with the answer text.
 *
 * 6. `EntropyScored` — provides entropy value for each frame.
 */
export function createTraceStore(runState: Readable<RunState>) {
  return derived(runState, ($state): CortexTraceFrame[] => {
    const frames: CortexTraceFrame[] = [];

    // Carry values collected between iteration boundaries
    let carryEntropy: number | undefined;
    let carryTokens = 0;
    let carryTokensIn: number | undefined;
    let carryTokensOut: number | undefined;
    let carryBilled: number | undefined;
    let carryReasoning: number | undefined;
    let carryDurationMs = 0;
    let carryTs = 0;
    let carryModel: string | undefined;
    let carryProvider: string | undefined;
    let carryCost = 0;
    let carryCalls: ThroughputSample[] = [];

    // Rich content from ReasoningStepCompleted
    let carryLlmThought = "";
    let carryRawResponse = "";
    let carryMessages: readonly ConvMessage[] | undefined;
    let carryAction = "";
    let carryObservation = "";

    for (const msg of $state.events) {
      const p = msg.payload;

      switch (msg.type) {
        // ── Entropy ───────────────────────────────────────────────────────────
        case "EntropyScored":
          if (typeof p.composite === "number") carryEntropy = p.composite;
          break;

        // ── LLM call metrics ──────────────────────────────────────────────────
        case "LLMRequestCompleted": {
          carryTokens += readTokens(p);
          if (typeof p.tokensIn === "number") carryTokensIn = (carryTokensIn ?? 0) + p.tokensIn;
          if (typeof p.tokensOut === "number") carryTokensOut = (carryTokensOut ?? 0) + p.tokensOut;
          if (typeof p.billedTokens === "number") carryBilled = (carryBilled ?? 0) + p.billedTokens;
          if (typeof p.reasoningTokens === "number") carryReasoning = (carryReasoning ?? 0) + p.reasoningTokens;
          const dur = typeof p.durationMs === "number" ? p.durationMs : 0;
          if (dur > carryDurationMs) carryDurationMs = dur;
          if (typeof p.model === "string" && p.model) carryModel = p.model;
          if (typeof p.provider === "string" && p.provider) carryProvider = p.provider;
          if (typeof p.estimatedCost === "number") carryCost += p.estimatedCost;
          const sample = throughputSampleOf(p);
          if (sample) carryCalls.push(sample);
          carryTs = msg.ts;
          break;
        }

        // ── Tool duration ─────────────────────────────────────────────────────
        case "ToolCallCompleted": {
          const dur = typeof p.durationMs === "number" ? p.durationMs : 0;
          if (dur > 0) carryDurationMs = Math.max(carryDurationMs, dur);
          carryTs = msg.ts;
          break;
        }

        // ── Rich reasoning content ────────────────────────────────────────────
        // ReasoningStepCompleted from the MAIN task carries thought/action/observation/rawResponse.
        // Internal subsystem events (structured-output etc.) are filtered server-side before
        // reaching this store, so all RSC events here are from the agent's real reasoning.
        case "ReasoningStepCompleted": {
          const thought = typeof p.thought === "string" ? capFrameText(p.thought.trim()) : "";
          const action = typeof p.action === "string" ? capFrameText(p.action.trim()) : "";
          const obs = typeof p.observation === "string" ? capFrameText(p.observation.trim()) : "";
          const raw = typeof p.rawResponse === "string" ? capFrameText(p.rawResponse.trim()) : "";
          const msgs = safeMessages(p.messages);

          // Skip internal events that have no reasoning content
          if (!thought && !action && !obs && !raw && !msgs) break;

          // Accumulate — multiple RSC events can fire per iteration
          if (thought) carryLlmThought = thought;
          if (action) carryAction = action;
          if (obs) carryObservation = obs;
          if (raw) carryRawResponse = raw;
          if (msgs) carryMessages = msgs;
          break;
        }

        // ── PRIMARY iteration boundary ────────────────────────────────────────
        case "ReasoningIterationProgress": {
          const iteration = typeof p.iteration === "number" ? p.iteration : frames.length + 1;
          const toolsThisStep: string[] = Array.isArray(p.toolsThisStep)
            ? (p.toolsThisStep as string[]).filter((t) => typeof t === "string")
            : [];

          // Build the summary thought text
          const thought =
            carryLlmThought ||
            (toolsThisStep.length > 0
              ? `Used: ${toolsThisStep.join(", ")}`
              : carryTokens > 0
                ? "(reasoning — no tools)"
                : "(thinking)");

          // The kernel can report one iteration twice (after its tools, then
          // after the next think, same `iteration`): fold the pair into one
          // row so the trace shows one row per loop, never `Loop 1` twice.
          const prev = frames[frames.length - 1];
          if (prev && prev.kind === "step" && prev.iteration === iteration) {
            const tools = [...(prev.toolsThisStep ?? []), ...toolsThisStep];
            const llm = carryLlmThought || prev.llmThought || "";
            frames[frames.length - 1] = {
              ...prev,
              thought:
                llm ||
                (tools.length > 0 ? `Used: ${tools.join(", ")}` : prev.thought),
              llmThought: llm || undefined,
              rawResponse: carryRawResponse || prev.rawResponse,
              messages: carryMessages ?? prev.messages,
              action: carryAction || prev.action,
              observation: carryObservation || prev.observation,
              toolName: tools.length === 1 ? tools[0] : undefined,
              toolArgs: tools.length > 1 ? tools.join(", ") : undefined,
              entropy: carryEntropy ?? prev.entropy,
              tokensUsed: prev.tokensUsed + carryTokens,
              ...(carryTokensIn !== undefined ? { tokensIn: (prev.tokensIn ?? 0) + carryTokensIn } : {}),
              ...(carryTokensOut !== undefined ? { tokensOut: (prev.tokensOut ?? 0) + carryTokensOut } : {}),
              ...(carryBilled !== undefined ? { billedTokens: (prev.billedTokens ?? 0) + carryBilled } : {}),
              ...(carryReasoning !== undefined ? { reasoningTokens: (prev.reasoningTokens ?? 0) + carryReasoning } : {}),
              durationMs: Math.max(prev.durationMs, carryDurationMs),
              ts: msg.ts || carryTs || prev.ts,
              toolsThisStep: tools,
              model: carryModel ?? prev.model,
              provider: carryProvider ?? prev.provider,
              estimatedCost: (prev.estimatedCost ?? 0) + carryCost > 0 ? (prev.estimatedCost ?? 0) + carryCost : undefined,
              ...speedOf([...(prev.llmCalls ?? []), ...carryCalls]),
            };
          } else frames.push({
            iteration,
            thought,
            llmThought: carryLlmThought || undefined,
            rawResponse: carryRawResponse || undefined,
            messages: carryMessages,
            action: carryAction || undefined,
            observation: carryObservation || undefined,
            toolName: toolsThisStep.length === 1 ? toolsThisStep[0] : undefined,
            toolArgs: toolsThisStep.length > 1 ? toolsThisStep.join(", ") : undefined,
            entropy: carryEntropy,
            tokensUsed: carryTokens,
            ...(carryTokensIn !== undefined ? { tokensIn: carryTokensIn } : {}),
            ...(carryTokensOut !== undefined ? { tokensOut: carryTokensOut } : {}),
            ...(carryBilled !== undefined ? { billedTokens: carryBilled } : {}),
            ...(carryReasoning !== undefined ? { reasoningTokens: carryReasoning } : {}),
            durationMs: carryDurationMs,
            ts: msg.ts || carryTs,
            kind: "step",
            toolsThisStep,
            model: carryModel,
            provider: carryProvider,
            estimatedCost: carryCost > 0 ? carryCost : undefined,
            ...speedOf(carryCalls),
          });

          // Reset all carries
          carryCalls = [];
          carryTokens = 0;
          carryTokensIn = undefined;
          carryTokensOut = undefined;
          carryBilled = undefined;
          carryReasoning = undefined;
          carryDurationMs = 0;
          carryEntropy = undefined;
          carryCost = 0;
          carryLlmThought = "";
          carryRawResponse = "";
          carryMessages = undefined;
          carryAction = "";
          carryObservation = "";
          break;
        }

        // ── Final answer ──────────────────────────────────────────────────────
        case "FinalAnswerProduced": {
          const answer = typeof p.answer === "string" ? capFrameText(p.answer.trim()) : "";
          if (!answer) break;

          // If a more substantial final frame already exists (e.g. plan-execute synthesis),
          // don't replace it with a shorter verification-pass response ("PASS" / "REVISE: …").
          const existingFinalIdx = frames.findLastIndex((f) => f.kind === "final");
          if (existingFinalIdx >= 0 && (frames[existingFinalIdx]?.thought.length ?? 0) > answer.length) break;

          const iteration =
            typeof p.iteration === "number"
              ? p.iteration
              : frames.length > 0
                ? (frames[frames.length - 1]?.iteration ?? 0) + 1
                : 1;

          const newFrame: CortexTraceFrame = {
            iteration,
            thought: answer,
            rawResponse: carryRawResponse || undefined,
            messages: carryMessages,
            tokensUsed: typeof p.totalTokens === "number" ? p.totalTokens : carryTokens,
            ...(carryTokensIn !== undefined ? { tokensIn: carryTokensIn } : {}),
            ...(carryTokensOut !== undefined ? { tokensOut: carryTokensOut } : {}),
            ...(carryBilled !== undefined ? { billedTokens: carryBilled } : {}),
            ...(carryReasoning !== undefined ? { reasoningTokens: carryReasoning } : {}),
            durationMs: carryDurationMs,
            ts: msg.ts || carryTs,
            kind: "final",
            model: carryModel,
            provider: carryProvider,
            ...speedOf(carryCalls),
          };

          if (existingFinalIdx >= 0) {
            frames[existingFinalIdx] = newFrame;
          } else {
            frames.push(newFrame);
          }

          carryCalls = [];
          carryTokens = 0;
          carryTokensIn = undefined;
          carryTokensOut = undefined;
          carryBilled = undefined;
          carryReasoning = undefined;
          carryDurationMs = 0;
          carryRawResponse = "";
          carryMessages = undefined;
          break;
        }

        default:
          break;
      }
    }

    return frames;
  });
}

export type TraceStore = ReturnType<typeof createTraceStore>;
