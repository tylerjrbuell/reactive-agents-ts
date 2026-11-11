<script lang="ts">
  /**
   * A row of labelled machine values (the Model page capability grid): a
   * text-3 label over a JetBrains Mono value, hairline-separated, as a `<dl>`.
   */
  interface Props {
    items: readonly { readonly label: string; readonly value: string }[];
  }

  let { items }: Props = $props();
</script>

<dl class="sg-stats">
  {#each items as item (item.label)}
    <div class="sg-stat">
      <dt>{item.label}</dt>
      <dd>{item.value}</dd>
    </div>
  {/each}
</dl>

<style>
  .sg-stats {
    margin: 0;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 1px;
    background: var(--cortex-line);
    border: 1px solid var(--cortex-line);
    border-radius: var(--cortex-r-ctl);
    overflow: hidden;
  }
  .sg-stat { background: var(--cortex-surface-1); padding: 10px 12px; min-width: 0; }
  dt { font-size: var(--cortex-t-xs); color: var(--cortex-text-3); }
  dd {
    margin: 2px 0 0;
    font-family: var(--cortex-font-data);
    font-size: var(--cortex-t-sm);
    font-variant-numeric: tabular-nums;
    color: var(--cortex-text);
    overflow-wrap: anywhere;
  }
</style>
