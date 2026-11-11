<script lang="ts">
  /**
   * Beacon's Board / Field segment (page header). Two toggle buttons with
   * `aria-pressed`; the page keeps the choice in the URL and localStorage.
   */
  import type { BeaconView } from "../../beacon-board.js";

  interface Props {
    view: BeaconView;
    onchange: (view: BeaconView) => void;
  }

  let { view, onchange }: Props = $props();

  const OPTIONS: readonly { readonly id: BeaconView; readonly label: string }[] = [
    { id: "board", label: "Board" },
    { id: "field", label: "Field" },
  ];
</script>

<div class="vseg" role="group" aria-label="View">
  {#each OPTIONS as o (o.id)}
    <button type="button" aria-pressed={view === o.id} data-view-btn={o.id} onclick={() => onchange(o.id)}>{o.label}</button>
  {/each}
</div>

<style>
  .vseg { display: inline-flex; padding: 2px; border-radius: 8px; background: var(--cortex-surface-2); }
  button {
    border: 0;
    background: none;
    padding: 5px 12px;
    border-radius: 6px;
    font: 500 var(--cortex-t-xs) var(--cortex-font-ui);
    color: var(--cortex-text-2);
    cursor: pointer;
  }
  button:hover { color: var(--cortex-text); }
  button[aria-pressed="true"] {
    background: var(--cortex-surface-1);
    color: var(--cortex-text);
    box-shadow: 0 0 0 1px var(--cortex-line-strong);
  }
  button:focus-visible { outline: 2px solid var(--cortex-focus); outline-offset: 2px; }
</style>
