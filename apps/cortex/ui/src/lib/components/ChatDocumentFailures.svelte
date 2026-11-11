<script lang="ts">
  /**
   * Documents the session could not load (`DocumentIngestFailed`): the source and why.
   * Rendered above the input only when something failed, so a missing doc is never silent.
   */
  import Icon from "$lib/components/kit/Icon.svelte";

  interface Props {
    failures: readonly { source: string; reason: string }[];
  }
  const { failures }: Props = $props();
</script>

{#if failures.length > 0}
  <div role="alert" data-testid="document-failures" class="docfail">
    <p class="h"><Icon name="alert" size="sm" />{failures.length === 1 ? "1 document" : `${failures.length} documents`} could not be loaded</p>
    <ul>
      {#each failures as f (f.source)}
        <li><span class="src">{f.source}</span>: {f.reason}</li>
      {/each}
    </ul>
  </div>
{/if}

<style>
  .docfail {
    margin: 0 0 8px;
    padding: 8px 12px;
    border-radius: var(--cortex-r-ctl);
    background: var(--cortex-warn-tint);
    font-size: var(--cortex-t-xs);
    color: var(--cortex-text-2);
  }
  .h { display: flex; align-items: center; gap: 6px; margin: 0 0 4px; font-weight: 600; color: var(--cortex-warn); }
  ul { display: grid; gap: 2px; margin: 0; padding: 0; list-style: none; }
  li { overflow-wrap: anywhere; }
  .src { font-family: var(--cortex-font-data); font-size: var(--cortex-t-2xs); color: var(--cortex-text); }
</style>
