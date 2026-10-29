/**
 * skills/todo-targets.ts — resolve which checklist item(s) a `start`/`done`
 * call targets. Small models send the target as `id: 1`, `id: "1"`, `id: "1,2"`,
 * `ids: [1,2]`, `item: "fix bug"`, `index`, `number`, `n`, or a title; all of
 * these heal to a list of ledger ids. Pure; never throws.
 */
import type { AdvisoryItem } from "@reactive-agents/core";

/** Argument keys that may carry a target, in priority order. */
const TARGET_KEYS = ["id", "ids", "item", "items", "index", "number", "n"] as const;

/** True when the args carry any target-bearing key with a value. */
export function hasTodoTargets(args: Readonly<Record<string, unknown>>): boolean {
  return TARGET_KEYS.some((k) => args[k] != null);
}

export type TodoTargetResolution =
  | { readonly ok: true; readonly ids: readonly string[] }
  | { readonly ok: false; readonly error: string };

const NUMERIC = /^#?(\d+)(?:\.0+)?\.?$/;

function tokens(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.flatMap(tokens);
  if (typeof raw === "number" && Number.isFinite(raw)) return [String(Math.trunc(raw))];
  if (typeof raw === "string") {
    const t = raw.trim();
    if (t === "") return [];
    const parts = t.split(/\s*[,;]\s*/).filter(Boolean);
    return parts.length > 1 && parts.every((p) => NUMERIC.test(p)) ? parts : [t];
  }
  return [];
}

/**
 * Resolve the target ids of a start/done call against the current items.
 * Unknown or ambiguous targets yield an error naming the valid ids.
 */
export function resolveTodoTargets(
  items: readonly AdvisoryItem[],
  args: Readonly<Record<string, unknown>>,
): TodoTargetResolution {
  const raw = TARGET_KEYS.flatMap((k) => (args[k] != null ? tokens(args[k]) : []));
  const valid = items.map((t) => t.id).join(", ") || "none";
  if (raw.length === 0) {
    return { ok: false, error: `No todo item with id ${String(args.id)}.\nValid ids: ${valid}.` };
  }
  const ids: string[] = [];
  for (const tok of raw) {
    const m = NUMERIC.exec(tok);
    if (m) {
      const id = String(Number(m[1]));
      if (!items.some((t) => t.id === id)) {
        return { ok: false, error: `No todo item with id ${tok}.\nValid ids: ${valid}.` };
      }
      if (!ids.includes(id)) ids.push(id);
      continue;
    }
    const k = tok.trim().replace(/\s+/g, " ").toLowerCase();
    const exact = items.filter((t) => t.title.trim().replace(/\s+/g, " ").toLowerCase() === k);
    const hits = exact.length > 0 ? exact : items.filter((t) => t.title.toLowerCase().includes(k));
    if (hits.length !== 1) {
      return {
        ok: false,
        error:
          `No todo item with id ${tok}.\nValid ids: ${valid}.` +
          (hits.length > 1 ? ` "${tok}" matches ids ${hits.map((t) => t.id).join(", ")}; use one id.` : ""),
      };
    }
    const id = (hits[0] as AdvisoryItem).id;
    if (!ids.includes(id)) ids.push(id);
  }
  return { ok: true, ids };
}
