import { derived, type Readable } from "svelte/store";
import type { RunState } from "./run-store.js";

export interface ConvMessage {
  readonly role: string;
  readonly content: string;
}

export interface IterationFrame {
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
  readonly durationMs: number;
  readonly ts: number;
  readonly kind?: "step" | "final";
  /** Tool names called this iteration (from ReasoningIterationProgress.toolsThisStep) */
  readonly toolsThisStep?: readonly string[];
  /** Model/provider used for this iteration */
  readonly model?: string;
  readonly provider?: string;
  readonly estimatedCost?: number;
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
      m && typeof m === "object" && typeof (m as any).role === "string",
    )
    .map((m) => ({
      role: m.role as string,
      content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
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
  return derived(runState, ($state): IterationFrame[] => {
    const frames: IterationFrame[] = [];

    // Carry values collected between iteration boundaries
    let carryEntropy: number | undefined;
    let carryTokens = 0;
    let carryDurationMs = 0;
    let carryTs = 0;
    let carryModel: string | undefined;
    let carryProvider: string | undefined;
    let carryCost = 0;

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
          const dur = typeof p.durationMs === "number" ? p.durationMs : 0;
          if (dur > carryDurationMs) carryDurationMs = dur;
          if (typeof p.model === "string" && p.model) carryModel = p.model;
          if (typeof p.provider === "string" && p.provider) carryProvider = p.provider;
          if (typeof p.estimatedCost === "number") carryCost += p.estimatedCost;
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
          const thought = typeof p.thought === "string" ? p.thought.trim() : "";
          const action = typeof p.action === "string" ? p.action.trim() : "";
          const obs = typeof p.observation === "string" ? p.observation.trim() : "";
          const raw = typeof p.rawResponse === "string" ? p.rawResponse.trim() : "";
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

          frames.push({
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
            durationMs: carryDurationMs,
            ts: msg.ts || carryTs,
            kind: "step",
            toolsThisStep,
            model: carryModel,
            provider: carryProvider,
            estimatedCost: carryCost > 0 ? carryCost : undefined,
          });

          // Reset all carries
          carryTokens = 0;
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
          const answer = typeof p.answer === "string" ? p.answer.trim() : "";
          if (!answer) break;

          const iteration =
            typeof p.iteration === "number"
              ? p.iteration
              : frames.length > 0
                ? (frames[frames.length - 1]?.iteration ?? 0) + 1
                : 1;

          frames.push({
            iteration,
            thought: answer,
            rawResponse: carryRawResponse || undefined,
            messages: carryMessages,
            tokensUsed: typeof p.totalTokens === "number" ? p.totalTokens : carryTokens,
            durationMs: carryDurationMs,
            ts: msg.ts || carryTs,
            kind: "final",
            model: carryModel,
            provider: carryProvider,
          });

          carryTokens = 0;
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
