/**
 * SSE streaming implementation for A2A task updates.
 */
import { Effect, Ref, Queue } from "effect";
import type { A2ATask, TaskStatusUpdateEvent, TaskArtifactUpdateEvent } from "../types.js";

export type StreamEvent =
  | { type: "task"; data: A2ATask }
  | { type: "status-update"; data: TaskStatusUpdateEvent }
  | { type: "artifact-update"; data: TaskArtifactUpdateEvent };

export const createSSEStream = (
  taskId: string,
  store: Ref.Ref<{ tasks: Map<string, A2ATask> }>,
) =>
  Effect.gen(function* () {
    const queue = yield* Queue.unbounded<StreamEvent>();

    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        const send = (event: StreamEvent) => {
          const data = JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result: event.data,
          });
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        };

        // Poll for task updates (simplified — production would use EventBus)
        let closed = false;
        const poll = async () => {
          while (!closed) {
            await new Promise((r) => setTimeout(r, 100));
            // Task state checked by the caller
          }
        };
        poll().catch(() => {});

        // Expose send and close functions via queue consumption
        (async () => {
          // This would be wired to the queue in production
        })();
      },
      cancel() {
        // Cleanup
      },
    });

    return { stream, queue };
  });

export const formatSSEEvent = (event: StreamEvent): string => {
  const data = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    result:
      event.type === "task"
        ? { ...event.data, kind: "task" }
        : event.type === "status-update"
          ? { ...event.data, kind: "status-update" }
          : { ...event.data, kind: "artifact-update" },
  });
  return `data: ${data}\n\n`;
};
