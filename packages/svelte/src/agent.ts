import { writable } from "svelte/store";

export interface AgentState {
  output: string | null;
  loading: boolean;
  error: string | null;
}

export function createAgent(
  endpoint: string,
  requestInit?: Omit<RequestInit, "method" | "body">,
) {
  const store = writable<AgentState>({ output: null, loading: false, error: null });

  async function run(prompt: string, body?: Record<string, unknown>): Promise<string> {
    store.update((s) => ({ ...s, loading: true, error: null, output: null }));
    try {
      const res = await fetch(endpoint, {
        ...requestInit,
        method: "POST",
        headers: { "Content-Type": "application/json", ...requestInit?.headers },
        body: JSON.stringify({ prompt, ...body }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      const data = (await res.json()) as { output?: string; result?: string };
      const result = data.output ?? data.result ?? "";
      store.update((s) => ({ ...s, output: result, loading: false }));
      return result;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      store.update((s) => ({ ...s, error: msg, loading: false }));
      throw err;
    }
  }

  return { subscribe: store.subscribe, run };
}
