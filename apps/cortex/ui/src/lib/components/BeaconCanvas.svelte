<script lang="ts">
  /**
   * Beacon's Field view (spec 5.2, `beacon.html?view=field`): the free canvas
   * on the dot grid. A filter bar narrows it (`beacon-filter.ts`, the same
   * rules as the Board); nodes are placed deterministically (`beacon-layout.ts`),
   * dragged by their tile handle (`beacon-drag.ts`) or nudged with the arrow
   * keys, and tidied by Arrange (delegation trees, then state lanes). A parent
   * folds its sub-agents (`beacon-field.ts`; finished trees fold on their own
   * on a big desk). Parent-to-sub-agent links flow only while both ends run.
   */
  import { untrack } from "svelte";
  import type { StatusView } from "@reactive-agents/ui-core";
  import type { AgentNode } from "$lib/stores/agent-store.js";
  import BeaconNode from "./BeaconNode.svelte";
  import BeaconFilterBar from "./beacon/BeaconFilterBar.svelte";
  import Button from "./kit/Button.svelte";
  import Chip from "./kit/Chip.svelte";
  import EmptyState from "./kit/EmptyState.svelte";
  import Icon from "./kit/Icon.svelte";
  import Status from "./kit/Status.svelte";
  import { tooltip } from "$lib/actions/tooltip.js";
  import { fieldLinkActive } from "$lib/beacon-board.js";
  import { beginDrag, dragMove, nudge, placedFor, type DragSession } from "$lib/beacon-drag.js";
  import { collapsedParents, legendOf, parentsOf, visibleNodes } from "$lib/beacon-field.js";
  import { filterAgents, filterCounts, isNoFilter, NO_FILTER, type BeaconFilter } from "$lib/beacon-filter.js";
  import { buildRunHierarchy } from "$lib/run-hierarchy.js";
  import {
    DEFAULT_CANVAS,
    fieldGrid,
    fieldHeightFor,
    layoutPositions,
    loadPositions,
    savePositions,
    spiralPos,
    type CanvasSize,
    type Pos,
    type PositionStorage,
  } from "$lib/beacon-layout.js";

  interface Props {
    agents: AgentNode[];
    /** Each node's Beacon status (`beaconStatusOf`), by run id. */
    statusOf: (agent: AgentNode) => StatusView;
    /** The filter (status chip + search), shared with the Board. */
    filter?: BeaconFilter;
    onfilter?: (next: BeaconFilter) => void;
    /** Wall clock (ms epoch) so live nodes' run time ticks. */
    now?: number;
  }
  let { agents, statusOf, filter = NO_FILTER, onfilter = () => {}, now = Date.now() }: Props = $props();

  /** Delegation forest over every agent; edges are keyed by run id (never agent id). */
  const hierarchy = $derived(buildRunHierarchy(agents));

  // ── What is on the plane: filter, then folded trees ────────────────────────

  const narrowed = $derived(filterAgents(agents, statusOf, filter));
  const counts = $derived(filterCounts(agents, statusOf, filter.query));
  /** The viewer's fold choices (true = folded); with none, finished trees fold on a big desk. */
  let foldChoice = $state(new Map<string, boolean>());
  const folded = $derived(
    collapsedParents(narrowed, hierarchy.parentOf, (n) => statusOf(n).tone, foldChoice),
  );
  const view = $derived(visibleNodes(narrowed, hierarchy.parentOf, folded));
  /** Agents on the plane, in the order the layout and the DOM use. */
  const shown = $derived(view.shown);
  const legend = $derived(legendOf(shown.map(statusOf)));
  const parentIds = $derived(parentsOf(hierarchy.parentOf));

  function toggleFold(runId: string) {
    foldChoice = new Map(foldChoice).set(runId, !folded.has(runId));
  }

  // ── Positioning ────────────────────────────────────────────────────────────

  const stateOrder: ReadonlyArray<AgentNode["state"]> = [
    "running",
    "exploring",
    "stressed",
    "idle",
    "completed",
    "error",
  ];

  /** Arrange order: delegation trees first, then state lanes. */
  function arrangeRank(runId: string): number {
    const root = hierarchy.roots.find((r) => r.agent.runId === runId);
    if (root && root.children.length > 0) return 0;
    const state = root?.agent.state;
    const i = state ? stateOrder.indexOf(state) : -1;
    return 1 + (i < 0 ? stateOrder.length : i);
  }

  /** Computed slots for the agents on the plane. Keyed by runId so re-ordering the agents array doesn't reset positions. */
  let posMap = $state(new Map<string, Pos>());

  /**
   * Positions the viewer dragged (per viewer, survives reloads). A drag writes
   * here on every move, so the layout always sees the newest spot; computed
   * slots are never stored. Hidden agents keep their entry.
   */
  const storage: PositionStorage | null =
    typeof localStorage === "undefined" ? null : localStorage;
  let dragged = $state(loadPositions(storage));

  // Measured view: slots are sized in px, so a resize that changes the grid
  // re-slots. The plane grows past the view (and scrolls) when the desk has
  // more nodes than one screen of slots, so nodes never stack.
  let canvasW = $state(0);
  let canvasH = $state(0);
  const canvas = $derived.by<CanvasSize>(() => {
    if (canvasW <= 0 || canvasH <= 0) return DEFAULT_CANVAS;
    return { width: canvasW, height: Math.max(canvasH, fieldHeightFor(shown.length, canvasW)) };
  });
  const gridKey = $derived.by(() => {
    const g = fieldGrid(canvas);
    return `${g.cols}x${g.rows}`;
  });
  let laidOutFor = "";

  /**
   * Place agents deterministically: dragged positions are kept, new runs fill
   * free slots from a stable order with sub-agents under their parent, so
   * arrival order (REST seed vs live WS) never changes the layout and nodes
   * never overlap while slots remain.
   */
  $effect(() => {
    const regrid = gridKey !== laidOutFor;
    const placed = placedFor(
      shown.map((a) => a.runId),
      dragged,
      untrack(() => posMap),
      regrid,
    );
    const next = layoutPositions(shown, hierarchy.parentOf, placed, { canvas });
    laidOutFor = gridKey;
    const prev = untrack(() => posMap);
    const same = next.size === prev.size && [...next].every(([k, v]) => prev.get(k) === v);
    if (!same) posMap = next;
  });

  /** Arrange: forget drags, then delegation trees and state lanes. A click handler, not an effect (an effect would read the map it writes). */
  function arrange() {
    if (shown.length === 0) return;
    dragged = new Map();
    savePositions(storage, dragged);
    posMap = layoutPositions(shown, hierarchy.parentOf, new Map(), { canvas, rootRank: arrangeRank });
  }

  /** Where a node is drawn: the viewer's spot, else its computed slot. */
  const posOf = (runId: string, i: number): Pos => dragged.get(runId) ?? posMap.get(runId) ?? spiralPos(i);

  // Connection lines
  const posById = $derived(new Map(shown.map((a, i) => [a.runId, posOf(a.runId, i)])));
  const byRunId = $derived(new Map(shown.map((a) => [a.runId, a])));
  const lines = $derived(
    shown
      .filter((a) => {
        const parent = hierarchy.parentOf.get(a.runId);
        return parent !== undefined && posById.has(parent) && posById.has(a.runId);
      })
      .map((a) => {
        const parentId = hierarchy.parentOf.get(a.runId)!;
        const p = posById.get(parentId)!;
        const c = posById.get(a.runId)!;
        return { key: a.runId, x1: p.x, y1: p.y, x2: c.x, y2: c.y, active: fieldLinkActive(byRunId.get(parentId), a) };
      }),
  );

  // ── Drag and keyboard ──────────────────────────────────────────────────────

  let canvasEl = $state<HTMLDivElement | null>(null);
  let drag = $state<DragSession | null>(null);
  const draggingRunId = $derived(drag?.runId ?? null);

  function planeSize() {
    const r = canvasEl?.getBoundingClientRect();
    return { width: r?.width ?? canvas.width, height: r?.height ?? canvas.height };
  }

  function onHandlePointerDown(e: PointerEvent, runId: string, i: number) {
    if (e.button !== 0) return;
    e.preventDefault(); // safe here — drag handle has no click-to-navigate
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    drag = beginDrag(runId, { x: e.clientX, y: e.clientY }, posOf(runId, i), planeSize());
  }

  function onHandlePointerMove(e: PointerEvent, runId: string) {
    if (!drag || drag.runId !== runId) return;
    dragged = dragMove(dragged, drag, { x: e.clientX, y: e.clientY });
  }

  /** Drop (or a cancelled pointer): the drag ends and the spot is remembered. */
  function endDrag(runId: string) {
    if (drag?.runId !== runId) return;
    drag = null;
    savePositions(storage, dragged);
  }

  function onNudge(runId: string, i: number, dx: number, dy: number) {
    dragged = new Map(dragged).set(runId, nudge(posOf(runId, i), dx, dy, planeSize()));
    savePositions(storage, dragged);
  }

  const clearFilter = () => onfilter(NO_FILTER);
</script>

<div class="fieldwrap">
  <BeaconFilterBar {filter} {counts} shown={shown.length} total={agents.length} {onfilter} />

  <div
    class="fieldv dotgrid"
    class:is-dragging={draggingRunId !== null}
    data-view="field"
    role="region"
    aria-label="Agents as a field"
  >
    <!-- The view scrolls when the plane (sized for one slot per node) is taller. -->
    <div class="scroller" bind:clientWidth={canvasW} bind:clientHeight={canvasH}>
      <div class="plane" bind:this={canvasEl} style:height="{canvas.height}px">
        <!-- Parent → sub-agent links: line-strong at rest, a flowing dash while both run. -->
        <svg class="links" aria-hidden="true">
          {#each lines as line (line.key)}
            <line
              x1="{line.x1}%" y1="{line.y1}%"
              x2="{line.x2}%" y2="{line.y2}%"
              class="ln"
              class:on={line.active}
            />
          {/each}
        </svg>

        <!-- Agent nodes -->
        {#each shown as agent, i (agent.runId)}
          {@const isDragging = draggingRunId === agent.runId}
          {@const pos = posOf(agent.runId, i)}
          {@const under = view.hiddenUnder.get(agent.runId)}
          {@const isParent = parentIds.has(agent.runId)}
          <div
            class="node-wrapper"
            class:is-dragging-node={isDragging}
            style:left="{pos.x}%"
            style:top="{pos.y}%"
          >
            <BeaconNode
              {agent}
              status={statusOf(agent)}
              {now}
              onnudge={(dx, dy) => onNudge(agent.runId, i, dx, dy)}
            />

            <!-- Drag handle: shows on hover or focus above the tile. -->
            <div
              class="drag-handle"
              class:drag-handle-active={isDragging}
              onpointerdown={(e) => onHandlePointerDown(e, agent.runId, i)}
              onpointermove={(e) => onHandlePointerMove(e, agent.runId)}
              onpointerup={() => endDrag(agent.runId)}
              onpointercancel={() => endDrag(agent.runId)}
              use:tooltip={"Drag to move"}
              role="button"
              tabindex="-1"
              aria-label="Drag to move {agent.name}"
            >
              <Icon name="dots" size="sm" />
            </div>

            <!-- Fold: a parent hides or shows its sub-agents. -->
            {#if isParent}
              <button
                type="button"
                class="fold"
                aria-expanded={under === undefined}
                aria-label="{under === undefined ? 'Fold' : 'Show'} sub-agents of {agent.name}"
                onclick={() => toggleFold(agent.runId)}
              >
                {under === undefined ? "−" : `+${under}`}
              </button>
            {/if}
          </div>
        {/each}
      </div>
    </div>

    {#if shown.length === 0 && agents.length > 0}
      <div class="none">
        <EmptyState icon="filter" title="No agents match" description="Pick another filter or search to see the rest.">
          {#snippet actions()}
            <Chip onclick={clearFilter}>Show all</Chip>
          {/snippet}
        </EmptyState>
      </div>
    {/if}

    <div class="field-tools">
      <Button size="sm" onclick={arrange}>Arrange</Button>
    </div>
    {#if draggingRunId === null}
      <div class="field-legend">
        {#each legend as entry (entry.tone)}
          <span class="lg"><Status tone={entry.tone} label="{entry.label} {entry.count}" /></span>
        {/each}
        <span class="hint">Drag a node or use the arrow keys. Dashed lines flow while a parent and its sub-agent both run.{#if !isNoFilter(filter)} Hidden agents keep their spot.{/if}</span>
      </div>
    {/if}
  </div>
</div>

<style>
  .fieldwrap { display: flex; flex-direction: column; width: 100%; height: 100%; min-height: 420px; }
  .fieldv {
    position: relative;
    flex: 1;
    min-height: 0;
    width: 100%;
    border-radius: var(--cortex-r-panel);
    border: 1px solid var(--cortex-line);
    overflow: hidden;
  }
  .fieldv.is-dragging { user-select: none; }
  .scroller { position: absolute; inset: 0; overflow-x: hidden; overflow-y: auto; }
  .plane { position: relative; width: 100%; }
  .links { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; overflow: visible; }
  .ln { stroke: var(--cortex-line-strong); stroke-width: 1; }
  .ln.on {
    stroke: var(--cortex-mk-violet);
    stroke-opacity: 0.7;
    stroke-dasharray: 5 7;
    animation: field-dash 1.6s linear infinite;
  }
  @keyframes field-dash { to { stroke-dashoffset: -24; } }
  @media (prefers-reduced-motion: reduce) { .ln.on { animation: none; } }
  :global(html[data-motion="reduce"]) .ln.on { animation: none; }

  .node-wrapper { position: absolute; z-index: 1; transform: translate(-50%, -50%); }
  .node-wrapper.is-dragging-node { z-index: 2; }

  /* Drag handle: a small chip above the tile, on hover or focus. */
  .drag-handle {
    position: absolute;
    left: 50%;
    top: -14px;
    transform: translateX(-50%);
    display: grid;
    place-items: center;
    width: 26px;
    height: 14px;
    border-radius: var(--cortex-r-chip);
    background: var(--cortex-surface-1);
    border: 1px solid var(--cortex-line-strong);
    color: var(--cortex-text-2);
    cursor: grab;
    touch-action: none;
    opacity: 0;
    transition: opacity var(--cortex-d-fast) var(--cortex-ease-out);
  }
  .node-wrapper:hover .drag-handle,
  .node-wrapper:focus-within .drag-handle,
  .drag-handle.drag-handle-active { opacity: 1; }
  .drag-handle:active,
  .drag-handle.drag-handle-active { cursor: grabbing; }

  /* Fold: beside the tile's top-right corner; always visible when sub-agents are hidden. */
  .fold {
    position: absolute;
    top: -6px;
    left: calc(50% + 22px);
    min-width: 22px;
    height: 22px;
    padding: 0 5px;
    border-radius: var(--cortex-r-chip);
    background: var(--cortex-surface-1);
    border: 1px solid var(--cortex-line-strong);
    color: var(--cortex-text-2);
    font-family: var(--cortex-font-data);
    font-size: var(--cortex-t-2xs);
    cursor: pointer;
  }
  .fold:hover { color: var(--cortex-text); border-color: var(--cortex-text-3); }
  .fold:focus-visible { outline: 2px solid var(--cortex-focus); outline-offset: 2px; }

  .none { position: absolute; inset: 0; display: grid; place-items: center; z-index: 2; pointer-events: none; }
  .none :global(*) { pointer-events: auto; }

  .field-tools { position: absolute; right: 12px; top: 12px; display: flex; gap: 6px; z-index: 3; }
  .field-legend {
    position: absolute;
    left: 8px;
    bottom: 8px;
    z-index: 3;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 10px;
    max-width: calc(100% - 16px);
    margin: 0;
    padding: 2px 6px;
    border-radius: var(--cortex-r-chip);
    /* Opaque so nodes scrolled under it never mix with the text. */
    background: var(--cortex-surface-1);
    font-size: var(--cortex-t-xs);
    color: var(--cortex-text-3);
    pointer-events: none;
  }
  .lg { display: inline-flex; font-size: var(--cortex-t-2xs); }
</style>
