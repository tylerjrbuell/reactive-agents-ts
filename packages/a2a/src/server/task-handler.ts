/**
 * Task handler — maps A2A message/send to internal task execution.
 * Uses a callback pattern: callers provide a TaskExecutor function.
 */
import { Effect, Ref } from "effect";
import type { A2ATask, SendMessageParams } from "../types.js";
import { A2AError } from "../errors.js";

export type TaskExecutor = (input: string, taskId: string) => Effect.Effect<string, A2AError>;

const generateId = () => crypto.randomUUID();
const now = () => new Date().toISOString();

export const createTaskHandler = (
  store: Ref.Ref<{ tasks: Map<string, A2ATask> }>,
  executor?: TaskExecutor,
) => ({
  handleMessageSend: (params: SendMessageParams): Effect.Effect<A2ATask, A2AError> =>
    Effect.gen(function* () {
      const taskId = generateId();
      const contextId = generateId();
      const timestamp = now();

      // Extract text from message parts
      const inputText = params.message.parts
        .filter((p): p is { kind: "text"; text: string } => p.kind === "text")
        .map((p) => p.text)
        .join("\n");

      const task: A2ATask = {
        id: taskId,
        contextId,
        status: { state: "submitted", timestamp },
        history: [params.message],
        createdAt: timestamp,
        updatedAt: timestamp,
        kind: "task",
      };

      // Store the task
      yield* Ref.update(store, (s) => ({
        tasks: new Map(s.tasks).set(taskId, task),
      }));

      // If executor provided, run task
      if (executor) {
        const workingTask: A2ATask = {
          ...task,
          status: { state: "working", timestamp: now() },
          updatedAt: now(),
        };
        yield* Ref.update(store, (s) => ({
          tasks: new Map(s.tasks).set(taskId, workingTask),
        }));

        // Execute and update result
        const result = yield* executor(inputText, taskId).pipe(
          Effect.map((output) => {
            const completedTask: A2ATask = {
              ...workingTask,
              status: { state: "completed", timestamp: now() },
              artifacts: [
                {
                  artifactId: generateId(),
                  name: "response",
                  parts: [{ kind: "text" as const, text: output }],
                },
              ],
              updatedAt: now(),
            };
            return completedTask;
          }),
          Effect.catchAll((error) =>
            Effect.succeed({
              ...workingTask,
              status: { state: "failed" as const, message: error.message, timestamp: now() },
              updatedAt: now(),
            } satisfies A2ATask),
          ),
        );

        yield* Ref.update(store, (s) => ({
          tasks: new Map(s.tasks).set(taskId, result),
        }));

        return result;
      }

      return task;
    }),
});
