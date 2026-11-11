<script lang="ts">
  /**
   * Model page Spend section (roadmap C13): tokens and framework-priced spend
   * on this provider/model over its recent finished runs, and spend per
   * successful run. Rules: `costStats` in `lib/model-insights.ts`.
   */
  import SettingsGroup from "$lib/components/settings/SettingsGroup.svelte";
  import StatGrid from "$lib/components/settings/StatGrid.svelte";
  import { costStats, type ModelCost } from "$lib/model-insights.js";

  interface Props {
    cost: ModelCost | null;
  }

  let { cost }: Props = $props();
  const items = $derived(costStats(cost));
</script>

<SettingsGroup id="spend" title="Spend" description="This model's calls over its last 50 runs in Cortex, priced by the framework when each call finished.">
  {#if items.length === 0}
    <p class="ms-empty">No model calls recorded yet.</p>
  {:else}
    <div class="ms-grid"><StatGrid {items} /></div>
  {/if}
</SettingsGroup>

<style>
  .ms-grid { padding: 16px; }
  .ms-empty { margin: 0; padding: 16px; font-size: var(--cortex-t-sm); color: var(--cortex-text-3); }
</style>
