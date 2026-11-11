<script lang="ts">
  // Op E: partial/final structured-output preview under an assistant turn; updates live as it streams.
  import Icon from "$lib/components/kit/Icon.svelte";

  interface Props {
    value: Record<string, unknown> | undefined;
  }
  const { value }: Props = $props();
</script>

{#if value && Object.keys(value).length > 0}
  <div class="so">
    <p class="h"><Icon name="code" size="sm" />Structured output</p>
    <pre>{JSON.stringify(value, null, 2)}</pre>
  </div>
{/if}

<style>
  .so { max-width: var(--cortex-measure); padding: 10px 12px; border: 1px solid var(--cortex-line); border-radius: var(--cortex-r-ctl); background: var(--cortex-surface-1); }
  .h { display: flex; align-items: center; gap: 6px; margin: 0 0 6px; font-size: var(--cortex-t-xs); color: var(--cortex-text-2); }
  .h :global(.cx-icon) { color: var(--cortex-io); }
  pre { margin: 0; overflow-x: auto; font-family: var(--cortex-font-data); font-size: var(--cortex-t-2xs); line-height: var(--cortex-lh-ui); color: var(--cortex-text); white-space: pre; }
</style>
