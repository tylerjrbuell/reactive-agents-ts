<script lang="ts">
  /**
   * Tab list (WAI-ARIA tabs): `role="tablist"`, one `role="tab"` button per
   * item with an optional count, roving tabindex, arrows / Home / End move
   * (`lib/tablist.ts`). The consumer renders the panel with
   * `id={tabPanelId(idBase, value)}` and `aria-labelledby={tabId(idBase, value)}`.
   */
  import { nextTabIndex, tabId, tabPanelId } from "../../tablist.js";

  /** One tab. */
  interface TabItem {
    readonly id: string;
    readonly label: string;
    readonly count?: number;
  }

  interface Props {
    items: readonly TabItem[];
    /** Selected tab id (bindable). */
    value: string;
    /** Accessible name of the tab list. */
    label: string;
    /** Prefix for tab and panel ids. */
    idBase: string;
    onchange?: (id: string) => void;
    class?: string;
  }

  let { items, value = $bindable(), label, idBase, onchange, class: className = "" }: Props = $props();

  let buttons: HTMLButtonElement[] = $state([]);

  function select(id: string) {
    if (id === value) return;
    value = id;
    onchange?.(id);
  }

  function onKeydown(e: KeyboardEvent, index: number) {
    const next = nextTabIndex(index, e.key, items.length);
    if (next === null) return;
    e.preventDefault();
    const item = items[next];
    if (!item) return;
    select(item.id);
    buttons[next]?.focus();
  }
</script>

<div class="cx-tabs {className}" role="tablist" aria-label={label}>
  {#each items as item, i (item.id)}
    <button
      bind:this={buttons[i]}
      type="button"
      role="tab"
      id={tabId(idBase, item.id)}
      aria-selected={item.id === value}
      aria-controls={tabPanelId(idBase, item.id)}
      tabindex={item.id === value ? 0 : -1}
      onclick={() => select(item.id)}
      onkeydown={(e) => onKeydown(e, i)}
    >
      {item.label}
      {#if item.count !== undefined}<span class="cx-tab-n">{item.count}</span>{/if}
    </button>
  {/each}
</div>

<style>
  /* overflow-x makes overflow-y compute to auto, and the selected tab's -1px margin then adds a 1px
     vertical scroll: the stray dark bar at the row's right edge. Clip the vertical axis. */
  .cx-tabs { display: flex; gap: 16px; border-bottom: 1px solid var(--cortex-line); overflow-x: auto; overflow-y: hidden; scrollbar-width: none; }
  .cx-tabs::-webkit-scrollbar { display: none; }
  [role="tab"] {
    appearance: none;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-bottom: -1px;
    padding: 10px 2px;
    border: 0;
    border-bottom: 2px solid transparent;
    background: none;
    color: var(--cortex-text-2);
    font-family: var(--cortex-font-ui);
    font-size: var(--cortex-t-sm);
    font-weight: 500;
    white-space: nowrap;
    cursor: pointer;
  }
  [role="tab"]:hover { color: var(--cortex-text); }
  [role="tab"][aria-selected="true"] { color: var(--cortex-text); border-bottom-color: var(--cortex-accent); }
  /* Inset: the row clips the vertical axis, so an outer ring would be cut off. */
  [role="tab"]:focus-visible { outline: 2px solid var(--cortex-focus); outline-offset: -2px; border-radius: 4px; }
  /* Geist digits with tabular figures: JetBrains Mono's slashed zero reads as an 8 at this size. */
  .cx-tab-n { font-family: var(--cortex-font-ui); font-size: var(--cortex-t-xs); font-variant-numeric: tabular-nums; color: var(--cortex-text-3); }
</style>
