<script lang="ts">
  /**
   * The one shell of the three Lab > Tools tabs: a list column (header with the search and the one
   * primary action, a meta line with the count and a small action, then the scrolling rows) beside a
   * detail pane. Every tab fills the snippets, so spacing, scrolling, focus and narrow-width
   * stacking are decided here once. Rows use the shared `.tsh-row` card; the empty, loading and
   * error notes use `.tsh-note`.
   */
  import type { Snippet } from "svelte";

  interface Props {
    /** Accessible name of the list column. */
    listLabel: string;
    /** The search and the tab's one primary action. */
    bar: Snippet;
    /** The count and a small secondary action (Recheck all). */
    meta?: Snippet;
    list: Snippet;
    detail: Snippet;
  }
  const { listLabel, bar, meta, list, detail }: Props = $props();
</script>

<div class="tsh">
  <section class="tsh-left" aria-label={listLabel}>
    <div class="tsh-bar">{@render bar()}</div>
    {#if meta}<div class="tsh-meta">{@render meta()}</div>{/if}
    <div class="tsh-rows">{@render list()}</div>
  </section>
  <section class="tsh-right" aria-label="Details">{@render detail()}</section>
</div>

<style>
  .tsh { flex: 1; min-height: 420px; display: grid; grid-template-columns: minmax(240px, 320px) minmax(0, 1fr); grid-template-rows: minmax(0, 1fr); gap: 16px; }
  .tsh-left { display: flex; flex-direction: column; gap: 8px; min-width: 0; min-height: 0; }
  .tsh-bar { display: flex; align-items: center; justify-content: flex-end; gap: 8px; min-width: 0; }
  .tsh-bar :global(.cx-control) { flex: 1 1 0; min-width: 0; }
  .tsh-meta { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 26px; font-size: var(--cortex-t-xs); color: var(--cortex-text-3); }
  .tsh-rows { flex: 1; display: grid; align-content: start; gap: 6px; min-height: 0; overflow-y: auto; scrollbar-gutter: stable; padding-right: 2px; }
  .tsh-right { min-width: 0; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; }

  .tsh :global(.tsh-row) {
    display: grid; gap: 4px; width: 100%; padding: 10px 12px; text-align: left; box-sizing: border-box;
    border: 1px solid var(--cortex-line); border-radius: var(--cortex-r-ctl); background: var(--cortex-surface-1);
    font-family: var(--cortex-font-ui); cursor: pointer;
  }
  .tsh :global(.tsh-row:hover) { background: var(--cortex-surface-2); }
  .tsh :global(.tsh-row[aria-current="true"]) { border-color: color-mix(in srgb, var(--cortex-accent) 45%, transparent); background: var(--cortex-accent-tint); }
  .tsh :global(.tsh-row:focus-visible) { outline: 2px solid var(--cortex-focus); outline-offset: 2px; }
  .tsh :global(.tsh-row.dim) { opacity: 0.75; }
  .tsh :global(.tsh-note) { margin: 0; padding: 4px 0; font-size: var(--cortex-t-sm); color: var(--cortex-text-3); line-height: var(--cortex-lh-ui); }
  .tsh :global(.tsh-skel) { display: grid; gap: 6px; }
  .tsh :global(.tsh-skel .chat-skeleton) { height: 58px; border-radius: var(--cortex-r-ctl); }

  @media (max-width: 1000px) {
    .tsh { grid-template-columns: minmax(0, 1fr); grid-template-rows: none; min-height: 0; }
    .tsh-rows { flex: none; max-height: 280px; }
    .tsh-right { overflow-y: visible; }
  }
</style>
