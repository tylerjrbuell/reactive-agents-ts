<script lang="ts">
  import { getContext, onDestroy, onMount } from "svelte";
  import { writable } from "svelte/store";
  import { goto } from "$app/navigation";
  import VitalsStrip from "$lib/components/VitalsStrip.svelte";
  import TracePanel from "$lib/components/TracePanel.svelte";
  import RunOverview from "$lib/components/RunOverview.svelte";
  import DecisionLog from "$lib/components/DecisionLog.svelte";
  import MemoryPanel from "$lib/components/MemoryPanel.svelte";
  import ContextGauge from "$lib/components/ContextGauge.svelte";
  import SignalMonitor from "$lib/components/SignalMonitor.svelte";
  import RawEventLog from "$lib/components/RawEventLog.svelte";
  import DebriefPanel from "$lib/components/DebriefPanel.svelte";
  import ConfirmModal from "$lib/components/ConfirmModal.svelte";
  import { createRunStore } from "$lib/stores/run-store.js";
  import { createSignalStore } from "$lib/stores/signal-store.js";
  import { createTraceStore } from "$lib/stores/trace-store.js";
  import type { CortexLiveMsg, RunState } from "$lib/stores/run-store.js";
  import type { AgentStore } from "$lib/stores/agent-store.js";
  import { CORTEX_SERVER_URL } from "$lib/constants.js";
  import { toast } from "$lib/stores/toast-store.js";

  interface Props {
    runId: string;
  }
  let { runId }: Props = $props();

  const runStore = createRunStore(runId);
  const agentStore = getContext<AgentStore>("agentStore");

  // ── Replay state ───────────────────────────────────────────────────────
  // null = live mode; number = replay cursor (target iteration index 1-based)
  let replayIteration = $state<number | null>(null);
  let replayPlaying = $state(false);
  let replayTimer: ReturnType<typeof setInterval> | null = null;

  // The activeState writable is what signal/trace stores consume.
  // In live mode it mirrors runStore; in replay mode events are sliced.
  const activeState = writable<RunState>({ ...$runStore });

  // Keep activeState in sync whenever runStore or replayIteration changes
  $effect(() => {
    const run = $runStore;
    if (replayIteration === null) {
      activeState.set(run);
    } else {
      // Slice events up to the Nth ReasoningIterationProgress boundary
      const events = run.events;
      let count = 0;
      let cutIdx = events.length - 1;
      for (let i = 0; i < events.length; i++) {
        if (events[i]!.type === "ReasoningIterationProgress") {
          count++;
          if (count >= replayIteration) { cutIdx = i; break; }
        }
      }
      activeState.set({ ...run, events: events.slice(0, cutIdx + 1) });
    }
  });

  const signalStore = createSignalStore(activeState);
  const traceStore = createTraceStore(activeState);

  // Derived: max iterations available for replay
  const replayMax = $derived(
    $runStore.events.filter((e) => e.type === "ReasoningIterationProgress").length,
  );

  function enterReplay() {
    if (replayMax === 0) return;
    replayIteration = replayMax; // start at end (full view)
  }

  function exitReplay() {
    replayIteration = null;
    stopReplayPlay();
  }

  function stepBack() {
    if (replayIteration !== null && replayIteration > 1) replayIteration--;
  }

  function stepForward() {
    if (replayIteration !== null && replayIteration < replayMax) replayIteration++;
    else if (replayIteration === replayMax) exitReplay();
  }

  function startReplayPlay() {
    if (replayIteration === null) enterReplay();
    replayIteration = 1;
    replayPlaying = true;
    replayTimer = setInterval(() => {
      if (replayIteration !== null && replayIteration < replayMax) {
        replayIteration++;
      } else {
        stopReplayPlay();
      }
    }, 800);
  }

  function stopReplayPlay() {
    replayPlaying = false;
    if (replayTimer) { clearInterval(replayTimer); replayTimer = null; }
  }

  // ── Export ─────────────────────────────────────────────────────────────
  async function exportJSON() {
    try {
      const [runRes, eventsRes] = await Promise.all([
        fetch(`${CORTEX_SERVER_URL}/api/runs/${encodeURIComponent(runId)}`),
        fetch(`${CORTEX_SERVER_URL}/api/runs/${encodeURIComponent(runId)}/events`),
      ]);
      const run = await runRes.json();
      const events = await eventsRes.json();
      const blob = new Blob([JSON.stringify({ run, events }, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `cortex-run-${runId.slice(0, 8)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Run exported", "Saved as JSON");
    } catch { toast.error("Export failed"); }
  }

  async function copyMarkdown() {
    const md = ($runStore.debrief as any)?.markdown;
    if (md) {
      await navigator.clipboard.writeText(md);
      toast.success("Copied debrief markdown");
    } else {
      // Generate minimal markdown from trace
      const lines = [`# Run ${runId.slice(0, 8)}`, `**Status:** ${$runStore.status}`,
        `**Tokens:** ${$runStore.vitals.tokensUsed.toLocaleString()}`,
        `**Provider:** ${$runStore.vitals.provider ?? "unknown"} / ${$runStore.vitals.model ?? "unknown"}`, ""];
      for (const f of $traceStore) {
        lines.push(`## Iteration ${f.iteration}`, f.thought, "");
      }
      await navigator.clipboard.writeText(lines.join("\n"));
      toast.success("Copied run as markdown");
    }
  }

  // ── Confirmation modal ────────────────────────────────────────────────
  let showDeleteConfirm = $state(false);

  let selectedIteration = $state<number | null>(null);
  let bottomTab = $state<"decisions" | "memory" | "context" | "debrief" | "signal" | "events">("decisions");
  let deletingRun = $state(false);

  onDestroy(() => {
    stopReplayPlay();
  });

  // ── Resizable bottom panel (with minimize) ────────────────────────────
  const MIN_H = 100;
  const MAX_H = 520;
  const DEFAULT_H = 180;
  let panelHeight = $state(DEFAULT_H);
  let panelMinimized = $state(false);
  let isDragging = $state(false);
  let heightBeforeMinimize = DEFAULT_H;

  function toggleMinimize() {
    if (panelMinimized) {
      panelMinimized = false;
      panelHeight = Math.max(MIN_H, heightBeforeMinimize);
    } else {
      heightBeforeMinimize = panelHeight;
      panelMinimized = true;
    }
  }
  let dragStartY = 0;
  let dragStartH = 0;

  function startResize(e: MouseEvent | TouchEvent) {
    isDragging = true;
    dragStartY = "touches" in e ? e.touches[0]!.clientY : e.clientY;
    dragStartH = panelHeight;

    const onMove = (ev: MouseEvent | TouchEvent) => {
      const y = "touches" in ev ? ev.touches[0]!.clientY : ev.clientY;
      const delta = dragStartY - y; // dragging UP = larger panel
      panelHeight = Math.max(MIN_H, Math.min(MAX_H, dragStartH + delta));
    };
    const onUp = () => {
      isDragging = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchmove", onMove as EventListener);
      window.removeEventListener("touchend", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchmove", onMove as EventListener, { passive: false });
    window.addEventListener("touchend", onUp);
  }

  // Auto-open debrief tab when debrief arrives and user hasn't manually switched
  let autoOpenedDebrief = $state(false);
  $effect(() => {
    if ($runStore.debrief && !autoOpenedDebrief && bottomTab === "decisions") {
      bottomTab = "debrief";
      autoOpenedDebrief = true;
    }
  });

  function panelEvents(msgs: CortexLiveMsg[]) {
    return msgs.map((m) => ({ type: m.type, payload: m.payload, ts: m.ts }));
  }

  async function confirmDeleteRun() {
    showDeleteConfirm = false;
    deletingRun = true;
    try {
      const deleted = await runStore.deleteRun();
      if (deleted) { await agentStore.refresh(); await goto("/"); }
    } finally { deletingRun = false; }
  }

  onDestroy(() => { runStore.destroy(); stopReplayPlay(); });
</script>

<svelte:head>
  <title>CORTEX — Run {runId.slice(0, 8)}</title>
</svelte:head>

<div class="flex flex-col h-full overflow-hidden min-h-0">

  <!-- Breadcrumb + replay controls + export -->
  <nav class="flex-shrink-0 px-4 py-2 border-b border-white/5 flex items-center gap-2 text-[10px] font-mono text-outline">
    <a href="/" class="text-secondary hover:text-primary no-underline">Stage</a>
    <span class="text-on-surface/20">/</span>
    <span class="text-on-surface/60 truncate max-w-[120px]" title={runId}>{runId.slice(0, 12)}…</span>
    {#if $runStore.isChat}
      <span class="ml-1 px-1.5 py-0.5 rounded border border-primary/30 text-primary text-[9px]">CHAT</span>
    {/if}

    {#if replayIteration !== null}
      <!-- Replay mode badge + controls -->
      <span class="px-2 py-0.5 rounded bg-tertiary/15 border border-tertiary/30 text-tertiary text-[9px] uppercase tracking-wider">
        REPLAY iter {replayIteration}/{replayMax}
      </span>
      <div class="flex items-center gap-1">
        <button type="button" onclick={stepBack} disabled={replayIteration <= 1}
          class="material-symbols-outlined text-sm text-outline hover:text-primary disabled:opacity-30 bg-transparent border-0 cursor-pointer p-0.5">
          skip_previous</button>
        {#if replayPlaying}
          <button type="button" onclick={stopReplayPlay}
            class="material-symbols-outlined text-sm text-tertiary bg-transparent border-0 cursor-pointer p-0.5">
            pause</button>
        {:else}
          <button type="button" onclick={startReplayPlay}
            class="material-symbols-outlined text-sm text-outline hover:text-primary bg-transparent border-0 cursor-pointer p-0.5">
            play_arrow</button>
        {/if}
        <button type="button" onclick={stepForward} disabled={replayIteration >= replayMax}
          class="material-symbols-outlined text-sm text-outline hover:text-primary disabled:opacity-30 bg-transparent border-0 cursor-pointer p-0.5">
          skip_next</button>
        <button type="button" onclick={exitReplay}
          class="material-symbols-outlined text-sm text-outline hover:text-error bg-transparent border-0 cursor-pointer p-0.5"
          title="Exit replay">close</button>
      </div>
    {:else if $runStore.status !== "live" && replayMax > 0}
      <!-- Enter replay button for completed runs -->
      <button type="button" onclick={enterReplay}
        class="flex items-center gap-1 px-2 py-0.5 border border-outline-variant/20 text-outline rounded
               hover:border-tertiary/40 hover:text-tertiary transition-colors bg-transparent cursor-pointer text-[9px] uppercase">
        <span class="material-symbols-outlined text-[12px]">replay</span>
        Replay
      </button>
    {/if}

    <div class="flex-1"></div>

    <!-- Export buttons -->
    <button type="button" onclick={exportJSON}
      class="flex items-center gap-1 text-outline hover:text-primary transition-colors bg-transparent border-0 cursor-pointer"
      title="Download as JSON">
      <span class="material-symbols-outlined text-sm">download</span>
    </button>
    <button type="button" onclick={copyMarkdown}
      class="flex items-center gap-1 text-outline hover:text-primary transition-colors bg-transparent border-0 cursor-pointer"
      title="Copy as Markdown">
      <span class="material-symbols-outlined text-sm">content_copy</span>
    </button>
  </nav>

  <!-- Vitals strip -->
  <VitalsStrip vitals={$runStore.vitals} status={$runStore.status} {runId} />

  <!-- ── Main content: TRACE (left, wider) + OVERVIEW (right, compact) ── -->
  <div class="flex-1 grid grid-cols-1 md:grid-cols-[60%_40%] gap-3 p-3 overflow-hidden min-h-0">

    <!-- Left: Execution Trace — the primary view -->
    <section class="min-h-0 overflow-hidden flex flex-col">
      {#if $runStore.status === "failed"}
        <!-- Error banner when run failed -->
        {@const errorEvents = $runStore.events.filter(
          (e) => e.type === "TaskFailed" || (e.type === "AgentCompleted" && e.payload.success === false),
        )}
        <div class="flex-shrink-0 mb-2 bg-error/6 border border-error/25 rounded-lg p-3">
          <div class="flex items-center gap-2 mb-1.5">
            <span class="material-symbols-outlined text-error text-sm" style="font-variation-settings: 'FILL' 1;">error</span>
            <span class="font-mono text-xs text-error uppercase tracking-widest font-bold">Run Failed</span>
          </div>
          {#each errorEvents.slice(0, 1) as ev}
            <p class="font-mono text-[10px] text-error/70 leading-relaxed">
              {typeof ev.payload.error === "string"
                ? ev.payload.error
                : typeof ev.payload.reason === "string"
                  ? ev.payload.reason
                  : "Agent terminated with failure — see trace for last known state."}
            </p>
          {/each}
        </div>
      {/if}

      <div class="flex-1 min-h-0 overflow-hidden">
        <TracePanel
          frames={$traceStore}
          status={$runStore.status}
          streamText={$runStore.streamText}
          frame={selectedIteration === null
            ? $traceStore[$traceStore.length - 1] ?? null
            : ($traceStore.find((f) => f.iteration === selectedIteration) ?? null)}
        />
      </div>
    </section>

    <!-- Right: Compact overview panel -->
    <section class="min-h-0 overflow-hidden">
      <RunOverview
        vitals={$runStore.vitals}
        status={$runStore.status}
        signal={$signalStore}
        debrief={$runStore.debrief}
        eventCount={$runStore.events.length}
      />
    </section>
  </div>

  <!-- ── Footer: tabs + controls ────────────────────────────────────────── -->
  <footer class="bg-[#17181c]/90 backdrop-blur-md flex justify-between items-center px-4 flex-shrink-0 border-t border-white/5 h-12">
    <div class="flex items-center h-full gap-0">
      {#each [
        { id: "decisions", label: "Decisions",    icon: "analytics"    },
        { id: "memory",    label: "Memory",       icon: "account_tree" },
        { id: "context",   label: "Context",      icon: "data_usage"   },
        { id: "debrief",   label: "Debrief",      icon: "summarize",
          dot: !!$runStore.debrief },
        { id: "signal",    label: "Signal",       icon: "show_chart"   },
        { id: "events",    label: "Events",       icon: "terminal"     },
      ] as tab (tab.id)}
        <button
          type="button"
          class="flex items-center gap-1.5 px-3 h-full text-[10px] font-mono uppercase tracking-wider
                 border-0 bg-transparent cursor-pointer transition-all duration-150
                 {bottomTab === tab.id
                   ? 'text-primary border-t-2 border-primary -mt-0.5 bg-primary/5'
                   : 'text-outline hover:text-on-surface hover:bg-white/5'}"
          onclick={() => {
            bottomTab = tab.id as typeof bottomTab;
            // Clicking a tab restores the panel if it was minimized
            if (panelMinimized) panelMinimized = false;
          }}
        >
          <span class="relative">
            <span class="material-symbols-outlined text-[13px]">{tab.icon}</span>
            {#if (tab as any).dot}
              <span class="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-secondary"></span>
            {/if}
          </span>
          <span class="hidden sm:inline">{tab.label}</span>
        </button>
      {/each}
    </div>

    <div class="flex items-center gap-2">
      {#if $runStore.status === "live"}
        <button
          type="button"
          class="px-4 py-1.5 border border-primary/35 text-primary font-mono text-[10px] uppercase
                 rounded bg-transparent cursor-pointer hover:bg-primary/10 transition-colors"
          onclick={() => void runStore.pause()}
        >Pause</button>
        <button
          type="button"
          class="px-4 py-1.5 border border-error/35 text-error font-mono text-[10px] uppercase
                 rounded bg-transparent cursor-pointer hover:bg-error/10 transition-colors"
          onclick={() => void runStore.stop()}
        >Stop</button>
      {/if}
      <button
        type="button"
        class="px-3 py-1.5 border border-outline-variant/30 text-outline font-mono text-[10px]
               uppercase rounded bg-transparent cursor-pointer hover:text-on-surface hover:border-outline-variant/60
               transition-colors"
        onclick={() => goto("/")}
      >Back</button>
      <button
        type="button"
        disabled={deletingRun}
        class="px-3 py-1.5 border border-error/30 text-error font-mono text-[10px] uppercase
               rounded bg-transparent cursor-pointer hover:bg-error/10 transition-colors
               disabled:opacity-40 disabled:cursor-not-allowed"
        onclick={() => (showDeleteConfirm = true)}
      >{deletingRun ? "…" : "Delete"}</button>
    </div>
  </footer>

  <!-- ── Resizable bottom panel (VS Code terminal style) ───────────────── -->
  <div
    class="flex-shrink-0 flex flex-col border-t border-white/5 bg-surface-container-lowest/60 transition-none"
    style="height: {panelMinimized ? '0px' : panelHeight + 'px'}; overflow: {panelMinimized ? 'hidden' : 'visible'};"
  >
    <!-- Drag handle row — resize + minimize control -->
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div class="flex-shrink-0 h-6 flex items-center group relative border-t border-white/5">
      <!-- Draggable zone (left 80%) -->
      <div
        class="flex-1 h-full cursor-ns-resize flex items-center justify-center
               hover:bg-primary/10 transition-colors {isDragging ? 'bg-primary/15' : ''}"
        onmousedown={startResize}
        ontouchstart={startResize}
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize panel"
      >
        <div class="w-10 h-0.5 rounded-full bg-outline/15 group-hover:bg-primary/40 transition-colors"></div>
      </div>
      <!-- Minimize toggle button -->
      <button
        type="button"
        onclick={toggleMinimize}
        class="flex-shrink-0 h-full px-3 flex items-center text-outline/30 hover:text-primary/60
               transition-colors bg-transparent border-0 cursor-pointer"
        title={panelMinimized ? "Expand panel" : "Minimize panel"}
      >
        <span class="material-symbols-outlined text-[13px] transition-transform {panelMinimized ? 'rotate-180' : ''}">
          keyboard_arrow_down
        </span>
      </button>
    </div>

    <!-- Panel content (takes remaining height) -->
    <div class="flex-1 overflow-hidden min-h-0">
      {#if bottomTab === "decisions"}
        <DecisionLog events={panelEvents($runStore.events)} />
      {:else if bottomTab === "memory"}
        <MemoryPanel events={panelEvents($runStore.events)} />
      {:else if bottomTab === "context"}
        <ContextGauge events={panelEvents($runStore.events)} />
      {:else if bottomTab === "debrief"}
        <DebriefPanel debrief={$runStore.debrief} status={$runStore.status} />
      {:else if bottomTab === "signal"}
        <SignalMonitor
          data={$signalStore}
          onselectIteration={(n) => {
            selectedIteration = n;
            signalStore.selectIteration(n);
          }}
        />
      {:else}
        <RawEventLog events={panelEvents($runStore.events)} />
      {/if}
    </div>
  </div>
</div>

{#if showDeleteConfirm}
  <ConfirmModal
    title="Delete Run"
    message="Delete run {runId.slice(0, 8)}…? This permanently removes the run and all its events from Cortex."
    confirmLabel="Delete"
    onConfirm={confirmDeleteRun}
    onCancel={() => (showDeleteConfirm = false)}
  />
{/if}
