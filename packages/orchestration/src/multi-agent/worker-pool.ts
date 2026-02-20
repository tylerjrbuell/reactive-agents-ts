import { Effect, Ref } from "effect";
import type { WorkerAgent, WorkflowId } from "../types.js";
import { WorkerPoolError } from "../errors.js";

export interface WorkerPool {
  readonly spawn: (specialty: string) => Effect.Effect<WorkerAgent, WorkerPoolError>;
  readonly assignTask: (workflowId: WorkflowId, stepId: string, requiredSpecialty?: string) => Effect.Effect<WorkerAgent, WorkerPoolError>;
  readonly releaseWorker: (agentId: string, success: boolean, latencyMs: number) => Effect.Effect<void, never>;
  readonly getStatus: Effect.Effect<{ total: number; idle: number; busy: number; workers: WorkerAgent[] }, never>;
}

export const makeWorkerPool = Effect.gen(function* () {
  const workersRef = yield* Ref.make<Map<string, WorkerAgent>>(new Map());

  const spawn = (specialty: string): Effect.Effect<WorkerAgent, WorkerPoolError> =>
    Effect.gen(function* () {
      const worker: WorkerAgent = {
        agentId: `worker-${crypto.randomUUID().slice(0, 8)}`,
        specialty,
        status: "idle",
        completedTasks: 0,
        failedTasks: 0,
        avgLatencyMs: 0,
      };

      yield* Ref.update(workersRef, (map) => {
        const newMap = new Map(map);
        newMap.set(worker.agentId, worker);
        return newMap;
      });

      return worker;
    });

  const assignTask = (
    workflowId: WorkflowId,
    stepId: string,
    requiredSpecialty?: string,
  ): Effect.Effect<WorkerAgent, WorkerPoolError> =>
    Effect.gen(function* () {
      const workers = yield* Ref.get(workersRef);
      let candidate: WorkerAgent | undefined;

      for (const worker of workers.values()) {
        if (worker.status === "idle") {
          if (!requiredSpecialty || worker.specialty === requiredSpecialty) {
            candidate = worker;
            break;
          }
        }
      }

      if (!candidate) {
        return yield* Effect.fail(
          new WorkerPoolError({
            message: `No idle worker available${requiredSpecialty ? ` with specialty "${requiredSpecialty}"` : ""}`,
            availableWorkers: [...workers.values()].filter((w) => w.status === "idle").length,
            requiredWorkers: 1,
          }),
        );
      }

      const assigned: WorkerAgent = {
        ...candidate,
        status: "busy",
        currentWorkflowId: workflowId,
        currentStepId: stepId,
      };

      yield* Ref.update(workersRef, (map) => {
        const newMap = new Map(map);
        newMap.set(assigned.agentId, assigned);
        return newMap;
      });

      return assigned;
    });

  const releaseWorker = (agentId: string, success: boolean, latencyMs: number): Effect.Effect<void, never> =>
    Ref.update(workersRef, (map) => {
      const newMap = new Map(map);
      const worker = newMap.get(agentId);
      if (worker) {
        const totalTasks = worker.completedTasks + worker.failedTasks + 1;
        newMap.set(agentId, {
          ...worker,
          status: "idle" as const,
          currentWorkflowId: undefined,
          currentStepId: undefined,
          completedTasks: success ? worker.completedTasks + 1 : worker.completedTasks,
          failedTasks: success ? worker.failedTasks : worker.failedTasks + 1,
          avgLatencyMs: (worker.avgLatencyMs * (totalTasks - 1) + latencyMs) / totalTasks,
        });
      }
      return newMap;
    });

  const getStatus = Effect.gen(function* () {
    const workers = yield* Ref.get(workersRef);
    const all = [...workers.values()];
    return {
      total: all.length,
      idle: all.filter((w) => w.status === "idle").length,
      busy: all.filter((w) => w.status === "busy").length,
      workers: all,
    };
  });

  return { spawn, assignTask, releaseWorker, getStatus } satisfies WorkerPool;
});
