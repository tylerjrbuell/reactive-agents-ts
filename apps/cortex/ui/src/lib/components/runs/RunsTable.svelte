<script lang="ts">
  /**
   * The Runs table (Bench spec section 8, `runs.html`): a sticky header, a
   * Pinned group then Recent, live rows with the accent edge, run names (not
   * ids) with their source, right-aligned mono numbers. A row opens its run;
   * the checkbox and the pin button act on the row without opening it. Pure
   * rules live in `lib/runs-table.ts`.
   */
  import { goto } from "$app/navigation";
  import Status from "$lib/components/kit/Status.svelte";
  import IconButton from "$lib/components/kit/IconButton.svelte";
  import { formatCost, formatRelativeTime, formatTurnDuration } from "@reactive-agents/ui-core";
  import { RUN_SOURCE_LABEL, runDurationMs, runNameOf, runRowStatus, runSourceOf, type RunRow } from "$lib/runs-table.js";

  interface Props {
    pinned: readonly RunRow[];
    recent: readonly RunRow[];
    pinnedIds: ReadonlySet<string>;
    selected: ReadonlySet<string>;
    /** Clock for relative times and live durations. */
    now: number;
    /** Strategy id to display name (framework manifest). */
    strategyLabel: (id: string) => string;
    onToggleSelect: (runId: string) => void;
    onToggleSelectAll: () => void;
    onTogglePin: (runId: string) => void;
  }
  const { pinned, recent, pinnedIds, selected, now, strategyLabel, onToggleSelect, onToggleSelectAll, onTogglePin }: Props = $props();

  const all = $derived([...pinned, ...recent]);
  const allSelected = $derived(all.length > 0 && all.every((r) => selected.has(r.runId)));
  const someSelected = $derived(!allSelected && all.some((r) => selected.has(r.runId)));

  let selectAll = $state<HTMLInputElement | null>(null);
  $effect(() => {
    if (selectAll) selectAll.indeterminate = someSelected;
  });

  function open(e: MouseEvent, runId: string) {
    // Clicks on the row's own controls (checkbox, pin, the name link) handle themselves.
    if (e.target instanceof Element && e.target.closest("a, button, input, label")) return;
    void goto(`/run/${encodeURIComponent(runId)}`);
  }
</script>

{#snippet row(run: RunRow)}
  {@const status = runRowStatus(run)}
  {@const isPinned = pinnedIds.has(run.runId)}
  {@const ms = runDurationMs(run, now)}
  <!-- The row is a large click target for the name link inside it; keyboard users reach the link. -->
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
  <tr class:live={status.tone === "running"} class:sel={selected.has(run.runId)} onclick={(e) => open(e, run.runId)}>
    <td class="c-sel">
      <input type="checkbox" checked={selected.has(run.runId)} onchange={() => onToggleSelect(run.runId)} aria-label="Select {runNameOf(run)}" />
    </td>
    <td><Status tone={status.tone} label={status.label} /></td>
    <td>
      <div class="c-run">
        <a href="/run/{encodeURIComponent(run.runId)}" data-sveltekit-preload-data="hover" title={run.runId}>{runNameOf(run)}</a>
        <span class="sub"><span>{RUN_SOURCE_LABEL[runSourceOf(run)]}</span><span class="data">{run.runId.slice(0, 8)}</span>{#if run.hasDebrief}<span>debrief</span>{/if}</span>
      </div>
    </td>
    <td class="data c-model" title={run.provider ? `${run.provider} / ${run.model ?? ""}` : undefined}>{run.model ?? "—"}</td>
    <td class="c-strat">{run.strategy ? strategyLabel(run.strategy) : "—"}</td>
    <td class="num data">{run.iterationCount}</td>
    <td class="num data">{run.tokensUsed.toLocaleString()}</td>
    <td class="num data">{formatCost(run.cost ?? 0)}</td>
    <td class="num data">{ms !== undefined ? formatTurnDuration(ms) : "—"}</td>
    <td class="faint" title={new Date(run.startedAt).toLocaleString()}>{formatRelativeTime(run.startedAt, now)}</td>
    <td class="c-pin">
      <IconButton icon="pin" label={isPinned ? "Unpin run" : "Pin run"} pressed={isPinned} size="sm" class={isPinned ? "pin-on" : "pin"} onclick={() => onTogglePin(run.runId)} />
    </td>
  </tr>
{/snippet}

<div class="wrap">
  <table>
    <thead>
      <tr>
        <th class="c-sel"><input bind:this={selectAll} type="checkbox" checked={allSelected} onchange={onToggleSelectAll} aria-label="Select all runs in view" /></th>
        <th>Status</th>
        <th>Run</th>
        <th>Model</th>
        <th>Strategy</th>
        <th class="num">Steps</th>
        <th class="num">Tokens</th>
        <th class="num">Cost</th>
        <th class="num">Time</th>
        <th>Started</th>
        <th class="c-pin"><span class="sr-only">Pin</span></th>
      </tr>
    </thead>
    <tbody>
      {#if pinned.length > 0}
        <tr class="group"><td colspan="11">Pinned</td></tr>
        {#each pinned as run (run.runId)}{@render row(run)}{/each}
        {#if recent.length > 0}<tr class="group"><td colspan="11">Recent</td></tr>{/if}
      {/if}
      {#each recent as run (run.runId)}{@render row(run)}{/each}
    </tbody>
  </table>
</div>

<style>
  .wrap {
    border: 1px solid var(--cortex-line);
    border-radius: var(--cortex-r-panel);
    background: var(--cortex-surface-1);
    overflow: clip;
  }
  table { width: 100%; border-collapse: separate; border-spacing: 0; font-size: var(--cortex-t-sm); color: var(--cortex-text); }
  /* Narrow windows: drop Strategy, Steps and Time (the run view has them) so the table fits without clipping. */
  @media (max-width: 960px) {
    th:nth-child(5), td:nth-child(5),
    th:nth-child(6), td:nth-child(6),
    th:nth-child(9), td:nth-child(9) { display: none; }
  }
  th {
    position: sticky;
    top: 0;
    z-index: var(--cortex-z-sticky);
    padding: 9px 12px;
    border-bottom: 1px solid var(--cortex-line);
    background: var(--cortex-surface-1);
    color: var(--cortex-text-3);
    font-size: var(--cortex-t-xs);
    font-weight: 500;
    text-align: left;
    white-space: nowrap;
  }
  td { padding: 9px 12px; border-bottom: 1px solid var(--cortex-line); vertical-align: middle; }
  tbody tr:last-child td { border-bottom: 0; }
  tbody tr:not(.group) { cursor: pointer; }
  tbody tr:not(.group):hover td { background: var(--cortex-surface-2); }
  tr.sel td { background: var(--cortex-surface-2); }
  tr.live td:first-child { box-shadow: inset 2px 0 0 var(--cortex-accent); }
  .num { text-align: right; }
  .data { font-family: var(--cortex-font-data); font-size: var(--cortex-t-xs); font-variant-numeric: tabular-nums; color: var(--cortex-text-2); }
  .faint { color: var(--cortex-text-3); font-size: var(--cortex-t-xs); white-space: nowrap; }
  .c-sel { width: 36px; }
  .c-pin { width: 40px; padding: 4px 8px; }
  .c-run { display: grid; gap: 2px; min-width: 0; }
  .c-run a { color: var(--cortex-text); font-weight: 500; text-decoration: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 36ch; }
  .c-run a:hover { text-decoration: underline; text-underline-offset: 2px; }
  .c-run a:focus-visible { outline: 2px solid var(--cortex-focus); outline-offset: 2px; border-radius: 4px; }
  .sub { display: flex; gap: 8px; color: var(--cortex-text-3); font-size: var(--cortex-t-xs); }
  .sub .data { color: var(--cortex-text-3); font-size: var(--cortex-t-2xs); }
  .c-model { max-width: 18ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .c-strat { color: var(--cortex-text-2); white-space: nowrap; }
  .group td { padding: 6px 12px; background: var(--cortex-canvas); color: var(--cortex-text-3); font-size: var(--cortex-t-xs); cursor: default; }
  input[type="checkbox"] { width: 14px; height: 14px; accent-color: var(--cortex-accent-fill); cursor: pointer; }
  input[type="checkbox"]:focus-visible { outline: 2px solid var(--cortex-focus); outline-offset: 2px; }
  /* The pin shows on row hover or focus; a pinned run keeps it. */
  tr :global(.pin) { opacity: 0; }
  tr:hover :global(.pin),
  tr :global(.pin:focus-visible) { opacity: 1; }
  tr :global(.pin-on) { color: var(--cortex-accent); }
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>
