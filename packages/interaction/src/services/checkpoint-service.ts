import { Context, Effect, Layer, Ref } from "effect";
import type { Checkpoint, CheckpointStatus } from "../types/checkpoint.js";
import { CheckpointError } from "../errors/errors.js";
import { EventBus } from "@reactive-agents/core";

export class CheckpointService extends Context.Tag("CheckpointService")<
  CheckpointService,
  {
    readonly createCheckpoint: (params: {
      agentId: string;
      taskId: string;
      milestoneName: string;
      description: string;
    }) => Effect.Effect<Checkpoint>;

    readonly resolveCheckpoint: (
      checkpointId: string,
      status: "approved" | "rejected",
      comment?: string,
    ) => Effect.Effect<Checkpoint, CheckpointError>;

    readonly getCheckpoint: (
      checkpointId: string,
    ) => Effect.Effect<Checkpoint, CheckpointError>;

    readonly listPending: (
      agentId?: string,
    ) => Effect.Effect<readonly Checkpoint[]>;
  }
>() {}

export const CheckpointServiceLive = Layer.effect(
  CheckpointService,
  Effect.gen(function* () {
    const eventBus = yield* EventBus;
    const checkpointsRef = yield* Ref.make<Map<string, Checkpoint>>(new Map());

    return {
      createCheckpoint: (params) =>
        Effect.gen(function* () {
          const checkpoint: Checkpoint = {
            id: crypto.randomUUID(),
            agentId: params.agentId,
            taskId: params.taskId,
            milestoneName: params.milestoneName,
            description: params.description,
            status: "pending",
            createdAt: new Date(),
          };

          yield* Ref.update(checkpointsRef, (m) => {
            const next = new Map(m);
            next.set(checkpoint.id, checkpoint);
            return next;
          });

          yield* eventBus.publish({
            _tag: "Custom",
            type: "interaction.checkpoint-created",
            payload: checkpoint,
          });

          return checkpoint;
        }),

      resolveCheckpoint: (checkpointId, status, comment) =>
        Effect.gen(function* () {
          const checkpoints = yield* Ref.get(checkpointsRef);
          const existing = checkpoints.get(checkpointId);
          if (!existing) {
            return yield* Effect.fail(
              new CheckpointError({ checkpointId, message: "Checkpoint not found" }),
            );
          }

          const resolved: Checkpoint = {
            ...existing,
            status,
            resolvedAt: new Date(),
            userComment: comment,
          };

          yield* Ref.update(checkpointsRef, (m) => {
            const next = new Map(m);
            next.set(checkpointId, resolved);
            return next;
          });

          yield* eventBus.publish({
            _tag: "Custom",
            type: "interaction.checkpoint-resolved",
            payload: resolved,
          });

          return resolved;
        }),

      getCheckpoint: (checkpointId) =>
        Effect.gen(function* () {
          const checkpoints = yield* Ref.get(checkpointsRef);
          const cp = checkpoints.get(checkpointId);
          if (!cp) {
            return yield* Effect.fail(
              new CheckpointError({ checkpointId, message: "Checkpoint not found" }),
            );
          }
          return cp;
        }),

      listPending: (agentId) =>
        Ref.get(checkpointsRef).pipe(
          Effect.map((m) =>
            Array.from(m.values()).filter(
              (cp) => cp.status === "pending" && (!agentId || cp.agentId === agentId),
            ),
          ),
        ),
    };
  }),
);
