<script lang="ts">
  import GuardedMarkdown from "$lib/components/GuardedMarkdown.svelte";
  import { parseCompactionSections } from "$lib/chat-compaction.js";

  interface Props {
    /** The stored summary markdown (structured sections, or plain text from older summaries). */
    markdown: string;
  }
  const { markdown }: Props = $props();

  const sections = $derived(parseCompactionSections(markdown));
</script>

{#if sections}
  <div class="flex flex-col gap-2.5" data-testid="compaction-sections">
    {#each sections as section, i (i)}
      <section class="flex flex-col gap-0.5">
        {#if section.heading !== ""}
          <h4 class="m-0 font-mono text-[10px] uppercase tracking-widest text-primary/80">{section.heading}</h4>
        {/if}
        <GuardedMarkdown markdown={section.body} class="text-[11px]" />
      </section>
    {/each}
  </div>
{:else}
  <GuardedMarkdown {markdown} class="text-[11px]" />
{/if}
