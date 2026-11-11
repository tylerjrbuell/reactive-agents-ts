<script lang="ts">
  /**
   * Beacon's Field view (spec 5.2, `beacon.html?view=field`): the free canvas
   * on the dot grid. Nodes are placed deterministically (`beacon-layout.ts`),
   * dragged by their tile handle and tidied by Arrange (delegation trees, then
   * state lanes). Parent-to-sub-agent links flow only while both ends run.
   */
  import type { StatusView } from "@reactive-agents/ui-core";
  import type { AgentNode } from "$lib/stores/agent-store.js";
  import BeaconNode from "./BeaconNode.svelte";
  import Button from "./kit/Button.svelte";
  import Icon from "./kit/Icon.svelte";
  import { fieldLinkActive } from "$lib/beacon-board.js";
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
  }
  let { agents, statusOf }: Props = $props();

  /** Delegation forest; edges are keyed by run id (never agent id). */
  const hierarchy = $derived(buildRunHierarchy(agents));

  // ── Positioning ────────────────────────────────────────────────────────────

  const nodePos = spiralPos;

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

  /**
   * Position map for this view: computed slots plus the viewer's drags.
   * Keyed by runId so re-ordering the agents array doesn't reset positions.
   */
  let posMap = $state(new Map<string, Pos>());

  /** Positions the viewer dragged (per viewer, survives reloads). Computed slots are never stored. */
  const storage: PositionStorage | null =
    typeof localStorage === "undefined" ? null : localStorage;
  let dragged = loadPositions(storage);

  // Measured view: slots are sized in px, so a resize that changes the grid
  // re-slots. The plane grows past the view (and scrolls) when the desk has
  // more nodes than one screen of slots, so nodes never stack.
  let canvasW = $state(0);
  let canvasH = $state(0);
  const canvas = $derived.by<CanvasSize>(() => {
    if (canvasW <= 0 || canvasH <= 0) return DEFAULT_CANVAS;
    return { width: canvasW, height: Math.max(canvasH, fieldHeightFor(agents.length, canvasW)) };
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
    const placed = new Map<string, Pos>();
    for (const a of agents) {
      const p = dragged.get(a.runId) ?? (regrid ? undefined : posMap.get(a.runId));
      if (p) placed.set(a.runId, p);
    }
    const next = layoutPositions(agents, hierarchy.parentOf, placed, { canvas });
    laidOutFor = gridKey;
    const same =
      next.size === posMap.size && [...next].every(([k, v]) => posMap.get(k) === v);
    if (!same) posMap = next;
  });

  /** Arrange: forget drags, then delegation trees and state lanes. A click handler, not an effect (an effect would read the map it writes). */
  function arrange() {
    if (agents.length === 0) return;
    dragged = new Map();
    savePositions(storage, dragged);
    posMap = layoutPositions(agents, hierarchy.parentOf, new Map(), { canvas, rootRank: arrangeRank });
  }

  const nodePositions = $derived(
    agents.map((a, i) => posMap.get(a.runId) ?? nodePos(i)),
  );

  // Connection lines
  const posById = $derived(new Map(agents.map((a, i) => [a.runId, nodePositions[i]])));
  const byRunId = $derived(new Map(agents.map((a) => [a.runId, a])));
  const lines = $derived(
    agents
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

  // ── Drag ───────────────────────────────────────────────────────────────────

  let canvasEl = $state<HTMLDivElement | null>(null);

  type DragState = {
    runId: string;
    startX: number; startY: number; // pointer start (px)
    nodeX: number;  nodeY: number;  // node start (%)
  };
  let drag = $state<DragState | null>(null);
  const draggingRunId = $derived(drag?.runId ?? null);

  function onHandlePointerDown(e: PointerEvent, runId: string, posIdx: number) {
    if (e.button !== 0) return;
    e.preventDefault(); // safe here — drag handle has no click-to-navigate
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const pos = posMap.get(runId) ?? nodePos(posIdx);
    drag = { runId, startX: e.clientX, startY: e.clientY, nodeX: pos.x, nodeY: pos.y };
  }

  function onHandlePointerMove(e: PointerEvent, runId: string) {
    if (!drag || drag.runId !== runId || !canvasEl) return;
    const { width, height } = canvasEl.getBoundingClientRect();
    const next = new Map(posMap);
    next.set(runId, {
      x: Math.max(5, Math.min(93, drag.nodeX + ((e.clientX - drag.startX) / width)  * 100)),
      y: Math.max(5, Math.min(92, drag.nodeY + ((e.clientY - drag.startY) / height) * 100)),
    });
    posMap = next;
  }

  function onHandlePointerUp(e: PointerEvent, runId: string) {
    if (drag?.runId === runId) {
      drag = null;
      const p = posMap.get(runId);
      if (p) {
        dragged = new Map(dragged).set(runId, p);
        savePositions(storage, dragged);
      }
    }
  }

</script>

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
      {#each agents as agent, i (agent.runId)}
        {@const isDragging = draggingRunId === agent.runId}
        <div
          class="node-wrapper"
          class:is-dragging-node={isDragging}
          style:left="{nodePositions[i].x}%"
          style:top="{nodePositions[i].y}%"
        >
          <BeaconNode {agent} status={statusOf(agent)} />

          <!-- Drag handle: shows on hover or focus above the tile. -->
          <div
            class="drag-handle"
            class:drag-handle-active={isDragging}
            onpointerdown={(e) => onHandlePointerDown(e, agent.runId, i)}
            onpointermove={(e) => onHandlePointerMove(e, agent.runId)}
            onpointerup={(e) => onHandlePointerUp(e, agent.runId)}
            title="Drag to move"
            role="button"
            tabindex="-1"
            aria-label="Drag to move {agent.name}"
          >
            <Icon name="dots" size="sm" />
          </div>
        </div>
      {/each}
    </div>
  </div>

  <div class="field-tools">
    <Button size="sm" onclick={arrange}>Arrange</Button>
  </div>
  {#if draggingRunId === null}
    <p class="field-legend">Drag a node to move it. Dashed lines flow while a parent and its sub-agent both run.</p>
  {/if}
</div>

<style>
  .fieldv {
    position: relative;
    width: 100%;
    height: 100%;
    min-height: 420px;
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

  .field-tools { position: absolute; right: 12px; top: 12px; display: flex; gap: 6px; z-index: 3; }
  .field-legend {
    position: absolute;
    left: 8px;
    bottom: 8px;
    z-index: 3;
    margin: 0;
    padding: 2px 6px;
    border-radius: var(--cortex-r-chip);
    /* Opaque so nodes scrolled under it never mix with the text. */
    background: var(--cortex-surface-1);
    font-size: var(--cortex-t-xs);
    color: var(--cortex-text-3);
    pointer-events: none;
  }
</style>
