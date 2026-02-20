import { Effect, Ref } from "effect";
import type { AgentStateSnapshot } from "../types.js";

export interface StateInspector {
  readonly capture: (agentId: string, state: Partial<AgentStateSnapshot>) => Effect.Effect<AgentStateSnapshot, never>;
  readonly getSnapshots: (agentId: string, limit?: number) => Effect.Effect<readonly AgentStateSnapshot[], never>;
}

const MAX_SNAPSHOTS = 1000;

export const makeStateInspector = Effect.gen(function* () {
  const snapshotsRef = yield* Ref.make<AgentStateSnapshot[]>([]);

  const capture = (
    agentId: string,
    partialState: Partial<AgentStateSnapshot>,
  ): Effect.Effect<AgentStateSnapshot, never> =>
    Effect.gen(function* () {
      const snapshot: AgentStateSnapshot = {
        agentId,
        timestamp: new Date(),
        workingMemory: partialState.workingMemory ?? [],
        currentStrategy: partialState.currentStrategy,
        reasoningStep: partialState.reasoningStep,
        activeTools: partialState.activeTools ?? [],
        tokenUsage: partialState.tokenUsage ?? {
          inputTokens: 0,
          outputTokens: 0,
          contextWindowUsed: 0,
          contextWindowMax: 200_000,
        },
        costAccumulated: partialState.costAccumulated ?? 0,
      };

      yield* Ref.update(snapshotsRef, (snaps) => {
        const updated = [...snaps, snapshot];
        return updated.length > MAX_SNAPSHOTS ? updated.slice(-MAX_SNAPSHOTS) : updated;
      });

      return snapshot;
    });

  const getSnapshots = (
    agentId: string,
    limit: number = 50,
  ): Effect.Effect<readonly AgentStateSnapshot[], never> =>
    Effect.gen(function* () {
      const snapshots = yield* Ref.get(snapshotsRef);
      return snapshots.filter((s) => s.agentId === agentId).slice(-limit);
    });

  return { capture, getSnapshots } satisfies StateInspector;
});
