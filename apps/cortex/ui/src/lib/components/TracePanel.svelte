<script lang="ts">
  import type { CortexTraceFrame } from "../stores/trace-store.js";
  import Tooltip from "$lib/components/Tooltip.svelte";
  import TimelineRow from "./TimelineRow.svelte";
  import TraceFrameCard from "./TraceFrameCard.svelte";
  import TimelineFilterChips from "./TimelineFilterChips.svelte";
  import { DEFAULT_VISIBLE, filterRows, countByCategory, type TimelineCategory } from "../stores/timeline-filter.js";
  import type { TimelineGroup } from "../stores/timeline-store.js";

  const TRACE_ROWS_TOOLTIP =
    "Rows follow kernel loops (ReasoningIterationProgress). Inner reasoning steps are counted separately as STEPS in the vitals strip.";

  interface Props {
    frame: CortexTraceFrame | null;
    frames?: CortexTraceFrame[];
    status?: string;
    /** Live streaming text from TextDelta events — shown above trace when live */
    streamText?: string;
    /** Rich event-timeline groups (one per kernel iteration). Default body; frames behind toggle. */
    timeline?: TimelineGroup[];
  }

  // Default `[]` alone is inferred as `never[]` and breaks element typing in `{#each}`.
  // Bind prop `frames` → `traceRows` so markup does not resolve `frames` to `Window.frames` (breaks types).
  let {
    frame,
    frames: traceRows = [] as CortexTraceFrame[],
    status = "live",
    streamText = "",
    timeline = [] as TimelineGroup[],
  }: Props = $props();

  // ── Rich timeline state ──────────────────────────────────────────────────
  let active = $state<Set<TimelineCategory>>(new Set(DEFAULT_VISIBLE));
  let expandedTimeline = $state<string[]>([]);
  let showFrames = $state(true); // Frames (default) · Timeline
  const allRows = $derived(timeline.flatMap((g) => g.rows));
  const counts = $derived(countByCategory(allRows));
  const visibleGroups = $derived(
    timeline.map((g) => ({ iteration: g.iteration, rows: filterRows(g.rows, active) })).filter((g) => g.rows.length > 0),
  );
  function toggleCat(c: TimelineCategory) { const next = new Set(active); next.has(c) ? next.delete(c) : next.add(c); active = next; }
  function toggleTimelineRow(id: string) { expandedTimeline = expandedTimeline.includes(id) ? expandedTimeline.filter((x) => x !== id) : [...expandedTimeline, id]; }

  // Svelte 5: use array reassignment for reactivity (Set mutation doesn't trigger)
  let expandedRows = $state<number[]>([]);
  function toggleRow(idx: number) {
    expandedRows = expandedRows.includes(idx)
      ? expandedRows.filter((i) => i !== idx)
      : [...expandedRows, idx];
  }

  function expandAll() {
    expandedRows = traceRows.map((_, i) => i);
  }

  function collapseAll() {
    expandedRows = [];
  }

  /** True when every trace row is expanded. */
  const traceFullyExpanded = $derived(traceRows.length > 0 && traceRows.every((_, i) => expandedRows.includes(i)));

  // The FINAL answer row opens itself once, the first time it appears (the thing you came for).
  let finalAutoOpened = $state(false);
  $effect(() => {
    if (finalAutoOpened) return;
    const idx = traceRows.findIndex((r) => r.kind === "final");
    if (idx >= 0) {
      expandedRows = [...expandedRows, idx];
      finalAutoOpened = true;
    }
  });

  function toggleExpandCollapseAll() {
    if (traceFullyExpanded) collapseAll();
    else expandAll();
  }
</script>

<div
  class="rounded-xl h-full flex flex-col overflow-hidden min-h-0 border border-outline-variant/15 bg-surface-container-low/45 dark:bg-surface-container-low/35 backdrop-blur-[4px]
         {status === 'live'
          ? 'ring-1 ring-inset ring-primary/15 shadow-neural'
          : status === 'paused'
            ? 'ring-1 ring-inset ring-amber-500/25 dark:ring-amber-600/35 shadow-[inset_0_1px_0_rgba(0,0,0,0.04)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]'
            : 'shadow-[inset_0_1px_0_rgba(0,0,0,0.04)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]'}"
>
  <!-- Header -->
  <div class="flex flex-shrink-0 items-start justify-between gap-2 border-b border-[var(--cortex-border)] px-3 py-2.5 sm:px-4">
    <div class="flex flex-col gap-0.5 min-w-0 flex-1">
      <div class="flex items-center gap-2 min-w-0">
        <span class="material-symbols-outlined text-base text-secondary/90 flex-shrink-0" aria-hidden="true"
          >receipt_long</span>
        <h3 class="font-display text-xs font-semibold uppercase tracking-[0.14em] text-on-surface truncate">
          Execution trace
        </h3>
        {#if traceRows.length > 0}
          <span class="text-[10px] font-mono text-outline bg-surface-container px-1.5 py-0.5 rounded flex-shrink-0">
            {traceRows.length}
          </span>
        {/if}
      </div>
      <div class="pl-8 min-w-0 self-start">
        <Tooltip text={TRACE_ROWS_TOOLTIP} class="w-fit max-w-full">
          <p
            class="text-[9px] font-mono text-outline/45 normal-case tracking-normal leading-tight m-0 cursor-help"
          >
            Rows = kernel loops · not each reasoning step
          </p>
        </Tooltip>
      </div>
    </div>
    <div class="flex items-center gap-1.5 flex-shrink-0 pt-0.5">
      {#if traceRows.length > 0}
        <Tooltip text={traceFullyExpanded ? "Collapse all trace sections" : "Expand all trace sections"}>
          <button
            type="button"
            onclick={toggleExpandCollapseAll}
            class="p-1.5 rounded border border-outline-variant/25 text-outline hover:text-primary hover:border-primary/30 bg-transparent cursor-pointer flex-shrink-0"
            aria-label={traceFullyExpanded ? "Collapse all trace sections" : "Expand all trace sections"}
            aria-pressed={traceFullyExpanded}
          >
            <span class="material-symbols-outlined text-base leading-none">
              {traceFullyExpanded ? "collapse_all" : "expand_all"}
            </span>
          </button>
        </Tooltip>
      {/if}
      {#if frame}
        <Tooltip text={`Kernel loop index for this trace row: ${frame.iteration}`}>
          <span class="text-[10px] font-mono text-primary/70 bg-primary/10 px-2 py-0.5 rounded inline-block">
            LOOP {String(frame.iteration).padStart(2, "0")}
          </span>
        </Tooltip>
      {/if}
    </div>
  </div>

  <!-- ── LIVE STREAMING TEXT ───────────────────────────────────────────────── -->
  {#if status === "live" && streamText}
    <div class="flex-shrink-0 mx-3 mb-1 px-3 py-2 bg-primary/5 border border-primary/15 rounded-lg">
      <div class="flex items-center gap-2 mb-1.5">
        <span class="w-1.5 h-1.5 rounded-full bg-primary animate-pulse flex-shrink-0"></span>
        <span class="text-[9px] font-mono text-primary/70 uppercase tracking-widest">Streaming…</span>
      </div>
      <p class="font-mono text-[10px] text-on-surface/70 leading-relaxed whitespace-pre-wrap break-words">
        {streamText}<span class="inline-block w-2 h-3 bg-primary/50 ml-0.5 animate-pulse"></span>
      </p>
    </div>
  {/if}

  <!-- ── VIEW TOGGLE (Frames default · Timeline) ─────────────────────────── -->
  <div class="flex flex-shrink-0 items-center border-b border-[var(--cortex-border)] px-2" role="tablist" aria-label="Trace view">
    {#each [{ id: true, label: "Frames", icon: "view_agenda" }, { id: false, label: "Timeline", icon: "timeline" }] as tab (tab.label)}
      <button
        type="button"
        role="tab"
        aria-selected={showFrames === tab.id}
        class="-mb-px flex cursor-pointer items-center gap-1 border-0 border-b-2 bg-transparent px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider transition-colors
               {showFrames === tab.id ? 'border-primary text-primary' : 'border-transparent text-[var(--cortex-text-muted)] hover:text-[var(--cortex-text)]'}"
        onclick={() => (showFrames = tab.id)}
      >
        <span class="material-symbols-outlined text-[14px] leading-none">{tab.icon}</span>
        {tab.label}
      </button>
    {/each}
  </div>

  {#if !showFrames}
    <TimelineFilterChips {active} {counts} onToggle={toggleCat} />
  {/if}

  <!-- ── ITERATION LOG ────────────────────────────────────────────────────── -->
  <div class="flex-1 overflow-y-auto min-h-0 py-2">
   {#if !showFrames}
    <!-- ── RICH EVENT TIMELINE (default) ──────────────────────────────────── -->
    <div class="flex flex-col px-1">
      {#each visibleGroups as g (g.iteration)}
        <div class="px-2 py-1 text-[10px] font-mono text-amber-700 dark:text-amber-600 sticky top-0 bg-surface-container-lowest/90">iteration {g.iteration}</div>
        {#each g.rows as r (r.id)}
          <TimelineRow row={r} expanded={expandedTimeline.includes(r.id)} onToggle={() => toggleTimelineRow(r.id)} />
        {/each}
      {/each}
      {#if visibleGroups.length === 0}
        <div class="px-3 py-6 text-center text-[11px] text-outline/50">No events match the active filters.</div>
      {/if}
    </div>
   {:else}
    {#if traceRows.length === 0}
      <p class="font-mono text-[10px] text-outline text-center mt-8 px-4">
        Trace will appear here as the agent runs…
      </p>
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
   {/if}
  </div>
</div>
