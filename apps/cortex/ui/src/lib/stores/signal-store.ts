import { derived, writable, type Readable } from "svelte/store";
import type { RunState } from "./run-store.js";

export interface TrackPoint {
  readonly ts: number;
  readonly value: number;
  readonly color: string;
  readonly iteration?: number;
}
export interface BarPoint {
  readonly ts: number;
  readonly iteration: number;
  readonly tokens: number;
}
export interface ToolSpan {
  readonly tStart: number;
  readonly tEnd?: number;
  readonly name: string;
  readonly status: "active" | "success" | "error";
  readonly latencyMs?: number;
}

export interface SignalData {
  readonly entropy: TrackPoint[];
  readonly tokens: BarPoint[];
  readonly tools: ToolSpan[];
  readonly latency: TrackPoint[];
  readonly selectedIteration: number | null;
}

function entropyColor(value: number): string {
  if (value < 0.5) return "#d0bcff";
  if (value < 0.75) return "#f7be1d";
  return "#ffb4ab";
}

function readTokensFromPayload(p: Record<string, unknown>): number {
  const raw = p.tokensUsed;
  if (typeof raw === "number") return raw;
  if (raw && typeof raw === "object" && "total" in raw && typeof (raw as { total: unknown }).total === "number") {
    return (raw as { total: number }).total;
  }
  return 0;
}

export function createSignalStore(runState: Readable<RunState>) {
  const selectedIteration = writable<number | null>(null);

  const signalData = derived([runState, selectedIteration], ([$state, $sel]): SignalData => {
    const entropy: TrackPoint[] = [];
    const tokens: BarPoint[] = [];
    const tools: ToolSpan[] = [];
    const latency: TrackPoint[] = [];
    const callIdToIndex = new Map<string, number>();
    let llmStart: number | null = null;
    let currentIteration = 0;
    // Carry values accumulated between iteration boundaries
    let carryTokens = 0;
    let carryDurationMs = 0;
    let prevIterTs = 0;  // timestamp of previous ReasoningIterationProgress

    for (const msg of $state.events) {
      const p = msg.payload;
      switch (msg.type) {
        case "EntropyScored": {
          const v = typeof p.composite === "number" ? p.composite : 0;
          entropy.push({
            ts: msg.ts,
            value: v,
            color: entropyColor(v),
            iteration: typeof p.iteration === "number" ? p.iteration : currentIteration,
          });
          break;
        }
        case "LLMRequestStarted":
          llmStart = msg.ts;
          break;
        case "LLMRequestCompleted": {
          // Accumulate carry values — push bars at ReasoningIterationProgress boundary
          // (same pattern as trace-store) because per-call tokensUsed may be 0 when
          // framework accumulates into AgentCompleted.totalTokens instead.
          const durationMs =
            typeof p.durationMs === "number" && p.durationMs > 0
              ? p.durationMs
              : llmStart !== null && msg.ts > llmStart
                ? msg.ts - llmStart
                : 0;
          if (durationMs > 0) carryDurationMs = Math.max(carryDurationMs, durationMs);
          llmStart = null;
          const t = readTokensFromPayload(p);
          if (t > 0) carryTokens += t;
          break;
        }
        case "ReasoningStepCompleted":
          // Only update iteration counter from internal steps if they carry a step number.
          // Don't use these to reset currentIteration to 0.
          if (typeof p.totalSteps === "number" && p.totalSteps > 0) {
            currentIteration = Math.max(currentIteration, p.totalSteps);
          } else if (typeof p.step === "number" && p.step > 0) {
            currentIteration = Math.max(currentIteration, p.step);
          }
          break;
        case "ReasoningIterationProgress": {
          const iter = typeof p.iteration === "number" ? p.iteration : currentIteration;
          currentIteration = iter;

          // Push token bar — accumulated carry since last iteration
          if (carryTokens > 0) {
            tokens.push({ ts: msg.ts, iteration: iter, tokens: carryTokens });
          }
          // Push latency — prefer carry from LLMRequestCompleted, else time since prev iteration
          const iterDuration =
            carryDurationMs > 0
              ? carryDurationMs
              : prevIterTs > 0 && msg.ts > prevIterTs
                ? msg.ts - prevIterTs
                : 0;
          if (iterDuration > 0) {
            latency.push({ ts: msg.ts, value: iterDuration, color: "#06b6d4", iteration: iter });
          }
          carryTokens = 0;
          carryDurationMs = 0;
          prevIterTs = msg.ts;
          break;
        }
        case "ToolCallStarted": {
          const name = typeof p.toolName === "string" ? p.toolName : "unknown";
          const callId = typeof p.callId === "string" ? p.callId : `${msg.ts}-${name}`;
          const idx = tools.length;
          callIdToIndex.set(callId, idx);
          tools.push({ tStart: msg.ts, name, status: "active" });
          break;
        }
        case "ToolCallCompleted": {
          const callId = typeof p.callId === "string" ? p.callId : "";
          const idx = callId ? callIdToIndex.get(callId) : undefined;
          if (idx !== undefined && tools[idx]) {
            callIdToIndex.delete(callId);
            const startTs = tools[idx]!.tStart;
            const success = p.success === true;
            tools[idx] = {
              ...tools[idx]!,
              tEnd: msg.ts,
              status: success ? "success" : "error",
              latencyMs: msg.ts - startTs,
            };
          } else {
            // Fallback: some streams only emit ToolCallCompleted.
            const name = typeof p.toolName === "string" ? p.toolName : "unknown";
            const dur =
              typeof p.durationMs === "number" ? p.durationMs : 0;
            tools.push({
              name,
              status: p.success === true ? "success" : "error",
              tStart: msg.ts - Math.max(1, dur),
              tEnd: msg.ts,
              latencyMs: dur || undefined,
            });
          }
          break;
        }
        case "AgentCompleted": {
          // Flush remaining carry
          if (carryTokens > 0) {
            tokens.push({ ts: msg.ts, iteration: Math.max(1, currentIteration), tokens: carryTokens });
            carryTokens = 0;
          }
          // Fallback: distribute AgentCompleted.totalTokens across iterations when no per-call data
          const total = typeof p.totalTokens === "number" ? p.totalTokens : 0;
          if (total > 0 && tokens.length === 0 && currentIteration > 0) {
            // Create evenly-distributed synthetic bars so the chart has something useful to show.
            // Per-iteration height is equal; relative comparison across iterations isn't meaningful
            // but at least the chart is populated and shows the total was non-zero.
            const perIter = Math.ceil(total / currentIteration);
            for (let i = 1; i <= currentIteration; i++) {
              tokens.push({ ts: msg.ts, iteration: i, tokens: perIter });
            }
          } else if (total > 0 && tokens.length === 0) {
            tokens.push({ ts: msg.ts, iteration: 1, tokens: total });
          }
          // Latency fallback
          const totalDur = typeof p.durationMs === "number" ? p.durationMs : 0;
          if (totalDur > 0 && latency.length === 0 && currentIteration > 0) {
            // Same approach — distribute evenly
            const perIterMs = Math.ceil(totalDur / currentIteration);
            for (let i = 1; i <= currentIteration; i++) {
              latency.push({ ts: msg.ts, value: perIterMs, color: "#06b6d4", iteration: i });
            }
          }
          break;
        }
        default:
          break;
      }
    }

    return { entropy, tokens, tools, latency, selectedIteration: $sel };
  });

  return {
    subscribe: signalData.subscribe,
    selectIteration: selectedIteration.set,
  };
}

export type SignalStore = ReturnType<typeof createSignalStore>;
