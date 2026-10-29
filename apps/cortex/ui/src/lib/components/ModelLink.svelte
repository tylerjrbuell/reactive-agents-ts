<script lang="ts">
  import Tooltip from "$lib/components/Tooltip.svelte";
  import { modelHref, providerHref } from "$lib/model-link.js";

  interface Props {
    provider?: string | undefined;
    /** Omit to link the provider's model list. */
    model?: string | undefined;
    /** Visible text; defaults to the model (or provider) id. */
    label?: string;
    class?: string;
  }
  const { provider, model, label, class: className = "" }: Props = $props();

  const href = $derived(provider ? (model ? modelHref(provider, model) : providerHref(provider)) : undefined);
  const text = $derived(label ?? model ?? provider ?? "");
</script>

{#if href}
  <Tooltip text={model ? `Open ${provider}/${model}` : `Open ${provider} models`}><a
    {href}
    class="no-underline text-inherit hover:underline hover:decoration-dotted underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ra-cyan,#22d3ee)] rounded-sm {className}"
    onclick={(e) => e.stopPropagation()}
  >{text}</a></Tooltip>
{:else}
  <span class={className}>{text}</span>
{/if}
