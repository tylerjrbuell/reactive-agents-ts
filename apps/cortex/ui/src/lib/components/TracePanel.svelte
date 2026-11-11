<script lang="ts">
  /**
   * The run trace (Bench spec section 8, `run.html`): a panel with Loops (one
   * row per kernel loop, then the final answer) and Timeline (every event,
   * filterable by category) tabs. Used by the run view and the chat trace
   * drawer; in a height-bounded parent its body scrolls.
   */
  import type { CortexTraceFrame } from "../stores/trace-store.js";
  import IconButton from "$lib/components/kit/IconButton.svelte";
  import Tabs from "$lib/components/kit/Tabs.svelte";
  import TimelineRow from "./TimelineRow.svelte";
  import TraceFrameCard from "./TraceFrameCard.svelte";
  import TimelineFilterChips from "./TimelineFilterChips.svelte";
  import { DEFAULT_VISIBLE, filterRows, countByCategory, type TimelineCategory } from "../stores/timeline-filter.js";
  import type { TimelineGroup } from "../stores/timeline-store.js";
  import { tabId, tabPanelId } from "$lib/tablist.js";

  interface Props {
    frame: CortexTraceFrame | null;
    frames?: CortexTraceFrame[];
    status?: string;
    /** Live streaming text from TextDelta events, shown above the rows while live. */
    streamText?: string;
    /** Event-timeline groups (one per kernel loop) for the Timeline tab. */
    timeline?: TimelineGroup[];
    /** Fill a height-bounded parent and scroll the rows inside (the chat trace drawer); otherwise grow with the rows. */
    bounded?: boolean;
    /** Open the final-answer row the first time it appears (default true). */
    autoOpenFinal?: boolean;
  }

  // Default `[]` alone is inferred as `never[]` and breaks element typing in `{#each}`.
  // Bind prop `frames` → `traceRows` so markup does not resolve `frames` to `Window.frames` (breaks types).
  let {
    frame,
    frames: traceRows = [] as CortexTraceFrame[],
    status = "live",
    streamText = "",
    timeline = [] as TimelineGroup[],
    bounded = false,
    autoOpenFinal = true,
  }: Props = $props();

  const uid = $props.id();
  const ID = `${uid}-trace`;

  // ── Timeline state ───────────────────────────────────────────────────────
  let active = $state<Set<TimelineCategory>>(new Set(DEFAULT_VISIBLE));
  let expandedTimeline = $state<string[]>([]);
  let view = $state<"loops" | "timeline">("loops");
  const allRows = $derived(timeline.flatMap((g) => g.rows));
  const counts = $derived(countByCategory(allRows));
  const visibleGroups = $derived(
    timeline.map((g) => ({ iteration: g.iteration, rows: filterRows(g.rows, active) })).filter((g) => g.rows.length > 0),
  );
  function toggleCat(c: TimelineCategory) {
    const next = new Set(active);
    if (next.has(c)) next.delete(c);
    else next.add(c);
    active = next;
  }
  function toggleTimelineRow(id: string) {
    expandedTimeline = expandedTimeline.includes(id) ? expandedTimeline.filter((x) => x !== id) : [...expandedTimeline, id];
  }

  // Svelte 5: use array reassignment for reactivity (Set mutation doesn't trigger)
  let expandedRows = $state<number[]>([]);
  function toggleRow(idx: number) {
    expandedRows = expandedRows.includes(idx) ? expandedRows.filter((i) => i !== idx) : [...expandedRows, idx];
  }

  /** True when every trace row is expanded. */
  const fullyExpanded = $derived(traceRows.length > 0 && traceRows.every((_, i) => expandedRows.includes(i)));

  // The final answer row opens itself once, the first time it appears (the thing you came for).
  let finalAutoOpened = $state(false);
  $effect(() => {
    if (finalAutoOpened || !autoOpenFinal) return;
    const idx = traceRows.findIndex((r) => r.kind === "final");
    if (idx >= 0) {
      expandedRows = [...expandedRows, idx];
      finalAutoOpened = true;
    }
  });

  const tabs = $derived([
    { id: "loops", label: "Loops", count: traceRows.filter((r) => r.kind !== "final").length },
    { id: "timeline", label: "Timeline", count: allRows.length },
  ]);
</script>

<section class="trace" class:bounded aria-label="Trace">
  <header class="th">
    <h2>Trace</h2>
    <span class="hint">{view === "loops" ? "one row per recorded kernel loop" : "every event, by loop"}</span>
    <div class="tools">
      {#if view === "loops" && traceRows.length > 0}
        <IconButton
          icon={fullyExpanded ? "compress" : "steps"}
          label={fullyExpanded ? "Collapse every loop" : "Expand every loop"}
          size="sm"
          pressed={fullyExpanded}
          onclick={() => (expandedRows = fullyExpanded ? [] : traceRows.map((_, i) => i))}
        />
      {/if}
      <Tabs items={tabs} value={view} label="Trace view" idBase={ID} onchange={(id) => (view = id === "timeline" ? "timeline" : "loops")} class="tabs" />
    </div>
  </header>

  {#if status === "live" && streamText}
    <div class="stream rail rail-live" aria-live="polite">
      <span class="sl">Streaming</span>
      <p>{streamText.length > 4000 ? `…${streamText.slice(-4000)}` : streamText}</p>
    </div>
  {/if}

  {#if view === "timeline"}
    <TimelineFilterChips {active} {counts} onToggle={toggleCat} />
  {/if}

  <div class="body" role="tabpanel" id={tabPanelId(ID, view)} aria-labelledby={tabId(ID, view)}>
    {#if view === "timeline"}
      {#each visibleGroups as g (g.iteration)}
        <div class="loop-h">Loop {g.iteration}</div>
        {#each g.rows as r (r.id)}
          <TimelineRow row={r} expanded={expandedTimeline.includes(r.id)} onToggle={() => toggleTimelineRow(r.id)} />
        {/each}
      {/each}
      {#if visibleGroups.length === 0}
        <p class="empty">No events match the active filters.</p>
      {/if}
    {:else if traceRows.length === 0}
      <p class="empty">{status === "loading" ? "Loading the run…" : status === "live" ? "Loops appear here as the agent runs." : "This run recorded no kernel loops."}</p>
    {:else}
      {#each traceRows as f, idx (idx)}
        <TraceFrameCard
          frame={f}
          expanded={expandedRows.includes(idx)}
          selected={frame?.iteration === f.iteration && frame?.kind === f.kind}
          onToggle={() => toggleRow(idx)}
        />
      {/each}
    {/if}
  </div>
</section>

<style>
  .trace {
    display: flex;
    flex-direction: column;
    min-height: 0;
    border: 1px solid var(--cortex-line);
    border-radius: var(--cortex-r-panel);
    background: var(--cortex-surface-1);
    color: var(--cortex-text);
  }
  .trace.bounded { height: 100%; }
  .th { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; padding: 4px 16px 0; border-bottom: 1px solid var(--cortex-line); }
  h2 { margin: 0; padding: 10px 0; font-size: var(--cortex-t-sm); font-weight: 600; }
  .hint { font-size: var(--cortex-t-xs); color: var(--cortex-text-3); }
  .tools { display: flex; align-items: center; gap: 8px; margin-left: auto; }
  .tools :global(.tabs) { border-bottom: 0; gap: 12px; }
  .stream { margin: 10px 16px 0; padding: 8px 12px 8px 16px; border-radius: var(--cortex-r-ctl); background: var(--cortex-surface-2); }
  .sl { font-size: var(--cortex-t-xs); color: var(--cortex-accent); }
  .stream p { margin: 4px 0 0; max-height: 8rem; overflow-y: auto; font-size: var(--cortex-t-sm); line-height: var(--cortex-lh-ui); color: var(--cortex-text-2); white-space: pre-wrap; overflow-wrap: anywhere; }
  /* Unbounded: the rows set the height (the page scrolls). Bounded: they scroll inside. */
  .body { flex: none; }
  .bounded .body { flex: 1; min-height: 0; overflow-y: auto; }
  .loop-h {
    position: sticky;
    top: 0;
    z-index: 1;
    padding: 6px 16px;
    border-bottom: 1px solid var(--cortex-line);
    background: var(--cortex-surface-1);
    font-family: var(--cortex-font-data);
    font-size: var(--cortex-t-2xs);
    color: var(--cortex-text-3);
  }
  .empty { margin: 0; padding: 24px 16px; text-align: center; font-size: var(--cortex-t-sm); color: var(--cortex-text-3); }
</style>
