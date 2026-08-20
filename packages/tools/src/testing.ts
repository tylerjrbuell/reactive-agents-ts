import { Effect } from "effect";
import type { DefinedTool } from "./define-tool.js";

export interface TestToolResult<T = unknown> {
  readonly ok: boolean;
  readonly value?: T;
  readonly error?: unknown;
}

/**
 * Invokes a `DefinedTool`'s handler with raw args and resolves with a plain
 * `{ ok, value }` / `{ ok: false, error }` result instead of an `Effect` —
 * no `Effect.runPromise`/`runPromiseExit` boilerplate needed in a test file,
 * and failures resolve rather than throw so a single `expect(...)` chain
 * covers both the success and failure path.
 */
export async function testTool<T = unknown>(
  tool: DefinedTool,
  args: Record<string, unknown>,
): Promise<TestToolResult<T>> {
  const exit = await Effect.runPromiseExit(tool.handler(args));
  if (exit._tag === "Success") {
    return { ok: true, value: exit.value as T };
  }
  return { ok: false, error: exit.cause };
}

/**
 * Stubs `global.fetch` to resolve once with the given status/body, then
 * returns a restore function that puts the original `fetch` back. Caller
 * MUST call the returned function (typically in the same `it` block, or an
 * `afterEach`) — this does not auto-restore.
 */
export function mockFetchOnce(response: { status?: number; body?: unknown }): () => void {
  const original = global.fetch;
  const { status = 200, body } = response;
  global.fetch = (async () =>
    new Response(body === undefined ? null : JSON.stringify(body), { status })) as unknown as typeof fetch;
  return () => {
    global.fetch = original;
  };
}
