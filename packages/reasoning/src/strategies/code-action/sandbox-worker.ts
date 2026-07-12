import { parentPort } from "node:worker_threads";

if (!parentPort) throw new Error("sandbox-worker must run in a Worker thread");

interface InitMessage {
  type: "init";
  code: string;
  toolNames: string[];
  /**
   * Sanitized JS identifiers, index-aligned with `toolNames`. Hyphenated tool
   * names (file-write, code-execute — every real builtin) are syntactically
   * invalid as `new Function` parameter names; the host computes valid ones
   * (tool-binding.ts `buildToolParamNames`) and the worker binds THOSE, while
   * `tool-call` messages keep the ORIGINAL name for dispatch. Falls back to
   * `toolNames` when absent (already-valid identifiers only).
   */
  paramNames?: string[];
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
    const paramNames = msg.paramNames ?? toolNames;

    // One binding per tool: the sandbox-visible function is named by the
    // sanitized identifier; the dispatch message carries the ORIGINAL name.
    const argValues = toolNames.map((name) => {
      return (args: unknown): Promise<unknown> => {
        const id = `call-${++callCounter}-${Date.now()}`;
        return new Promise((resolve, reject) => {
          pending.set(id, { resolve, reject });
          parentPort!.postMessage({ type: "tool-call", id, name, args });
        });
      };
    });

    // Models routinely emit TypeScript annotations (`const n: number = …`)
    // no matter what the prompt demands — and `new Function` parses plain
    // JavaScript, so a single annotation used to kill the whole run
    // ("Unexpected token ':'", probe p7 2026-07-11: 10/10 attempts failed on
    // this). Under bun, transpile TS→JS first; elsewhere the raw code runs
    // as-is (plain-JS output is unchanged by the transpile).
    let evalCode = code;
    const BunGlobal = (globalThis as { Bun?: { Transpiler?: new (opts: { loader: string }) => { transformSync: (src: string) => string } } }).Bun;
    if (BunGlobal?.Transpiler) {
      try {
        // The transpiler emits a statement (trailing `;`) — strip it so the
        // result stays a plain expression for the `return (…)` wrapper.
        evalCode = new BunGlobal.Transpiler({ loader: "ts" })
          .transformSync(code)
          .trim()
          .replace(/;+\s*$/, "");
      } catch {
        // Not valid TS either — let new Function surface the real parse error.
      }
    }

    try {
      // new Function is intentional here — the worker sandbox is the
      // isolation boundary; user-supplied code runs inside the Worker process.
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const fn = new Function(
        ...paramNames,
        `"use strict"; return (${evalCode});`,
      ) as (...args: unknown[]) => Promise<unknown>;

      const result = await fn(...argValues);
      parentPort!.postMessage({ type: "done", result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      parentPort!.postMessage({ type: "error", message });
    }
  }
});
