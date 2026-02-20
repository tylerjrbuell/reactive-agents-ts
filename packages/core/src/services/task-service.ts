import { Effect, Context, Layer, Ref } from "effect";
import type { Task, TaskConfig, TaskId } from "../types/task.js";
import { generateTaskId } from "../id.js";
import { TaskError } from "../errors/errors.js";
import { EventBus } from "./event-bus.js";

// ─── Service Tag ───

export class TaskService extends Context.Tag("TaskService")<
  TaskService,
  {
    /** Create a new task (status: pending). */
    readonly create: (config: TaskConfig) => Effect.Effect<Task, TaskError>;

    /** Get task by ID. */
    readonly get: (id: TaskId) => Effect.Effect<Task, TaskError>;

    /** Update task status. */
    readonly updateStatus: (
      id: TaskId,
      status: Task["status"],
    ) => Effect.Effect<Task, TaskError>;

    /** Cancel a running task. */
    readonly cancel: (id: TaskId) => Effect.Effect<void, TaskError>;
  }
>() {}

// ─── Live Implementation ───

export const TaskServiceLive = Layer.effect(
  TaskService,
  Effect.gen(function* () {
    const eventBus = yield* EventBus;
    const store = yield* Ref.make<Map<string, Task>>(new Map());

    return {
      create: (config: TaskConfig) =>
        Effect.gen(function* () {
          const task: Task = {
            id: generateTaskId(),
            agentId: config.agentId,
            type: config.type,
            input: config.input,
            priority: config.priority ?? "medium",
            status: "pending",
            metadata: config.metadata ?? {},
            createdAt: new Date(),
          };
          yield* Ref.update(store, (m) => new Map(m).set(task.id, task));
          yield* eventBus.publish({ _tag: "TaskCreated", taskId: task.id });
          return task;
        }),

      get: (id: TaskId) =>
        Effect.gen(function* () {
          const m = yield* Ref.get(store);
          const task = m.get(id);
          if (!task) {
            return yield* Effect.fail(
              new TaskError({ taskId: id, message: `Task ${id} not found` }),
            );
          }
          return task;
        }),

      updateStatus: (id: TaskId, status: Task["status"]) =>
        Effect.gen(function* () {
          const m = yield* Ref.get(store);
          const task = m.get(id);
          if (!task) {
            return yield* Effect.fail(
              new TaskError({ taskId: id, message: `Task ${id} not found` }),
            );
          }
          const updated: Task = { ...task, status };
          yield* Ref.update(store, (m) => new Map(m).set(id, updated));
          if (status === "completed") {
            yield* eventBus.publish({
              _tag: "TaskCompleted",
              taskId: id,
              success: true,
            });
          } else if (status === "failed") {
            yield* eventBus.publish({
              _tag: "TaskFailed",
              taskId: id,
              error: "Task failed",
            });
          }
          return updated;
        }),

      cancel: (id: TaskId) =>
        Effect.gen(function* () {
          const m = yield* Ref.get(store);
          if (!m.has(id)) {
            return yield* Effect.fail(
              new TaskError({ taskId: id, message: `Task ${id} not found` }),
            );
          }
          yield* Ref.update(store, (m) => {
            const next = new Map(m);
            next.set(id, { ...next.get(id)!, status: "cancelled" as const });
            return next;
          });
        }),
    };
  }),
);
