import { writable } from "svelte/store";
import { createRun } from "./run.js";

export interface StructuredStreamState {
  /** Progressively-filled DeepPartial of the structured object. Updated on every TextDelta. */
  object: Record<string, unknown>;
  /** Raw accumulated text (JSON being streamed). */
  text: string;
  status: "idle" | "streaming" | "completed" | "error";
  error: string | null;
}

const toLegacy = (s: string): StructuredStreamState["status"] =>
  s === "streaming" || s === "awaiting-interaction" || s === "awaiting-approval"
    ? "streaming"
    : s === "completed"
      ? "completed"
      : s === "error"
        ? "error"
        : "idle";

/**
 * Create a reactive Svelte store that streams a structured JSON object token-by-token,
 * surfacing a `DeepPartial`-style `object` that updates as JSON arrives.
 *
 * Delegates all protocol/stream/state logic to `@reactive-agents/ui-core`
 * (`connectRunStream`/`reduceRunState` via `createRun({ objectMode: true })`) —
 * the surface below (signature + `StructuredStreamState` shape) is unchanged.
 *
 * @example
 * ```svelte
 * <script>
 *   import { createStructuredStream } from "@reactive-agents/svelte";
 *   const stream = createStructuredStream("/api/agent/structured");
 * </script>
 * <button on:click={() => stream.run("Generate a user profile")}>Run</button>
 * {#if $stream.object.name}<p>Name: {$stream.object.name}</p>{/if}
 * {#if $stream.status === "completed"}<pre>{JSON.stringify($stream.object, null, 2)}</pre>{/if}
 * ```
 */
const isTerminal = (status: string): boolean =>
  status === "completed" || status === "error" || status === "cancelled";

export function createStructuredStream(
  endpoint: string,
  _requestInit?: Omit<RequestInit, "method" | "body" | "signal">,
): { subscribe: ReturnType<typeof writable<StructuredStreamState>>["subscribe"]; run: (prompt: string, body?: Record<string, unknown>) => Promise<void>; cancel: () => void } {
  const inner = createRun({ endpoint, objectMode: true });
  const store = writable<StructuredStreamState>({ object: {}, text: "", status: "idle", error: null });

  // `run()`'s pre-rewire contract awaited the *entire* stream (it drove the
  // fetch reader loop to completion before returning) — callers such as the
  // existing behavioral tests rely on `await stream.run(...)` observing the
  // terminal state synchronously afterwards. `createRun.run()` itself is
  // fire-and-forget, so mirror `createAgent`'s resolver pattern to preserve
  // that awaiting contract without re-introducing hand-coded SSE parsing.
  let resolveRun: (() => void) | null = null;
  let lastStatus = "idle";

  inner.subscribe((rs) => {
    store.set({
      object: (rs.object as Record<string, unknown>) ?? {},
      text: rs.text,
      status: toLegacy(rs.status),
      error: rs.error ?? null,
    });
    if (rs.status !== lastStatus) {
      lastStatus = rs.status;
      if (isTerminal(rs.status)) {
        resolveRun?.();
        resolveRun = null;
      }
    }
  });

  return {
    subscribe: store.subscribe,
    run: (prompt: string, body?: Record<string, unknown>): Promise<void> =>
      new Promise<void>((resolve) => {
        lastStatus = "idle";
        resolveRun = resolve;
        inner.run(prompt, body);
      }),
    cancel: () => inner.cancel(),
  };
}
