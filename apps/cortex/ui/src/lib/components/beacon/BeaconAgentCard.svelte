<script lang="ts">
  /**
   * One card in the Board's Agents grid: status dot, name, source (or "needs
   * you"), the last line (question, error or task) and model / tokens / time.
   * The whole card links to the run. Model: `AgentRow` from `lib/beacon-board.ts`.
   */
  import { formatRelativeTime } from "@reactive-agents/ui-core";
  import Badge from "../kit/Badge.svelte";
  import Status from "../kit/Status.svelte";
  import type { AgentRow } from "../../beacon-board.js";

  interface Props {
    row: AgentRow;
    now: number;
  }

  let { row, now }: Props = $props();
  const needsYou = $derived(row.status.tone === "attention");
</script>

<a class="agent" href="/run/{row.runId}" data-run-id={row.runId} data-tone={row.status.tone}>
  <span class="top">
    <Status tone={row.status.tone} label={row.status.label} dotOnly />
    <span class="nm">{row.name}</span>
    {#if needsYou}<Badge tone="warn">needs you</Badge>{:else}<Badge>{row.source}</Badge>{/if}
  </span>
  <span class="last" class:empty={!row.last}>{row.last || row.status.label}</span>
  <span class="data">
    {#if row.model}<span class="model">{row.model}</span>{/if}
    {#if row.tokens}<span>{row.tokens}</span>{/if}
    {#if row.at}<span>{formatRelativeTime(row.at, now)}</span>{/if}
  </span>
</a>

<style>
  .agent {
    display: grid;
    gap: 6px;
    min-width: 0;
    padding: 12px 16px;
    border-radius: var(--cortex-r-panel);
    background: var(--cortex-surface-1);
    border: 1px solid var(--cortex-line);
    color: inherit;
    text-decoration: none;
    transition: border-color var(--cortex-d-fast) var(--cortex-ease-out);
  }
  .agent:hover { border-color: var(--cortex-line-strong); }
  .agent:focus-visible { outline: 2px solid var(--cortex-focus); outline-offset: 2px; }
  .top { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .top :global(.cx-badge) { margin-left: auto; flex: none; }
  .nm { min-width: 0; font-weight: 600; font-size: var(--cortex-t-sm); color: var(--cortex-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .last { font-size: var(--cortex-t-xs); color: var(--cortex-text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .last.empty { color: var(--cortex-text-3); }
  .data {
    display: flex;
    gap: 12px;
    min-width: 0;
    font-family: var(--cortex-font-data);
    font-size: var(--cortex-t-2xs);
    color: var(--cortex-text-3);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .model { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
</style>
