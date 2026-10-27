<script lang="ts">
  /**
   * Markdown that cannot take the tab down: small documents render immediately; large
   * ones open as bounded raw text and render only when the user asks (and even then
   * the render itself is capped).
   */
  import MarkdownRich from "$lib/components/MarkdownRich.svelte";
  import BoundedText from "$lib/components/BoundedText.svelte";
  import { MARKDOWN_AUTO_RENDER_LIMIT, formatSize } from "$lib/text-budget.js";

  interface Props {
    markdown: string;
    class?: string;
    showCopy?: boolean;
  }
  let { markdown, class: className = "", showCopy = true }: Props = $props();

  /** Hard ceiling for the markdown pipeline even after opt-in. */
  const RENDER_HARD_LIMIT = 250_000;

  let forced = $state(false);
  const large = $derived(markdown.length > MARKDOWN_AUTO_RENDER_LIMIT);
  const renderIt = $derived(!large || forced);
  const rendered = $derived(markdown.length > RENDER_HARD_LIMIT ? markdown.slice(0, RENDER_HARD_LIMIT) : markdown);
</script>

{#if renderIt}
  <MarkdownRich markdown={rendered} {showCopy} class={className} />
  {#if markdown.length > RENDER_HARD_LIMIT}
    <p class="mt-1 font-mono text-[9px] text-[var(--cortex-text-muted)]">
      Rendered the first {formatSize(RENDER_HARD_LIMIT)} of {formatSize(markdown.length)}. Copy for the full text.
    </p>
  {/if}
{:else}
  <div class="space-y-1.5">
    <div class="flex items-center gap-2 rounded border border-[var(--cortex-border)] bg-[var(--cortex-surface-mid)]/40 px-2 py-1 font-mono text-[10px] text-[var(--cortex-text-muted)]">
      <span class="material-symbols-outlined text-[14px]">description</span>
      <span>Large result ({formatSize(markdown.length)}) — shown as plain text to keep the page fast.</span>
      <button type="button" class="ml-auto cursor-pointer rounded border border-primary/30 bg-transparent px-2 py-0.5 text-primary hover:bg-primary/10" onclick={() => (forced = true)}>Render markdown</button>
    </div>
    <BoundedText text={markdown} class="text-[11px] text-on-surface/80" maxHeight="28rem" />
  </div>
{/if}
