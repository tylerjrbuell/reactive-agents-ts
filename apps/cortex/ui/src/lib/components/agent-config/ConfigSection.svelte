<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    /** Section id: drives the `acp-section-*` / `acp-head-*` / `acp-panel-*` ids. */
    id: string;
    open: boolean;
    onToggle: () => void;
    /** Icon, title and summary shown in the collapsible head. */
    head: Snippet;
    /** The section body (rendered while open). */
    children: Snippet;
  }
  const { id, open, onToggle, head, children }: Props = $props();
</script>

  <div id="acp-section-{id}" class="acp-section acp-section-shell border border-[var(--cortex-border)] rounded-xl overflow-hidden">
    <button type="button"
      id="acp-head-{id}"
      class="acp-section-trigger"
      aria-expanded={open}
      aria-controls="acp-panel-{id}"
      onclick={() => onToggle()}>
      {@render head()}
      <span class="ml-auto material-symbols-outlined text-[14px] text-[var(--cortex-text-muted)] transition-transform duration-200 {open ? '' : '-rotate-90'}" aria-hidden="true">expand_more</span>
    </button>
    {#if open}
      <div id="acp-panel-{id}" class="acp-section-body" role="region" aria-labelledby="acp-head-{id}">
        {@render children()}
      </div>
    {/if}
  </div>
