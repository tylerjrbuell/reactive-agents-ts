<script lang="ts">
  /**
   * Web-search provider order for the builder panel's Tools section (and the chat config panel,
   * which shares it). Maps to `.withTools({ webSearch: { providers } })` through
   * `rawConfig.tools.webSearch.providers`. Picking is ordering: the first pick is tried first, a
   * provider left out is never tried, and no pick means the framework's default chain (never
   * re-defaulted here). API keys are not set here: they come from Settings · Web search or the
   * server's environment, and the server passes them to the agent in code.
   */
  import Button from "$lib/components/kit/Button.svelte";
  import { WEB_SEARCH_CHOICES, toggleWebSearchProvider, webSearchOrder, webSearchPatch, webSearchSummary } from "$lib/web-search-providers.js";

  let { rawConfig = $bindable() }: { rawConfig: Record<string, unknown> } = $props();

  const order = $derived(webSearchOrder({ rawConfig }));
  const set = (next: readonly string[] | undefined) => {
    rawConfig = webSearchPatch({ rawConfig }, next).rawConfig;
  };
</script>

<div class="acp-field">
  <span class="config-label">Web search providers</span>
  <div class="acp-chips" role="group" aria-label="Web search providers, in the order they are tried">
    {#each WEB_SEARCH_CHOICES as choice (choice.id)}
      {@const place = order?.indexOf(choice.id) ?? -1}
      <button type="button" class="acp-toolchip" aria-pressed={place >= 0} onclick={() => set(toggleWebSearchProvider(order, choice.id))}>
        {#if place >= 0}<span class="acp-data">{place + 1}</span>{/if}
        {choice.label}
      </button>
    {/each}
    {#if order}<Button size="sm" variant="ghost" onclick={() => set(undefined)}>Default order</Button>{/if}
  </div>
  <p class="acp-hint leading-relaxed" data-testid="web-search-summary">{webSearchSummary(order)}</p>
  <p class="acp-hint leading-relaxed">Keys come from Settings · Web search or the server's environment.</p>
</div>
