<script lang="ts">
  /**
   * Documents the session could not load (`DocumentIngestFailed`): the source and why.
   * Rendered above the input only when something failed, so a missing doc is never silent.
   */
  interface Props {
    failures: readonly { source: string; reason: string }[];
  }
  const { failures }: Props = $props();
</script>

{#if failures.length > 0}
  <div
    role="alert"
    data-testid="document-failures"
    class="mx-3 mb-2 rounded border border-[color:var(--cortex-warning,#d9a441)] bg-[var(--cortex-surface)] px-3 py-2 font-mono text-[10px] text-[var(--cortex-text)]"
  >
    <div class="mb-1 flex items-center gap-1 font-semibold">
      <span class="material-symbols-outlined text-[14px] leading-none">warning</span>
      {failures.length === 1 ? "1 document" : `${failures.length} documents`} could not be loaded
    </div>
    <ul class="space-y-0.5 text-[var(--cortex-text-muted)]">
      {#each failures as f (f.source)}
        <li class="break-all"><span class="text-[var(--cortex-text)]">{f.source}</span>: {f.reason}</li>
      {/each}
    </ul>
  </div>
{/if}
