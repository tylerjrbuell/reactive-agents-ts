<script lang="ts">
  // The parameters of a gated tool call, shown once: one quiet row per argument (long values clipped
  // to a line) and, when a row loses something (a long, multi-line or nested value), a toggle that
  // swaps the rows for the full text. Summary and full text are never visible together.
  // Credential-shaped tokens are masked in both (`redactSecrets`).
  import { approvalArgRows, approvalArgsNeedDetail, approvalFullArgs } from "$lib/chat-approvals.js";

  interface Props {
    args: unknown;
    /** Start with the full parameters shown instead of the summary rows. */
    open?: boolean;
  }
  const { args, open = false }: Props = $props();

  const rows = $derived(approvalArgRows(args));
  const detail = $derived(approvalArgsNeedDetail(args) ? approvalFullArgs(args) : "");
  // svelte-ignore state_referenced_locally — the initial state only; the person owns it after
  let expanded = $state(open);
  const showFull = $derived(expanded && detail !== "");
</script>

{#if rows.length > 0}
  {#if showFull}
    <pre data-testid="approval-params-full">{detail}</pre>
  {:else}
    <dl class="args" data-testid="approval-params">
      {#each rows as row (row.key)}
        <dt>{row.key}</dt>
        <dd>{row.value}</dd>
      {/each}
    </dl>
  {/if}
  {#if detail !== ""}
    <button type="button" class="toggle" aria-expanded={showFull} data-testid="approval-params-toggle" onclick={() => (expanded = !expanded)}>
      {showFull ? "Show summary" : "Show full parameters"}
    </button>
  {/if}
{/if}

<style>
  .args { display: grid; grid-template-columns: auto 1fr; gap: 2px 12px; margin: 0; font-family: var(--cortex-font-data); font-size: var(--cortex-t-2xs); }
  dt { color: var(--cortex-text-3); }
  dd { margin: 0; min-width: 0; overflow-wrap: anywhere; color: var(--cortex-text); }
  .toggle { width: fit-content; padding: 0; border: 0; background: none; font: inherit; font-size: var(--cortex-t-xs); color: var(--cortex-text-3); cursor: pointer; }
  .toggle:hover { color: var(--cortex-text-2); }
  .toggle:focus-visible { outline: 2px solid var(--cortex-accent); outline-offset: 2px; border-radius: 4px; }
  pre {
    margin: 0;
    max-height: 16rem;
    overflow: auto;
    padding: 8px 10px;
    border-radius: var(--cortex-r-panel);
    background: var(--cortex-surface-2);
    font-family: var(--cortex-font-data);
    font-size: var(--cortex-t-2xs);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    color: var(--cortex-text);
  }
</style>
