import { parentPort } from "node:worker_threads";

if (!parentPort) throw new Error("sandbox-worker must run in a Worker thread");

interface InitMessage {
  type: "init";
  code: string;
  toolNames: string[];
}

interface ToolResultMessage {
  type: "tool-result";
  id: string;
  result: unknown;
}

interface ToolErrorMessage {
  type: "tool-error";
  id: string;
  error: string;
}

type InboundMessage = InitMessage | ToolResultMessage | ToolErrorMessage;

const pending = new Map<
  string,
  { resolve: (v: unknown) => void; reject: (e: Error) => void }
>();

let callCounter = 0;

parentPort.on("message", async (msg: InboundMessage) => {
  if (msg.type === "tool-result") {
    pending.get(msg.id)?.resolve(msg.result);
    pending.delete(msg.id);
    return;
  }

  if (msg.type === "tool-error") {
    pending.get(msg.id)?.reject(new Error(msg.error));
    pending.delete(msg.id);
    return;
  }

  if (msg.type === "init") {
    const { code, toolNames } = msg;

    const toolGlobals: Record<string, (args: unknown) => Promise<unknown>> = {};
    for (const name of toolNames) {
      toolGlobals[name] = (args: unknown): Promise<unknown> => {
        const id = `call-${++callCounter}-${Date.now()}`;
        return new Promise((resolve, reject) => {
          pending.set(id, { resolve, reject });
          parentPort!.postMessage({ type: "tool-call", id, name, args });
        });
      };
    }

    const argValues = toolNames.map((n) => toolGlobals[n]);

    try {
      // new Function is intentional here — the worker sandbox is the
      // isolation boundary; user-supplied code runs inside the Worker process.
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const fn = new Function(
        ...toolNames,
        `"use strict"; return (${code});`,
      ) as (...args: unknown[]) => Promise<unknown>;

      const result = await fn(...argValues);
      parentPort!.postMessage({ type: "done", result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      parentPort!.postMessage({ type: "error", message });
    }
  }
});
