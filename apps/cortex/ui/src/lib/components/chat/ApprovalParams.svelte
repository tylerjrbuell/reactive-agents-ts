<script lang="ts">
  // The parameters of a gated tool call: one quiet row per argument (long values clipped to a line),
  // and when a row loses something (a long, multi-line or nested value) an expander with the full
  // text. Credential-shaped tokens are masked in both (`redactSecrets`).
  import { approvalArgRows, approvalArgsNeedDetail, approvalFullArgs } from "$lib/chat-approvals.js";

  interface Props {
    args: unknown;
  }
  const { args }: Props = $props();

  const rows = $derived(approvalArgRows(args));
  const detail = $derived(approvalArgsNeedDetail(args) ? approvalFullArgs(args) : "");
</script>

{#if rows.length > 0}
  <dl class="args" data-testid="approval-params">
    {#each rows as row (row.key)}
      <dt>{row.key}</dt>
      <dd>{row.value}</dd>
    {/each}
  </dl>
  {#if detail !== ""}
    <details class="full" data-testid="approval-params-full">
      <summary>Show full parameters</summary>
      <pre>{detail}</pre>
    </details>
  {/if}
{/if}

<style>
  .args { display: grid; grid-template-columns: auto 1fr; gap: 2px 12px; margin: 0; font-family: var(--cortex-font-data); font-size: var(--cortex-t-2xs); }
  dt { color: var(--cortex-text-3); }
  dd { margin: 0; min-width: 0; overflow-wrap: anywhere; color: var(--cortex-text); }
  .full { font-size: var(--cortex-t-xs); color: var(--cortex-text-3); }
  summary { cursor: pointer; width: fit-content; }
  summary:focus-visible { outline: 2px solid var(--cortex-accent); outline-offset: 2px; border-radius: 4px; }
  pre {
    margin: 6px 0 0;
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
