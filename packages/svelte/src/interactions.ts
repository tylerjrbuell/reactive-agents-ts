// packages/svelte/src/interactions.ts
import { writable } from "svelte/store";
import type { FetchLike } from "@reactive-agents/ui-core";

export interface CreateInteractionsOptions {
  readonly interactionEndpoint: string;
  readonly fetchImpl?: FetchLike;
}
export interface InteractionsStore {
  subscribe: ReturnType<typeof writable<{ pending: boolean; error: string | null }>>["subscribe"];
  respond: (runId: string, interactionId: string, value: unknown) => Promise<{ success: boolean; output: string }>;
}

export function createInteractions(opts: CreateInteractionsOptions): InteractionsStore {
  const store = writable<{ pending: boolean; error: string | null }>({ pending: false, error: null });
  const fetchImpl = opts.fetchImpl ?? fetch;
  const respond = async (runId: string, interactionId: string, value: unknown) => {
    store.set({ pending: true, error: null });
    try {
      const res = await fetchImpl(opts.interactionEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId, interactionId, value }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as { success: boolean; output: string };
    } catch (err) {
      store.set({ pending: false, error: err instanceof Error ? err.message : String(err) });
      return { success: false, output: "" };
    } finally {
      store.update((s) => ({ ...s, pending: false }));
    }
  };
  return { subscribe: store.subscribe, respond };
}
