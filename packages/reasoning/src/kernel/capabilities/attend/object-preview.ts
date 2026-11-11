/**
 * kernel/capabilities/attend/object-preview.ts — key order for the flat JSON
 * object preview in `compressToolResult`.
 *
 * REST APIs return flat objects padded with navigation keys. Live repro
 * 2026-11-10 (Cortex, ollama 9B): `gh api repos/<owner>/<repo>` returned a
 * 97-key object; the budget-scaled preview showed the first keys in order
 * (`id`, `node_id`, `name`, `full_name`, ...), `description` and
 * `stargazers_count` sat behind ~40 `*_url` keys, and the model reported the
 * wrong description.
 *
 * The rule is the tools layer's compact-preview rule (`render-result.ts`
 * `NOISE_KEY` and `SALIENT_FIELDS`), which the compact array preview and the
 * record-envelope preview already apply. Both are imported from
 * `@reactive-agents/tools`, so the rule has one home.
 */

import { NOISE_KEY, SALIENT_FIELDS } from "@reactive-agents/tools";

/**
 * The tools layer's `SALIENT_FIELDS`, plus `description`: a flat object
 * (repo, package, issue) states what it is in `description`.
 */
const SALIENT_KEYS: readonly string[] = [...SALIENT_FIELDS, "description"];

const isScalar = (v: unknown): boolean => v === null || typeof v !== "object";

/**
 * Entries of a flat object in preview order, and how many noise keys were
 * dropped. `capacity` is how many keys the preview budget can show.
 *
 * The original key order is kept, so the preview is unchanged, when the
 * object has no noise keys or when every key fits in `capacity` (nothing is
 * hidden, so there is no slot to reclaim; an http-get page's single `url`
 * stays visible). Otherwise noise keys are dropped and the rest is ordered:
 * salient keys (in `SALIENT_KEYS` order), then other scalar keys, then nested
 * objects and arrays, each group in original order.
 */
export function orderObjectPreviewEntries(
  obj: Record<string, unknown>,
  capacity: number,
): {
  readonly entries: ReadonlyArray<readonly [string, unknown]>;
  readonly omitted: number;
} {
  const all = Object.entries(obj);
  if (all.length <= capacity) return { entries: all, omitted: 0 };
  const kept = all.filter(([k]) => !NOISE_KEY.test(k));
  const omitted = all.length - kept.length;
  if (omitted === 0) return { entries: all, omitted: 0 };

  const salient = SALIENT_KEYS.flatMap((s) => kept.filter(([k]) => k === s));
  const rest = kept.filter(([k]) => !SALIENT_KEYS.includes(k));
  return {
    entries: [...salient, ...rest.filter(([, v]) => isScalar(v)), ...rest.filter(([, v]) => !isScalar(v))],
    omitted,
  };
}
