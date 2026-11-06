<script lang="ts">
  // Op E: partial/final structured-output preview under an assistant turn; updates live as it streams.
  interface Props {
    value: Record<string, unknown> | undefined;
  }
  const { value }: Props = $props();
</script>

{#if value && Object.keys(value).length > 0}
  <div class="mt-2 rounded-lg border border-[color:var(--cortex-border)] bg-[var(--cortex-surface-mid)]/40 p-2">
    <div class="mb-1 flex items-center gap-1.5">
      <span class="material-symbols-outlined text-[13px] text-secondary/80">data_object</span>
      <span class="font-mono text-[9px] uppercase tracking-wide text-[var(--cortex-text-muted)]">Structured output</span>
    </div>
    <pre class="m-0 overflow-x-auto font-mono text-[10px] leading-snug text-[var(--cortex-text)] whitespace-pre">{JSON.stringify(value, null, 2)}</pre>
  </div>
{/if}
