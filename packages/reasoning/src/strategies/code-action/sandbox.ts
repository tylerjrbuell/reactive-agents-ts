import { Worker } from "node:worker_threads";

export interface ToolCallRecord {
  name: string;
  args: unknown;
  result: unknown;
}

export interface SandboxResult {
  finalResult: unknown;
  toolCalls: ToolCallRecord[];
}

interface WorkerDoneMessage {
  type: "done";
  result: unknown;
}

interface WorkerErrorMessage {
  type: "error";
  message: string;
}

interface WorkerToolCallMessage {
  type: "tool-call";
  id: string;
  name: string;
  args: unknown;
}

type WorkerMessage = WorkerDoneMessage | WorkerErrorMessage | WorkerToolCallMessage;

export async function runInSandbox(
  code: string,
  toolHandlers: Map<string, (args: unknown) => Promise<unknown>>,
  timeoutMs = 30_000,
): Promise<SandboxResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./sandbox-worker.ts", import.meta.url));
    const toolCalls: ToolCallRecord[] = [];

    const killTimer = setTimeout(() => {
      void worker.terminate();
      reject(new Error(`code-action sandbox timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    worker.on("message", async (msg: WorkerMessage) => {
      if (msg.type === "tool-call") {
        const handler = toolHandlers.get(msg.name);
        if (!handler) {
          worker.postMessage({
            type: "tool-error",
            id: msg.id,
            error: `No handler registered for tool "${msg.name}"`,
          });
          return;
        }
        try {
          const result = await handler(msg.args);
          toolCalls.push({ name: msg.name, args: msg.args, result });
          worker.postMessage({ type: "tool-result", id: msg.id, result });
        } catch (err) {
          worker.postMessage({
            type: "tool-error",
            id: msg.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
        return;
      }

      if (msg.type === "done") {
        clearTimeout(killTimer);
        await worker.terminate();
        resolve({ finalResult: msg.result, toolCalls });
        return;
      }

      if (msg.type === "error") {
        clearTimeout(killTimer);
        await worker.terminate();
        reject(new Error(msg.message));
      }
    });

    worker.on("error", (err) => {
      clearTimeout(killTimer);
      reject(err);
    });

    worker.postMessage({
      type: "init",
      code,
      toolNames: Array.from(toolHandlers.keys()),
    });
  });
}
