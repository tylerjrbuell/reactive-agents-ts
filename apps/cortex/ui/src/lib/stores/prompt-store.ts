import { writable } from "svelte/store";
import { CORTEX_SERVER_URL } from "$lib/constants.js";

export const PROMPT_TYPES = ["system", "persona", "task", "snippet"] as const;
export type PromptType = (typeof PROMPT_TYPES)[number];

export interface StoredPrompt {
  id: number;
  name: string;
  body: string;
  type: PromptType;
  tags: string;
  createdAt: number;
  updatedAt: number;
}

export interface PromptSaveInput {
  name: string;
  body: string;
  type?: PromptType;
  tags?: string[];
}

const store = writable<StoredPrompt[]>([]);

export const promptStore = {
  subscribe: store.subscribe,

  async load() {
    try {
      const res = await fetch(`${CORTEX_SERVER_URL}/api/prompts`);
      if (res.ok) {
        const data: unknown = await res.json();
        if (Array.isArray(data)) store.set(data as StoredPrompt[]);
      }
    } catch {
      // ignore — server may not be reachable
    }
  },

  async save(input: PromptSaveInput): Promise<boolean> {
    try {
      const res = await fetch(`${CORTEX_SERVER_URL}/api/prompts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: input.name,
          body: input.body,
          type: input.type ?? "snippet",
          tags: input.tags ?? [],
        }),
      });
      if (res.ok) await promptStore.load();
      return res.ok;
    } catch {
      return false;
    }
  },

  async update(id: number, input: PromptSaveInput): Promise<boolean> {
    try {
      const res = await fetch(`${CORTEX_SERVER_URL}/api/prompts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: input.name,
          body: input.body,
          type: input.type ?? "snippet",
          tags: input.tags ?? [],
        }),
      });
      if (res.ok) await promptStore.load();
      return res.ok;
    } catch {
      return false;
    }
  },

  async delete(id: number): Promise<void> {
    try {
      await fetch(`${CORTEX_SERVER_URL}/api/prompts/${id}`, { method: "DELETE" });
    } catch {
      // ignore
    }
    store.update((list) => list.filter((p) => p.id !== id));
  },
};
