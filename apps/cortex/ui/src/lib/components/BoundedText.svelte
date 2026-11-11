<script lang="ts">
  /**
   * Large-text-safe block: shows a bounded slice, reveals more on demand, copies the
   * FULL text. Use anywhere a model / tool payload of unknown size is displayed.
   */
  import { PREVIEW_CHARS, formatSize, nextReveal, visibleSlice } from "$lib/text-budget.js";
  import { toast } from "$lib/stores/toast-store.js";

  interface Props {
    text: string;
    /** Chars shown initially. */
    preview?: number;
    /** Tailwind classes for the text itself (size/color). */
    class?: string;
    /** Max height of the scroll area. */
    maxHeight?: string;
    /** Show the copy-all control. */
    copy?: boolean;
  }
  let { text, preview = PREVIEW_CHARS, class: className = "text-[10px] text-text/70", maxHeight = "20rem", copy = true }: Props = $props();

  // `preview` is a one-time seed; revealing only ever grows it.
  let revealed = $state(0);
  const budget = $derived(Math.max(revealed, preview));
  const slice = $derived(visibleSlice(text, budget));

  async function copyAll() {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied", `${formatSize(text.length)} copied`);
    } catch {
      toast.error("Copy failed");
    }
  }
</script>

<div class="rounded border border-[var(--cortex-line)] bg-[var(--cortex-surface-2)]/60">
  <div class="overflow-auto p-2" style="max-height: {maxHeight}">
    <pre class="m-0 whitespace-pre-wrap break-words font-mono leading-relaxed {className}">{slice.shown}</pre>
  </div>
  {#if slice.hidden > 0 || copy}
    <div class="flex items-center gap-2 border-t border-[var(--cortex-line)] px-2 py-1 font-mono text-[9px] text-[var(--cortex-text-2)]">
      {#if slice.hidden > 0}
        <span>{formatSize(slice.hidden)} hidden</span>
        <button type="button" class="cursor-pointer rounded border border-[var(--cortex-line)] bg-transparent px-1.5 py-0.5 text-accent hover:bg-accent-fill/10" onclick={() => (revealed = nextReveal(budget))}>Show more</button>
        <button type="button" class="cursor-pointer rounded border border-[var(--cortex-line)] bg-transparent px-1.5 py-0.5 text-accent hover:bg-accent-fill/10" onclick={() => (revealed = text.length)}>Show all</button>
      {:else}
        <span>{formatSize(text.length)}</span>
      {/if}
      {#if copy}
        <button type="button" class="ml-auto cursor-pointer rounded border border-[var(--cortex-line)] bg-transparent px-1.5 py-0.5 hover:text-[var(--cortex-text)]" onclick={copyAll}>Copy all</button>
      {/if}
    </div>
  {/if}
</div>
