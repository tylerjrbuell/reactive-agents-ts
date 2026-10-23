/**
 * Execution-scoped EventBus collectors.
 *
 * Owns, for one `execute()` run: the ToolCallCompleted/ToolCallStarted debrief
 * collectors (with the kernel-iteration cursor they share), the milestone
 * decision capture (CuratorDecisionEmitted / StrategySwitched /
 * ReactiveDecision), the termination-rationale dedup
 * (KernelStateSnapshotEmitted), the EntropyScored telemetry collector (with
 * its (taskId, iteration) dedup), and the EventBus-driven entropy scoring
 * subscription for non-kernel-runner strategies.
 *
 * Array identities are preserved: the accumulators are created here and
 * RETURNED to the engine, which threads them into debrief, telemetry, memory
 * flush, local learning, result assembly, and run finalization. Handlers close
 * over the same `let _currentKernelIteration` cursor they did inline — nothing
 * is re-created per call site.
 *
 * Moved verbatim from execution-engine.ts (GH #221 W26 decomposition,
 * "event-collector cluster" banner, former lines 264-473).
 */
import { Effect } from "effect";
import type { Task, KernelStateLike } from "@reactive-agents/core";
import {
  EntropySensorService,
  scoresEntropyInline,
  emitErrorSwallowed,
  errorTag,
} from "@reactive-agents/core";
import { classifyTaskCategory as classifyTaskCategoryFn } from "@reactive-agents/reactive-intelligence";
import type { ReactiveAgentsConfig } from "../types.js";
import { extractTaskText } from "./util.js";
import type { EbLike } from "./runtime-context.js";

/** One debrief entry from the ToolCallCompleted listener. */
export type ToolCallEntry = { toolName: string; durationMs: number; success: boolean; iteration: number };

/** One structured rationale entry (tool-selection / milestone / termination). */
export type RationaleEntry = {
  iteration: number;
  decision: string;
  toolName?: string;
  rationale: { why: string; refs?: readonly string[]; confidence?: number };
};

/** One EntropyScored telemetry sample. */
export type EntropyLogEntry = {
  iteration: number;
  composite: number;
  sources: { token: number | null; structural: number; semantic: number | null; behavioral: number; contextPressure: number };
  trajectory: { derivative: number; shape: string; momentum: number };
  confidence: "high" | "medium" | "low";
};

export interface EventCollectorDeps {
  readonly eb: EbLike | null;
  readonly task: Task;
  readonly config: ReactiveAgentsConfig;
}

export interface ExecutionEventCollectors {
  readonly toolCallLog: ToolCallEntry[];
  readonly rationaleLog: RationaleEntry[];
  readonly entropyLog: EntropyLogEntry[];
}

export const registerExecutionEventCollectors = (
  deps: EventCollectorDeps,
): Effect.Effect<ExecutionEventCollectors, never> => {
  const { eb, task, config } = deps;
  return Effect.gen(function* () {
    // ── Collect ToolCallCompleted events for debrief ──
    // Track the current kernel iteration so parallel tool calls in the same
    // turn share the same `iteration` value. ReasoningStepCompleted fires per
    // iteration and carries `event.step` — we read it via a mutable counter.
    let _currentKernelIteration = 0;
    const toolCallLog: { toolName: string; durationMs: number; success: boolean; iteration: number }[] = [];
    const rationaleLog: {
      iteration: number;
      decision: string;
      toolName?: string;
      rationale: { why: string; refs?: readonly string[]; confidence?: number };
    }[] = [];
    if (eb) {
      yield* eb.on("ReasoningStepCompleted", (event) =>
        Effect.sync(() => { _currentKernelIteration = event.step ?? _currentKernelIteration; }),
      );
      yield* eb.on("ToolCallCompleted", (event) =>
        Effect.sync(() => { toolCallLog.push({ toolName: event.toolName, durationMs: event.durationMs, success: event.success, iteration: _currentKernelIteration }); }),
      );
      // Collect rationale from ToolCallStarted events
      yield* eb.on("ToolCallStarted", (event) => {
        if (event.rationale) {
          return Effect.sync(() => {
            rationaleLog.push({
              iteration: _currentKernelIteration,
              decision: "tool-selection",
              toolName: event.toolName,
              rationale: {
                why: event.rationale!.why,
                refs: event.rationale!.refs,
                confidence: event.rationale!.confidence,
              },
            });
          });
        }
        return Effect.void;
      });

      // ── Milestone decision capture (v0.11.x) ──
      // Surface every task-advancing decision in debrief.rationale[], not
      // just tool calls. Each emitter already records a "why" string;
      // promote it into structured Rationale shape with a decision tag.

      // Curator decisions — already carry structured Rationale (required).
      yield* eb.on("CuratorDecisionEmitted", (event) =>
        Effect.sync(() => {
          rationaleLog.push({
            iteration: event.iteration,
            decision: `curator-${event.action}`,
            rationale: {
              why: event.rationale.why,
              refs: event.rationale.refs,
              confidence: event.rationale.confidence,
            },
          });
        }),
      );

      // Strategy switches — promote `reason` string into structured form.
      yield* eb.on("StrategySwitched", (event) =>
        Effect.sync(() => {
          if (!event.reason || event.reason.trim().length === 0) return;
          rationaleLog.push({
            iteration: _currentKernelIteration,
            decision: `strategy-switch:${event.from}→${event.to}`,
            rationale: {
              why: event.reason.slice(0, 280),
            },
          });
        }),
      );

      // Reactive interventions — corrective dispatch (early-stop, branch, compress…).
      yield* eb.on("ReactiveDecision", (event) =>
        Effect.sync(() => {
          if (!event.reason || event.reason.trim().length === 0) return;
          rationaleLog.push({
            iteration: event.iteration,
            decision: `reactive-${event.decision}`,
            rationale: {
              why: event.reason.slice(0, 280),
              ...(typeof event.entropyAfter === "number" && typeof event.entropyBefore === "number"
                ? { confidence: Math.max(0, Math.min(1, 1 - Math.abs(event.entropyAfter - event.entropyBefore))) }
                : {}),
            },
          });
        }),
      );

      // Termination — captured from KernelStateSnapshotEmitted when terminationRationale present.
      const terminationSeen = new Set<string>();
      yield* eb.on("KernelStateSnapshotEmitted", (event) => {
        const tr = event.terminationRationale;
        if (!tr || !event.terminatedBy) return Effect.void;
        const dedup = `${event.taskId}:${event.terminatedBy}`;
        if (terminationSeen.has(dedup)) return Effect.void;
        terminationSeen.add(dedup);
        return Effect.sync(() => {
          rationaleLog.push({
            iteration: event.iteration,
            decision: `termination:${event.terminatedBy}`,
            rationale: {
              why: tr.why,
              refs: tr.refs,
              confidence: tr.confidence,
            },
          });
        });
      });
    }

    // ── Collect EntropyScored events for telemetry + dashboard ──
    const entropyLog: {
      iteration: number;
      composite: number;
      sources: { token: number | null; structural: number; semantic: number | null; behavioral: number; contextPressure: number };
      trajectory: { derivative: number; shape: string; momentum: number };
      confidence: "high" | "medium" | "low";
    }[] = [];
    const entropySeenIterations = new Set<string>();
    if (eb) {
      yield* eb.on("EntropyScored", (event) =>
        Effect.sync(() => {
          // Dedup: kernel-runner inline scoring + event subscriber may both
          // publish EntropyScored for the same (taskId, iteration) pair.
          const key = `${event.taskId}:${event.iteration}`;
          if (entropySeenIterations.has(key)) return;
          entropySeenIterations.add(key);
          entropyLog.push({
            iteration: event.iteration,
            composite: event.composite,
            sources: event.sources,
            trajectory: event.trajectory,
            confidence: event.confidence,
          });
        }),
      );
    }

    // ── EventBus-driven entropy scoring ──
    // Subscribe to ReasoningStepCompleted events from ALL strategies and score
    // thoughts via EntropySensorService. This covers strategies like plan-execute
    // that bypass kernel-runner's inline scoring.
    // Dedup: tracks (taskId, step) pairs to avoid double-scoring with kernel-runner.
    if (eb && config.enableReactiveIntelligence) {
      const esOpt = yield* Effect.serviceOption(EntropySensorService).pipe(
        Effect.catchAll(() => Effect.succeed({ _tag: "None" as const })),
      );
      if (esOpt._tag === "Some") {
        const sensor = esOpt.value;
        const scoredPairs = new Set<string>();
        const taskThoughts = new Map<string, { thoughts: string[]; steps: { type: string; content: string }[]; toolsUsed: Set<string> }>();

        yield* eb.on("ReasoningStepCompleted", (event) =>
          Effect.gen(function* () {
            if (!event.thought) return;
            // Kernel-runner strategies already score in
            // runReactiveObserver. Scoring their hook event again
            // corrupts the shared trajectory with a second step index.
            if (scoresEntropyInline(event.strategy)) return;
            const dedupKey = `${event.taskId}:${event.step}`;
            if (scoredPairs.has(dedupKey)) return;

            let tState = taskThoughts.get(event.taskId);
            if (!tState) {
              tState = { thoughts: [], steps: [], toolsUsed: new Set() };
              taskThoughts.set(event.taskId, tState);
            }
            tState.steps.push({ type: "thought", content: event.thought });
            if (event.action) {
              tState.steps.push({ type: "action", content: event.action });
              try { const p = JSON.parse(event.action); if (p.tool) tState.toolsUsed.add(p.tool); } catch {}
            }
            if (event.observation) tState.steps.push({ type: "observation", content: event.observation });

            const priorThought = tState.thoughts.length > 0 ? tState.thoughts[tState.thoughts.length - 1] : undefined;
            tState.thoughts.push(event.thought);

            const kernelState: KernelStateLike = {
              taskId: event.taskId, strategy: event.strategy, kernelType: "event-subscriber",
              steps: tState.steps.map((s) => ({ type: s.type, content: s.content })),
              toolsUsed: tState.toolsUsed, iteration: event.step, tokens: 0,
              status: "thinking", output: null, error: null, meta: {},
            };

            const score = yield* sensor.score({
              thought: event.thought, taskDescription: extractTaskText(task.input), strategy: event.strategy,
              iteration: event.step, maxIterations: config.maxIterations ?? 10,
              modelId: String(config.defaultModel ?? "unknown"), temperature: 0, priorThought, kernelState,
              taskCategory: classifyTaskCategoryFn(extractTaskText(task.input)),
            });

            scoredPairs.add(dedupKey);

            yield* eb.publish({
              _tag: "EntropyScored", taskId: event.taskId, iteration: score.iteration,
              composite: score.composite, sources: score.sources,
              trajectory: {
                derivative: score.trajectory.derivative,
                shape: score.trajectory.shape as "converging" | "flat" | "diverging" | "v-recovery" | "oscillating",
                momentum: score.trajectory.momentum,
              },
              confidence: score.confidence,
              modelTier: score.modelTier, iterationWeight: score.iterationWeight,
              modelId: String(config.defaultModel ?? "unknown"),
            });
          }).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/engine/execute-event-collectors.ts:277", tag: errorTag(err) }))),
        );
      }
    }

    return { toolCallLog, rationaleLog, entropyLog };
  });
};
