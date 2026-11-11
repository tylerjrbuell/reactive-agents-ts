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
  import { buildRunHierarchy, type HierarchyNode } from "$lib/run-hierarchy.js";
  import {
    layoutPositions,
    loadPositions,
    savePositions,
    spiralPos,
    type Pos,
    type PositionStorage,
  } from "$lib/beacon-layout.js";


  /**
   * Tree layout for delegation: depth is the row, siblings share a row side by
   * side, a parent centres over its children. Roots with no children are left
   * to the state-lane layout.
   */
  function treePositions(roots: readonly HierarchyNode[]): Map<string, { x: number; y: number }> {
    const out = new Map<string, { x: number; y: number }>();
    const withKids = roots.filter((r) => r.children.length > 0);
    if (withKids.length === 0) return out;
    const leafCount = (n: HierarchyNode): number =>
      n.children.length === 0 ? 1 : n.children.reduce((s, c) => s + leafCount(c), 0);
    const maxDepth = (n: HierarchyNode): number =>
      n.children.length === 0 ? 0 : 1 + Math.max(...n.children.map(maxDepth));
    const total = withKids.reduce((s, r) => s + leafCount(r), 0);
    const rows = Math.max(...withKids.map(maxDepth)) + 1;
    const rowH = rows <= 1 ? 0 : 56 / (rows - 1);
    let cursor = 0;
    const place = (n: HierarchyNode, level: number): number => {
      let x: number;
      if (n.children.length === 0) {
        x = cursor + 0.5;
        cursor += 1;
      } else {
        const xs = n.children.map((c) => place(c, level + 1));
        x = (xs[0]! + xs[xs.length - 1]!) / 2;
      }
      out.set(n.agent.runId, {
        x: Math.max(8, Math.min(92, 8 + (x / total) * 84)),
        y: 14 + level * rowH,
      });
      return x;
    };
    for (const r of withKids) place(r, 0);
    return out;
  }

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

  function autoOrganizePositions(list: AgentNode[]): Map<string, { x: number; y: number }> {
    const tree = treePositions(hierarchy.roots);
    const rest = list.filter((a) => !tree.has(a.runId));
    const lanes = laneOrganize(rest);
    for (const [k, v] of tree) lanes.set(k, v);
    return lanes;
  }

  function laneOrganize(list: AgentNode[]): Map<string, { x: number; y: number }> {
    const byState = new Map<AgentNode["state"], AgentNode[]>();
    for (const state of stateOrder) byState.set(state, []);

    for (const agent of list) {
      const group = byState.get(agent.state);
      if (group) group.push(agent);
    }

    for (const [state, group] of byState) {
      const sorted = [...group].sort((a, b) => {
        const aParent = hierarchy.parentOf.get(a.runId) ?? a.runId;
        const bParent = hierarchy.parentOf.get(b.runId) ?? b.runId;
        if (aParent !== bParent) return aParent.localeCompare(bParent);
        if (a.connectedAt !== b.connectedAt) return a.connectedAt - b.connectedAt;
        return a.runId.localeCompare(b.runId);
      });
      byState.set(state, sorted);
    }

    const activeGroups = stateOrder.filter((state) => (byState.get(state)?.length ?? 0) > 0);
    const groupCount = Math.max(1, activeGroups.length);
    const minX = 12;
    const maxX = 88;
    const laneWidth = groupCount === 1 ? 0 : (maxX - minX) / (groupCount - 1);
    const maxRows = 6;

    const next = new Map<string, { x: number; y: number }>();
    activeGroups.forEach((state, groupIndex) => {
      const group = byState.get(state) ?? [];
      const laneCenterX = groupCount === 1 ? 50 : minX + laneWidth * groupIndex;

      group.forEach((agent, i) => {
        const subCol = Math.floor(i / maxRows);
        const row = i % maxRows;
        const remaining = group.length - subCol * maxRows;
        const rowCount = Math.min(maxRows, remaining);
        const minY = 14;
        const maxY = 74;
        const y = rowCount <= 1 ? 42 : minY + (row * (maxY - minY)) / (rowCount - 1);
        const x = Math.max(8, Math.min(92, laneCenterX + subCol * 4.5));
        next.set(agent.runId, { x, y });
      });
    });

    return next;
  }

  /**
   * Persistent position map — survives agent list changes and stores drag overrides.
   * Keyed by runId so re-ordering the agents array doesn't reset positions.
   */
  let posMap = $state(new Map<string, Pos>());

  /** Per-viewer persisted positions (all runs ever placed, survives reloads). */
  const storage: PositionStorage | null =
    typeof localStorage === "undefined" ? null : localStorage;
  let stored = loadPositions(storage);

  function persist(current: ReadonlyMap<string, Pos>): void {
    stored = new Map([...stored, ...current]);
    savePositions(storage, stored);
  }

  /**
   * Place agents deterministically: restored/dragged positions are kept, new
   * runs are computed from a stable order with children relative to their
   * parent, so arrival order (REST seed vs live WS) never changes the layout.
   */
  $effect(() => {
    const placed = new Map<string, Pos>();
    for (const a of agents) {
      const p = posMap.get(a.runId) ?? stored.get(a.runId);
      if (p) placed.set(a.runId, p);
    }
    const next = layoutPositions(agents, hierarchy.parentOf, placed);
    const same =
      next.size === posMap.size && [...next].every(([k, v]) => posMap.get(k) === v);
    if (!same) {
      posMap = next;
      persist(next);
    }
  });

  /** Arrange: delegation trees, then state lanes. A click handler, not an effect (an effect would read the map it writes). */
  function arrange() {
    if (agents.length === 0) return;
    const next = autoOrganizePositions(agents);
    posMap = next;
    persist(next);
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
      y: Math.max(5, Math.min(80, drag.nodeY + ((e.clientY - drag.startY) / height) * 100)),
    });
    posMap = next;
  }

  function onHandlePointerUp(e: PointerEvent, runId: string) {
    if (drag?.runId === runId) {
      drag = null;
      persist(posMap);
    }
  }

</script>

<div
  class="fieldv dotgrid"
  class:is-dragging={draggingRunId !== null}
  bind:this={canvasEl}
  data-view="field"
  role="region"
  aria-label="Agents as a field"
>
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
    left: 12px;
    bottom: 12px;
    margin: 0;
    font-size: var(--cortex-t-xs);
    color: var(--cortex-text-3);
    pointer-events: none;
  }
</style>
