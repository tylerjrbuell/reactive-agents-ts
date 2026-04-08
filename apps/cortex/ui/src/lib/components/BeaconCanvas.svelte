<script lang="ts">
  import type { AgentNode } from "$lib/stores/agent-store.js";
  import BeaconNode from "./BeaconNode.svelte";

  interface Props {
    agents: AgentNode[];
  }
  let { agents }: Props = $props();

  // ── Positioning ────────────────────────────────────────────────────────────

  /**
   * Golden-angle spiral from center — deterministic initial scatter.
   * Returns x/y as percentages of canvas dimensions.
   */
  function nodePos(index: number): { x: number; y: number } {
    if (index === 0) return { x: 50, y: 42 };
    const angle = index * 2.399963; // 137.508° in radians
    const r = 18 + Math.sqrt(index) * 12;
    return {
      x: Math.max(9, Math.min(89, 50 + r * Math.cos(angle))),
      y: Math.max(8, Math.min(76, 42 + r * Math.sin(angle) * 0.6)),
    };
  }

  /**
   * Persistent position map — survives agent list changes and stores drag overrides.
   * Keyed by runId so re-ordering the agents array doesn't reset positions.
   */
  let posMap = $state(new Map<string, { x: number; y: number }>());

  /** Seed positions for arriving agents; prune departed ones. */
  $effect(() => {
    let changed = false;
    const next = new Map(posMap);
    agents.forEach((agent, i) => {
      if (!next.has(agent.runId)) {
        next.set(agent.runId, nodePos(i));
        changed = true;
      }
    });
    for (const [runId] of next) {
      if (!agents.some((a) => a.runId === runId)) {
        next.delete(runId);
        changed = true;
      }
    }
    if (changed) posMap = next;
  });

  const nodePositions = $derived(
    agents.map((a, i) => posMap.get(a.runId) ?? nodePos(i)),
  );

  // Connection lines
  const posById = $derived(new Map(agents.map((a, i) => [a.runId, nodePositions[i]])));
  const lines = $derived(
    agents
      .filter((a) => a.parentRunId && posById.has(a.parentRunId!) && posById.has(a.runId))
      .map((a) => {
        const p = posById.get(a.parentRunId!)!;
        const c = posById.get(a.runId)!;
        const isActive = ["running", "exploring", "stressed"].includes(a.state);
        return { key: a.runId, x1: p.x, y1: p.y, x2: c.x, y2: c.y, active: isActive };
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
    if (drag?.runId === runId) drag = null;
  }

  // ── Stats ──────────────────────────────────────────────────────────────────

  const activeCount = $derived(
    agents.filter((a) => ["running", "exploring", "stressed"].includes(a.state)).length,
  );
  const completedCount = $derived(agents.filter((a) => a.state === "completed").length);
  const errorCount = $derived(agents.filter((a) => a.state === "error").length);
  const totalTokens = $derived(agents.reduce((s, a) => s + a.tokensUsed, 0));
  const totalCost = $derived(agents.reduce((s, a) => s + a.cost, 0));
</script>

<div
  class="beacon-canvas relative w-full h-full overflow-hidden"
  class:is-dragging={draggingRunId !== null}
  bind:this={canvasEl}
>
  <!-- Dot-grid background -->
  <div class="beacon-dot-grid absolute inset-0 pointer-events-none" aria-hidden="true"></div>

  <!-- Ambient glow fields (match CortexDeskShell) -->
  <div class="pointer-events-none absolute top-1/4 left-1/3 h-[min(500px,55vh)] w-[min(500px,85vw)] rounded-full blur-[90px] bg-primary/[0.06] dark:bg-primary/[0.09]" aria-hidden="true"></div>
  <div class="pointer-events-none absolute bottom-1/4 right-1/4 h-[min(350px,40vh)] w-[min(350px,65vw)] rounded-full blur-[80px] bg-secondary/[0.04] dark:bg-secondary/[0.07]" aria-hidden="true"></div>

  <!-- SVG connection lines -->
  <svg
    class="absolute inset-0 w-full h-full pointer-events-none z-0"
    style="overflow: visible;"
    aria-hidden="true"
  >
    {#each lines as line (line.key)}
      <line
        x1="{line.x1}%" y1="{line.y1}%"
        x2="{line.x2}%" y2="{line.y2}%"
        class="beacon-line-ghost"
        stroke-width="1"
      />
      <line
        x1="{line.x1}%" y1="{line.y1}%"
        x2="{line.x2}%" y2="{line.y2}%"
        class="beacon-line-signal"
        class:signal-active={line.active}
        stroke-width="1"
        stroke-dasharray="5 7"
      />
    {/each}
  </svg>

  <!-- Agent nodes -->
  {#each agents as agent, i (agent.runId)}
    {@const isDragging = draggingRunId === agent.runId}
    <div
      class="node-wrapper absolute z-10 group"
      class:z-20={isDragging}
      class:is-dragging-node={isDragging}
      style="
        left: {nodePositions[i].x}%;
        top: {nodePositions[i].y}%;
        transform: translate(-50%, -50%);
        animation: beacon-node-appear 0.4s cubic-bezier(0.16, 1, 0.3, 1) both;
        animation-delay: {posMap.has(agent.runId) && !isDragging ? '0ms' : `${Math.min(i, 10) * 55}ms`};
      "
    >
      <BeaconNode {agent} />

      <!-- Drag handle — appears on hover above the icon box -->
      <div
        class="drag-handle absolute left-1/2 -translate-x-1/2 -top-4
               opacity-0 group-hover:opacity-100 transition-opacity duration-150
               flex items-center justify-center gap-0.5 px-1.5 py-0.5 rounded-full"
        class:drag-handle-active={isDragging}
        onpointerdown={(e) => onHandlePointerDown(e, agent.runId, i)}
        onpointermove={(e) => onHandlePointerMove(e, agent.runId)}
        onpointerup={(e) => onHandlePointerUp(e, agent.runId)}
        title="Drag to reposition"
        role="button"
        tabindex="-1"
        aria-label="Drag to reposition {agent.name}"
      >
        <span class="material-symbols-outlined drag-handle-icon text-[12px] leading-none">
          drag_indicator
        </span>
      </div>
    </div>
  {/each}

  <!-- Stats HUD — top-right -->
  <div class="absolute top-5 right-5 z-20 flex flex-col gap-2 pointer-events-none">
    <div class="hud-panel px-3.5 py-2.5 min-w-[158px]">
      <p class="hud-label mb-1.5">Active Agents</p>
      <div class="flex items-end gap-3">
        <p class="hud-value">
          {activeCount}<span class="hud-unit"> / {agents.length}</span>
        </p>
        {#if activeCount > 0}
          <div class="flex gap-px items-end h-4 pb-0.5">
            {#each Array(Math.min(activeCount, 10)) as _, i (i)}
              <div
                class="w-[2px] rounded-full hud-bar"
                style="height: {35 + ((i * 13) % 48)}%; animation: hud-bar-pulse 1.8s ease-in-out {i * 0.2}s infinite alternate;"
              ></div>
            {/each}
          </div>
        {/if}
      </div>
      {#if completedCount > 0 || errorCount > 0}
        <div class="mt-1.5 flex gap-2 flex-wrap">
          {#if completedCount > 0}
            <span class="hud-badge hud-badge-settled">{completedCount} settled</span>
          {/if}
          {#if errorCount > 0}
            <span class="hud-badge hud-badge-error">{errorCount} error</span>
          {/if}
        </div>
      {/if}
    </div>
    {#if totalTokens > 0}
      <div class="hud-panel hud-panel-tokens px-3.5 py-2.5 min-w-[158px]">
        <p class="hud-label mb-1.5">Tokens Used</p>
        <p class="hud-value hud-value-tokens">
          {totalTokens >= 1000 ? `${(totalTokens / 1000).toFixed(1)}k` : totalTokens}
          <span class="hud-unit">tok</span>
        </p>
        {#if totalCost > 0}
          <p class="hud-label mt-1">${totalCost.toFixed(4)} est.</p>
        {/if}
      </div>
    {/if}
  </div>

  <!-- Drag hint (first time) -->
  {#if agents.length > 0 && draggingRunId === null}
    <p class="absolute bottom-3 left-1/2 -translate-x-1/2 font-mono text-[7px] uppercase tracking-[0.18em] pointer-events-none select-none hud-hint">
      drag to rearrange
    </p>
  {/if}
</div>

<style>
  .beacon-canvas { background: var(--cortex-bg); }

  .beacon-dot-grid {
    background-image: radial-gradient(circle, rgba(139,92,246,0.22) 1px, transparent 1px);
    background-size: 36px 36px;
  }
  :global(html:not(.dark)) .beacon-dot-grid {
    background-image: radial-gradient(circle, rgba(124,58,237,0.09) 1px, transparent 1px);
  }

  /* Dragged node lifts slightly */
  .node-wrapper.is-dragging-node { filter: drop-shadow(0 8px 24px rgba(139,92,246,0.35)); }
  :global(html:not(.dark)) .node-wrapper.is-dragging-node {
    filter: drop-shadow(0 8px 20px rgba(124,58,237,0.2));
  }
  .beacon-canvas.is-dragging { user-select: none; }

  /* Drag handle pill */
  .drag-handle {
    cursor: grab;
    touch-action: none;
    background: color-mix(in srgb, var(--cortex-surface) 90%, transparent);
    border: 1px solid rgba(139,92,246,0.25);
    box-shadow: 0 1px 6px rgba(0,0,0,0.25);
  }
  :global(html:not(.dark)) .drag-handle {
    background: rgba(255,255,255,0.9);
    border-color: rgba(124,58,237,0.18);
    box-shadow: 0 1px 4px rgba(0,0,0,0.1);
  }
  .drag-handle:active,
  .drag-handle.drag-handle-active { cursor: grabbing; }

  .drag-handle-icon { color: rgba(139,92,246,0.7); }
  :global(html:not(.dark)) .drag-handle-icon { color: rgba(109,40,217,0.6); }

  /* Connection lines */
  .beacon-line-ghost { stroke: rgba(139,92,246,0.08); }
  :global(html:not(.dark)) .beacon-line-ghost { stroke: rgba(124,58,237,0.07); }

  .beacon-line-signal { stroke: rgba(75,85,99,0.3); }
  :global(html:not(.dark)) .beacon-line-signal { stroke: rgba(124,58,237,0.18); }

  .signal-active {
    stroke: rgba(167,139,250,0.55);
    animation: signal-flow 1.4s linear infinite;
  }
  :global(html:not(.dark)) .signal-active { stroke: rgba(109,40,217,0.45); }
  @keyframes signal-flow { to { stroke-dashoffset: -24; } }

  /* Node appear */
  @keyframes beacon-node-appear {
    from { opacity: 0; transform: translate(-50%,-50%) scale(0.72); }
    to   { opacity: 1; transform: translate(-50%,-50%) scale(1); }
  }

  /* HUD */
  .hud-panel {
    background: color-mix(in srgb, var(--cortex-surface) 92%, transparent);
    border: 1px solid rgba(139,92,246,0.2);
    border-radius: 6px;
    backdrop-filter: blur(12px);
    box-shadow: 0 0 0 1px rgba(0,0,0,0.18), 0 4px 20px rgba(0,0,0,0.12), inset 0 1px 0 rgba(139,92,246,0.07);
  }
  :global(html:not(.dark)) .hud-panel {
    background: rgba(255,255,255,0.88);
    border-color: rgba(124,58,237,0.16);
    box-shadow: 0 0 0 1px rgba(0,0,0,0.06), 0 4px 16px rgba(0,0,0,0.08);
  }
  .hud-panel-tokens { border-color: rgba(6,182,212,0.2); }
  :global(html:not(.dark)) .hud-panel-tokens { border-color: rgba(6,182,212,0.14); }

  .hud-label {
    font-family: ui-monospace, "Cascadia Code", "Source Code Pro", monospace;
    font-size: 7px; letter-spacing: 0.18em; text-transform: uppercase;
    color: var(--cortex-text-muted); opacity: 0.65;
  }
  .hud-value {
    font-family: ui-monospace, "Cascadia Code", "Source Code Pro", monospace;
    font-size: 20px; font-weight: 700; line-height: 1; color: #a78bfa;
  }
  :global(html:not(.dark)) .hud-value { color: #6d28d9; }
  .hud-value-tokens { color: #22d3ee; }
  :global(html:not(.dark)) .hud-value-tokens { color: #0e7490; }
  .hud-unit { font-size: 9px; font-weight: 400; color: var(--cortex-text-muted); opacity: 0.55; }
  .hud-bar { background: rgba(167,139,250,0.7); }
  :global(html:not(.dark)) .hud-bar { background: rgba(109,40,217,0.55); }
  @keyframes hud-bar-pulse { from { opacity: 0.45; } to { opacity: 1; } }

  .hud-badge {
    font-family: ui-monospace, "Cascadia Code", "Source Code Pro", monospace;
    font-size: 7px; letter-spacing: 0.1em; text-transform: uppercase;
    border: 1px solid; border-radius: 3px; padding: 1px 5px;
  }
  .hud-badge-settled { color: #22d3ee; border-color: rgba(6,182,212,0.25); }
  :global(html:not(.dark)) .hud-badge-settled { color: #0e7490; border-color: rgba(6,182,212,0.3); }
  .hud-badge-error { color: #f87171; border-color: rgba(239,68,68,0.25); }
  :global(html:not(.dark)) .hud-badge-error { color: #dc2626; border-color: rgba(239,68,68,0.3); }

  .hud-hint {
    color: var(--cortex-text-muted);
    opacity: 0.3;
  }
</style>
