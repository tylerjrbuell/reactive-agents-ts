// apps/advocate/src/ingest/seen-store.ts
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { GatherDeps } from "./types.js";

export type SeenStore = Pick<GatherDeps, "isSeen" | "markSeen">;

/**
 * File-backed dedup store. Persists seen thread ids to disk (JSON array, bounded
 * to the most-recent `max`) so the agent never re-drafts the same thread across
 * restarts — more reliable than relying on the LLM's scratchpad discipline.
 */
export const makeFileSeenStore = (path: string, max = 5000): SeenStore => {
  const load = (): readonly string[] => {
    if (!existsSync(path)) return [];
    try {
      const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"));
      return Array.isArray(parsed)
        ? parsed.filter((x): x is string => typeof x === "string")
        : [];
    } catch {
      return [];
    }
  };

  const set = new Set<string>(load());

  return {
    isSeen: (id) => set.has(id),
    markSeen: (ids) => {
      for (const id of ids) set.add(id);
      const trimmed = [...set].slice(-max);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, JSON.stringify(trimmed), "utf-8");
    },
  };
};
