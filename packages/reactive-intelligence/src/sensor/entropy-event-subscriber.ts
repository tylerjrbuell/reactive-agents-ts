/**
 * entropy-event-subscriber.ts — EventBus-driven entropy scoring.
 *
 * Subscribes to `ReasoningStepCompleted` events from ALL reasoning strategies
 * and scores thoughts via the EntropySensorService. Publishes `EntropyScored`
 * events back to the EventBus.
 *
 * This replaces per-strategy inline scoring (which only covered strategies
 * using `runKernel()`) with a unified event-driven approach. Strategies like
 * plan-execute-reflect that have their own loops now get entropy scoring
 * automatically.
 *
 * Dedup: The kernel-runner already scores inline for reactive/ToT strategies.
 * We track `(taskId, iteration)` pairs to avoid double-scoring.
 */
import { Effect } from "effect";
import {
  EventBus,
  EntropySensorService,
  type KernelStateLike,
} from "@reactive-agents/core";

/**
 * Subscribe to ReasoningStepCompleted events and score thoughts.
 *
 * Call this Effect once during layer initialization. It registers an EventBus
 * handler that fires for the lifetime of the layer.
 *
 * @param config - modelId and maxIterations defaults for scoring
 */
export function subscribeEntropyScoring(config: {
  modelId?: string;
  maxIterations?: number;
}): Effect.Effect<void, never, EventBus | EntropySensorService> {
  return Effect.gen(function* () {
    const eventBus = yield* EventBus;
    const entropySensor = yield* EntropySensorService;

    // Track scored (taskId, iteration) pairs to dedup with kernel-runner inline scoring
    const scored = new Set<string>();

    // Per-task state for trajectory analysis
    const taskState = new Map<
      string,
      {
        thoughts: string[];
        steps: { type: string; content: string }[];
        toolsUsed: Set<string>;
      }
    >();

    yield* eventBus.on("ReasoningStepCompleted", (event) =>
      Effect.gen(function* () {
        // Only score events that carry a thought
        if (!event.thought) return;

        const dedupKey = `${event.taskId}:${event.step}`;
        if (scored.has(dedupKey)) return;

        // Build per-task state
        let state = taskState.get(event.taskId);
        if (!state) {
          state = { thoughts: [], steps: [], toolsUsed: new Set() };
          taskState.set(event.taskId, state);
        }

        // Accumulate steps from events
        if (event.thought) {
          state.steps.push({ type: "thought", content: event.thought });
        }
        if (event.action) {
          state.steps.push({ type: "action", content: event.action });
          // Extract tool name from action if possible
          try {
            const parsed = JSON.parse(event.action);
            if (parsed.tool) state.toolsUsed.add(parsed.tool);
          } catch {
            // Action may not be JSON — try extracting tool name from bracket notation
            const match = event.action.match(/^\[(?:STEP|EXEC)\s+[^\]]*→\s*(\S+)/);
            if (match) state.toolsUsed.add(match[1]!);
          }
        }
        if (event.observation) {
          state.steps.push({ type: "observation", content: event.observation });
        }

        const priorThought = state.thoughts.length > 0
          ? state.thoughts[state.thoughts.length - 1]
          : undefined;
        state.thoughts.push(event.thought);

        // Build a minimal KernelStateLike for the sensor
        const kernelState: KernelStateLike = {
          taskId: event.taskId,
          strategy: event.strategy,
          kernelType: "event-subscriber",
          steps: state.steps.map((s) => ({ type: s.type, content: s.content })),
          toolsUsed: state.toolsUsed,
          iteration: event.step,
          tokens: 0,
          status: "thinking",
          output: null,
          error: null,
          meta: {},
        };

        const score = yield* entropySensor.score({
          thought: event.thought,
          taskDescription: "",
          strategy: event.strategy,
          iteration: event.step,
          maxIterations: config.maxIterations ?? 10,
          modelId: config.modelId ?? "unknown",
          temperature: 0,
          priorThought,
          kernelState,
        });

        scored.add(dedupKey);

        // Publish EntropyScored event
        yield* eventBus.publish({
          _tag: "EntropyScored",
          taskId: event.taskId,
          iteration: score.iteration,
          composite: score.composite,
          sources: score.sources,
          trajectory: {
            derivative: score.trajectory.derivative,
            shape: score.trajectory.shape as "converging" | "flat" | "diverging" | "v-recovery" | "oscillating",
            momentum: score.trajectory.momentum,
          },
          confidence: score.confidence,
          modelTier: score.modelTier,
          iterationWeight: score.iterationWeight,
        });
      }).pipe(Effect.catchAllCause(() => Effect.void)),
    );
  });
}
