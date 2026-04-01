import { derived, type Readable } from "svelte/store";
import type { RunState } from "./run-store.js";

export interface IterationFrame {
  readonly iteration: number;
  readonly thought: string;
  readonly toolName?: string;
  readonly toolArgs?: unknown;
  readonly observation?: string;
  readonly entropy?: number;
  readonly tokensUsed: number;
  readonly durationMs: number;
  readonly ts: number;
  readonly kind?: "step" | "final";
  /** Tool names called this iteration (from ReasoningIterationProgress.toolsThisStep) */
  readonly toolsThisStep?: readonly string[];
}

function readTokens(p: Record<string, unknown>): number {
  const raw = p.tokensUsed;
  if (typeof raw === "number") return raw;
  if (raw && typeof raw === "object" && "total" in raw && typeof (raw as { total: unknown }).total === "number") {
    return (raw as { total: number }).total;
  }
  return 0;
}

/**
 * Derives human-readable trace rows from framework events.
 *
 * Primary event: `ReasoningIterationProgress` — one frame per Think→Act→Observe cycle.
 *   - iteration: p.iteration (1-based from the kernel)
 *   - toolsThisStep: p.toolsThisStep (tool names called this iteration)
 *
 * Secondary: `FinalAnswerProduced` — a "final" kind frame with the answer text.
 *
 * `ReasoningStepCompleted` from internal subsystems (structured-output, infer-required-tools,
 * classify-tool-relevance, adaptive) is intentionally NOT used for trace frames because those
 * events carry step metadata but not agent reasoning content.
 */
export function createTraceStore(runState: Readable<RunState>) {
  return derived(runState, ($state): IterationFrame[] => {
    const frames: IterationFrame[] = [];
    let carryEntropy: number | undefined;
    let carryTokens = 0;
    let carryDurationMs = 0;
    let carryTs = 0;

    for (const msg of $state.events) {
      const p = msg.payload;

      switch (msg.type) {
        // ── Carry: entropy scored during this iteration ───────────────────────
        case "EntropyScored":
          if (typeof p.composite === "number") carryEntropy = p.composite;
          break;

        // ── Carry: tokens + LLM latency ──────────────────────────────────────
        case "LLMRequestCompleted": {
          carryTokens += readTokens(p);
          const dur = typeof p.durationMs === "number" ? p.durationMs : 0;
          if (dur > carryDurationMs) carryDurationMs = dur;
          carryTs = msg.ts;
          break;
        }

        // ── Carry: tool call duration ─────────────────────────────────────────
        case "ToolCallCompleted": {
          const dur = typeof p.durationMs === "number" ? p.durationMs : 0;
          if (dur > 0) carryDurationMs = Math.max(carryDurationMs, dur);
          carryTs = msg.ts;
          break;
        }

        // ── PRIMARY: one frame per Think→Act→Observe cycle ───────────────────
        case "ReasoningIterationProgress": {
          const iteration = typeof p.iteration === "number" ? p.iteration : frames.length + 1;
          const toolsThisStep: string[] = Array.isArray(p.toolsThisStep)
            ? (p.toolsThisStep as string[]).filter((t) => typeof t === "string")
            : [];

          const thought =
            toolsThisStep.length > 0
              ? `Called: ${toolsThisStep.join(", ")}`
              : carryTokens > 0
                ? "(reasoning — no tools)"
                : "(thinking)";

          frames.push({
            iteration,
            thought,
            toolName: toolsThisStep.length === 1 ? toolsThisStep[0] : undefined,
            toolArgs: toolsThisStep.length > 1 ? toolsThisStep.join(", ") : undefined,
            entropy: carryEntropy,
            tokensUsed: carryTokens,
            durationMs: carryDurationMs,
            ts: msg.ts || carryTs,
            kind: "step",
            toolsThisStep,
          });

          carryTokens = 0;
          carryDurationMs = 0;
          carryEntropy = undefined;
          break;
        }

        // ── FINAL: answer produced ────────────────────────────────────────────
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
            tokensUsed: typeof p.totalTokens === "number" ? p.totalTokens : carryTokens,
            durationMs: carryDurationMs,
            ts: msg.ts || carryTs,
            kind: "final",
          });

          carryTokens = 0;
          carryDurationMs = 0;
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
