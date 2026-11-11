<script lang="ts">
  /**
   * The inspector's Events tab: every event the run emitted, filterable, with
   * the most frequent types as chips (each labelled with its whole type, B8)
   * and a readable one-line preview per event (`lib/run-event-log.ts`). A row
   * expands to its payload JSON. Only the latest 400 rows are in the DOM.
   */
  import BoundedText from "$lib/components/BoundedText.svelte";
  import { tooltip } from "$lib/actions/tooltip.js";
  import Button from "$lib/components/kit/Button.svelte";
  import Icon from "$lib/components/kit/Icon.svelte";
  import { formatClockTime } from "@reactive-agents/ui-core";
  import { eventPreview, eventTypeChips, eventTypeLabel } from "$lib/run-event-log.js";

  interface Ev {
    readonly type: string;
    readonly payload: Record<string, unknown>;
    readonly ts: number;
  }
  interface Props {
    events: Ev[];
  }
  let { events }: Props = $props();

  let filterText = $state("");
  let expandedIdx = $state<number | null>(null);

  /** Rows actually in the DOM: the latest N (a long run has thousands of events; rendering all of them froze the page). */
  const WINDOW_STEP = 400;
  let windowSize = $state(WINDOW_STEP);

  const filtered = $derived.by(() => {
    const q = filterText.trim().toLowerCase();
    if (!q) return events;
    return events.filter((e) => e.type.toLowerCase().includes(q) || JSON.stringify(e.payload).toLowerCase().includes(q));
  });
  const windowStart = $derived(Math.max(0, filtered.length - windowSize));
  const windowed = $derived(filtered.slice(windowStart));
  const chips = $derived(eventTypeChips(events));

  const tone = (type: string): string =>
    type === "TaskFailed" || type.endsWith("Failed") || type === "SkillConflictDetected"
      ? "bad"
      : type.startsWith("ToolCall")
        ? "io"
        : type.startsWith("LLM") || type.startsWith("Reasoning") || type === "EntropyScored"
          ? "accent"
          : "muted";

  async function copyAll() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(filtered.map((e) => ({ type: e.type, payload: e.payload, ts: e.ts })), null, 2));
    } catch {
      /* clipboard refused */
    }
  }
</script>

<section class="sec">
  <div class="bar">
    <div class="search">
      <span class="i"><Icon name="search" size="sm" /></span>
      <input class="cx-control" type="search" bind:value={filterText} placeholder="Filter events" aria-label="Filter events" />
    </div>
    <span class="meta">{filtered.length} of {events.length}</span>
    {#if filtered.length > 0}<Button size="sm" variant="ghost" icon="copy" onclick={copyAll}>Copy JSON</Button>{/if}
  </div>

  {#if chips.length > 0 && !filterText}
    <div class="chips" role="group" aria-label="Filter by event type">
      {#each chips as c (c.type)}
        <button type="button" class="chip" use:tooltip={`Show only ${c.type}`} onclick={() => (filterText = c.type)}>{c.label} <span class="n">{c.count}</span></button>
      {/each}
    </div>
  {/if}

  {#if filtered.length === 0}
    <p class="hint">{filterText ? "No events match the filter." : "No events yet."}</p>
  {:else}
    <div class="log">
      {#if windowStart > 0}
        <button type="button" class="more" onclick={() => (windowSize += WINDOW_STEP)}>Show {Math.min(WINDOW_STEP, windowStart)} earlier ({windowStart} hidden)</button>
      {/if}
      {#each windowed as ev, wi (ev.ts + windowStart + wi)}
        {@const i = windowStart + wi}
        {@const open = expandedIdx === i}
        <button type="button" class="row" class:open aria-expanded={open} onclick={() => (expandedIdx = open ? null : i)}>
          <span class="ts">{formatClockTime(ev.ts)}</span>
          <span class="type" data-tone={tone(ev.type)} use:tooltip={ev.type}>{eventTypeLabel(ev.type)}</span>
          <span class="prev">{eventPreview(ev)}</span>
        </button>
        {#if open}
          <div class="payload">
            <BoundedText text={JSON.stringify(ev.payload, null, 2)} preview={3000} maxHeight="16rem" />
          </div>
        {/if}
      {/each}
    </div>
  {/if}
</section>

<style>
  .sec { display: grid; gap: 10px; }
  .bar { display: flex; align-items: center; gap: 8px; }
  .search { position: relative; flex: 1; }
  .search .i { position: absolute; left: 9px; top: 50%; transform: translateY(-50%); display: inline-flex; color: var(--cortex-text-3); pointer-events: none; }
  .search .cx-control { width: 100%; padding-left: 30px; }
  .meta { font-family: var(--cortex-font-data); font-size: var(--cortex-t-2xs); color: var(--cortex-text-3); white-space: nowrap; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip { display: inline-flex; align-items: center; gap: 5px; height: 24px; padding: 0 8px; border: 1px solid transparent; border-radius: var(--cortex-r-chip); background: var(--cortex-surface-2); color: var(--cortex-text-2); font: inherit; font-size: var(--cortex-t-xs); cursor: pointer; }
  .chip:hover { color: var(--cortex-text); border-color: var(--cortex-line-strong); }
  .chip:focus-visible { outline: 2px solid var(--cortex-focus); outline-offset: 2px; }
  .n { font-family: var(--cortex-font-data); font-size: var(--cortex-t-2xs); color: var(--cortex-text-3); }
  .hint { margin: 0; font-size: var(--cortex-t-xs); color: var(--cortex-text-3); }
  .log { display: grid; border: 1px solid var(--cortex-line); border-radius: var(--cortex-r-ctl); overflow: clip; }
  .row {
    display: grid;
    grid-template-columns: 5.5rem minmax(0, 11rem) minmax(0, 1fr);
    gap: 10px;
    align-items: baseline;
    padding: 6px 10px;
    border: 0;
    border-bottom: 1px solid var(--cortex-line);
    background: none;
    color: var(--cortex-text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .row:hover, .row.open { background: var(--cortex-surface-2); }
  .row:focus-visible { outline: 2px solid var(--cortex-focus); outline-offset: -2px; }
  .ts { font-family: var(--cortex-font-data); font-size: var(--cortex-t-2xs); color: var(--cortex-text-3); font-variant-numeric: tabular-nums; }
  .type { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--cortex-t-xs); font-weight: 500; color: var(--cortex-text-2); }
  .type[data-tone="accent"] { color: var(--cortex-accent); }
  .type[data-tone="io"] { color: var(--cortex-io); }
  .type[data-tone="bad"] { color: var(--cortex-bad); }
  .prev { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--cortex-font-data); font-size: var(--cortex-t-2xs); color: var(--cortex-text-2); }
  .payload { padding: 8px 10px; border-bottom: 1px solid var(--cortex-line); background: var(--cortex-canvas); }
  .more { padding: 6px; border: 0; border-bottom: 1px solid var(--cortex-line); background: var(--cortex-surface-2); color: var(--cortex-accent); font: inherit; font-size: var(--cortex-t-xs); cursor: pointer; }
</style>
