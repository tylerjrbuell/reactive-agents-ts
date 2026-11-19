/**
 * The "known models" list a UI shows when a provider's live model list fails
 * (no key, out of credits, network down): the framework's static presets plus
 * every model id the bundled PriceBook prices for that provider.
 *
 * Nothing is invented: ids come only from the presets and the PriceBook keys,
 * unchanged. The PriceBook has no alias table, so no alias family is collapsed.
 * Order makes the list readable: presets first (curated, provider default
 * leading), then general PriceBook ids, then dated / beta / preview / latest
 * variants. Within a group ids sort with numeric-aware comparison.
 */
import { pricedModelIds } from "./price-book/price-book.js";

/**
 * True when `id` names a variant of a general model rather than the general
 * model itself: a dated snapshot (`-0309`, `-20251001`, `-04-2026`) or a
 * beta / experimental / preview / latest channel.
 *
 * @param id - model id
 */
export function isVariantModelId(id: string): boolean {
  const lower = id.toLowerCase();
  return (
    /(^|-)(beta|experimental|exp|preview|latest)(-|$)/.test(lower) ||
    /-(\d{4}|\d{8})(-|$)/.test(lower) ||
    /-\d{2}-\d{2,4}(-|$)/.test(lower)
  );
}

const byIdNumeric = (a: string, b: string): number => a.localeCompare(b, "en", { numeric: true });

/**
 * PriceBook ids for `provider` not already listed, general ids before variants.
 *
 * @param provider - provider id
 * @param listed - ids already shown (presets); skipped here
 * @param keep - filter (e.g. the chat-model filter); unmatched ids are dropped
 * @returns ids in display order
 */
export function priceBookFallbackIds(
  provider: string,
  listed: ReadonlySet<string>,
  keep: (id: string) => boolean,
): readonly string[] {
  const ids = pricedModelIds(provider).filter((id) => !listed.has(id) && keep(id));
  const general = ids.filter((id) => !isVariantModelId(id)).sort(byIdNumeric);
  const variants = ids.filter(isVariantModelId).sort(byIdNumeric);
  return [...general, ...variants];
}
