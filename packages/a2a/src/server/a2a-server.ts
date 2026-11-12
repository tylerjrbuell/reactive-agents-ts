import type { A2ATask, AgentCard } from "../types.js";
import { TaskNotFoundError, TaskCanceledError, InvalidTaskStateError } from "../errors.js";
import { Effect, Context, Layer, Ref } from "effect";

export class A2AServer extends Context.Tag("A2AServer")<
  A2AServer,
  {
    readonly getTask: (id: string) => Effect.Effect<A2ATask, TaskNotFoundError>;
    readonly setTask: (task: A2ATask) => Effect.Effect<void>;
    readonly cancelTask: (id: string) => Effect.Effect<A2ATask, TaskNotFoundError | TaskCanceledError | InvalidTaskStateError>;
    readonly getAgentCard: () => Effect.Effect<AgentCard>;
  }
>() {}

interface TaskStore {
  tasks: Map<string, A2ATask>;
}

const now = () => new Date().toISOString();

/** Default cap on retained tasks; the oldest are evicted first once exceeded. */
export const DEFAULT_MAX_TASKS = 1000;

export interface A2AServerOptions {
  /** Maximum tasks held in the in-memory store. Oldest are evicted. Default {@link DEFAULT_MAX_TASKS}. */
  readonly maxTasks?: number;
}

/** Insert `task`, evicting oldest entries (Map insertion order) beyond `max`. */
const putBounded = (tasks: Map<string, A2ATask>, task: A2ATask, max: number): Map<string, A2ATask> => {
  const next = new Map(tasks);
  next.delete(task.id); // re-insert so an updated task counts as newest
  next.set(task.id, task);
  while (next.size > max) {
    const oldest = next.keys().next().value;
    if (oldest === undefined) break;
    next.delete(oldest);
  }
  return next;
};

export const createA2AServer = (agentCard: AgentCard, options?: A2AServerOptions) =>
  Layer.effect(
    A2AServer,
    Effect.gen(function* () {
      const maxTasks = Math.max(1, options?.maxTasks ?? DEFAULT_MAX_TASKS);
      const store = yield* Ref.make<TaskStore>({ tasks: new Map() });

      return {
        getTask: (id) =>
          Effect.gen(function* () {
            const state = yield* Ref.get(store);
            const task = state.tasks.get(id);
            if (!task) {
              return yield* Effect.fail(new TaskNotFoundError({ taskId: id }));
            }
            return task;
          }),

        setTask: (task) =>
          Ref.update(store, (s) => ({
            tasks: putBounded(s.tasks, task, maxTasks),
          })),

        cancelTask: (id) =>
          Effect.gen(function* () {
            const state = yield* Ref.get(store);
            const task = state.tasks.get(id);
            if (!task) {
              return yield* Effect.fail(new TaskNotFoundError({ taskId: id }));
            }
            const terminalStates = ["completed", "failed", "canceled"];
            if (terminalStates.includes(task.status.state)) {
              return yield* Effect.fail(
                new InvalidTaskStateError({
                  taskId: id,
                  currentState: task.status.state,
                  attemptedTransition: "cancel",
                }),
              );
            }
            const updatedTask: A2ATask = {
              ...task,
              status: {
                state: "canceled",
                message: "Task canceled by user",
                timestamp: now(),
              },
              updatedAt: now(),
            };
            yield* Ref.update(store, (s) => ({
              tasks: putBounded(s.tasks, updatedTask, maxTasks),
            }));
            return updatedTask;
          }),

        getAgentCard: () => Effect.succeed(agentCard),
      };
    }),
  );
