<script lang="ts">
  /**
   * Model page Price section: the $/1M rates the framework bills this model's
   * calls at (llm-provider PriceBook, via `GET /api/models/capability`), beside
   * the Spend section. Local models read "free", unpriced ones "price unknown".
   * Rules: `priceStats` in `lib/model-page.ts`.
   */
  import { isFreePrice, isLocalPrice, priceSourceLabel, type ModelPrice } from "@reactive-agents/ui-core";
  import SettingsGroup from "$lib/components/settings/SettingsGroup.svelte";
  import StatGrid from "$lib/components/settings/StatGrid.svelte";
  import { priceStats } from "$lib/model-page.js";

  interface Props {
    /** `undefined` = unknown; `loading` while the capability request is in flight. */
    price: ModelPrice | undefined;
    loading?: boolean;
  }

  let { price, loading = false }: Props = $props();
  const items = $derived(priceStats(price));
</script>

<SettingsGroup id="price" title="Price" description="What this model's calls are billed at, per million tokens. Run costs in Cortex use these rates.">
  {#if loading}
    <p class="pc-empty" role="status">Loading price…</p>
  {:else if price === undefined}
    <p class="pc-empty">Price unknown. The framework has no rate for this model, so its calls carry no cost and run totals that include them are marked partial.</p>
  {:else if isLocalPrice(price)}
    <p class="pc-empty">Free (local). Local inference has no per-token bill.</p>
  {:else if isFreePrice(price)}
    <p class="pc-empty">Free. Calls are billed $0 per million input and output tokens (free tier; no paid tier price).</p>
    <p class="pc-source">Source: {priceSourceLabel(price)}</p>
  {:else}
    <div class="pc-grid"><StatGrid {items} /></div>
    <p class="pc-source">Source: {priceSourceLabel(price)}</p>
  {/if}
</SettingsGroup>

<style>
  .pc-grid { padding: 16px 16px 0; }
  .pc-empty { margin: 0; padding: 16px; font-size: var(--cortex-t-sm); color: var(--cortex-text-3); }
  .pc-source { margin: 0; padding: 8px 16px 16px; font-size: var(--cortex-t-xs); color: var(--cortex-text-3); }
</style>
