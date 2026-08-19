import { Worker } from "node:worker_threads";
import { Effect } from "effect";
import { buildToolParamNames } from "./tool-binding.js";

export interface ToolCallRecord {
  name: string;
  args: unknown;
  result: unknown;
  durationMs?: number;
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

/**
 * Run generated code in a `node:worker_threads` sandbox, dispatching its
 * `tool-call` messages through `toolHandlers` (each closure captures the
 * live `ToolService` directly — the runtime execute call, not the sandboxed
 * code, decides what a tool actually does).
 *
 * Returns an `Effect` (not a bare `Promise`) specifically so the Worker's
 * lifecycle is tied to Effect's own interruption: the `Effect.async`
 * register callback below returns a finalizer that terminates the Worker
 * when the calling fiber is interrupted (run cancelled, kill switch,
 * timeout race lost elsewhere). Before this, `code-action.ts` wrapped a
 * plain `Promise`-returning version with `Effect.tryPromise` — interruption
 * abandoned AWAITING the promise, but the Worker itself (a real OS thread)
 * and whatever tool call it had in flight kept running unsupervised,
 * potentially completing a side-effecting tool (`shell-execute`,
 * `file-write`) after the run was supposed to have stopped (#35).
 *
 * Residual limitation, not fixed here: a tool call already mid-execution
 * (inside a `toolHandlers` closure's own `Effect.runPromise`, dispatched
 * from the Worker's `"message"` listener — itself outside any Effect fiber)
 * is not itself interrupted by terminating the Worker. It may still finish
 * in the background; its result is simply discarded, since nothing is
 * listening for the Worker's messages anymore. True cancellation of an
 * in-flight tool call would need an interrupt signal threaded into
 * `ToolService.execute` itself — cross-cutting beyond this sandbox.
 */
export function runInSandbox(
  code: string,
  toolHandlers: Map<string, (args: unknown) => Promise<unknown>>,
  timeoutMs = 30_000,
): Effect.Effect<SandboxResult, Error> {
  return Effect.async<SandboxResult, Error>((resume) => {
    const worker = new Worker(new URL("./sandbox-worker.ts", import.meta.url));
    const toolCalls: ToolCallRecord[] = [];
    // `worker.on("message", ...)` is a Node EventEmitter listener — Node
    // neither awaits nor catches the promise it returns. Once the Worker has
    // been terminated (killTimer fires, "done"/"error" resolves, or the
    // fiber is interrupted — see the finalizer below), a `postMessage` for an
    // in-flight tool call racing that termination throws on a dead Worker,
    // and being inside an unawaited async listener that throw becomes an
    // unhandled promise rejection rather than surfacing through `resume`.
    // This flag makes every post-termination message send a no-op instead.
    let terminated = false;
    const safeTerminate = async () => {
      if (terminated) return;
      terminated = true;
      await worker.terminate();
    };
    const safePostMessage = (msg: unknown) => {
      if (terminated) return;
      try {
        worker.postMessage(msg);
      } catch {
        // Worker died between the check above and this call — nothing to do,
        // nobody is listening for the response anymore either way.
      }
    };

    const killTimer = setTimeout(() => {
      void safeTerminate();
      resume(Effect.fail(new Error(`code-action sandbox timed out after ${timeoutMs}ms`)));
    }, timeoutMs);

    worker.on("message", async (msg: WorkerMessage) => {
      if (msg.type === "tool-call") {
        const handler = toolHandlers.get(msg.name);
        if (!handler) {
          safePostMessage({
            type: "tool-error",
            id: msg.id,
            error: `No handler registered for tool "${msg.name}"`,
          });
          return;
        }
        try {
          const startedAt = Date.now();
          const result = await handler(msg.args);
          toolCalls.push({
            name: msg.name,
            args: msg.args,
            result,
            durationMs: Date.now() - startedAt,
          });
          safePostMessage({ type: "tool-result", id: msg.id, result });
        } catch (err) {
          safePostMessage({
            type: "tool-error",
            id: msg.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
        return;
      }

      if (msg.type === "done") {
        clearTimeout(killTimer);
        await safeTerminate();
        resume(Effect.succeed({ finalResult: msg.result, toolCalls }));
        return;
      }

      if (msg.type === "error") {
        clearTimeout(killTimer);
        await safeTerminate();
        resume(Effect.fail(new Error(msg.message)));
      }
    });

    worker.on("error", (err) => {
      clearTimeout(killTimer);
      terminated = true;
      resume(Effect.fail(err instanceof Error ? err : new Error(String(err))));
    });

    const toolNames = Array.from(toolHandlers.keys());
    worker.postMessage({
      type: "init",
      code,
      toolNames,
      // Sanitized JS identifiers, index-aligned with toolNames — the worker
      // binds these as the Function parameter names (hyphenated tool names are
      // invalid JS identifiers) while dispatching under the ORIGINAL names.
      // Computed host-side so the worker needs no imports.
      paramNames: buildToolParamNames(toolNames),
    });

    // Interrupt finalizer: fiber interruption (run cancelled, kill switch,
    // Effect.race loss) runs this instead of resume() — terminates the
    // Worker so the sandboxed code and the OS thread it runs on actually
    // stop, rather than continuing unsupervised in the background.
    return Effect.sync(() => {
      clearTimeout(killTimer);
      void safeTerminate();
    });
  });
}
