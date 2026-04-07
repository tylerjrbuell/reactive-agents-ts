<script lang="ts">
  import { getContext, onDestroy } from "svelte";
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
  import MessagesPanel from "$lib/components/MessagesPanel.svelte";
  import RunChatTab from "$lib/components/RunChatTab.svelte";
  import RunFinalDeliverable from "$lib/components/RunFinalDeliverable.svelte";
  import DebriefPanel from "$lib/components/DebriefPanel.svelte";
  import ConfirmModal from "$lib/components/ConfirmModal.svelte";
  import Tooltip from "$lib/components/Tooltip.svelte";
  import { createRunStore } from "$lib/stores/run-store.js";
  import { createSignalStore } from "$lib/stores/signal-store.js";
  import { createTraceStore } from "$lib/stores/trace-store.js";
  import type { CortexLiveMsg, RunState } from "$lib/stores/run-store.js";
  import type { AgentStore } from "$lib/stores/agent-store.js";
  import { CORTEX_SERVER_URL } from "$lib/constants.js";
  import { toast } from "$lib/stores/toast-store.js";
  import { countReasoningStepDisplayMessagesInRunEvents } from "@cortex/messages-extract";

  interface Props {
    runId: string;
  }
  const { runId } = $props();

  // svelte-ignore state_referenced_locally — parent uses {#key runId} to remount on change
  const runStore = createRunStore(runId);
  const agentStore = getContext<AgentStore>("agentStore");

  /** Explains replay: same axis as LOOP in the vitals strip and rows in the trace (not STEPS). */
  const REPLAY_LOOP_TOOLTIP =
    "Replay moves through kernel loops (ReasoningIterationProgress): one loop per trace row. Reasoning steps (inner strategy steps) are counted separately as STEPS.";

  // ── Replay state ───────────────────────────────────────────────────────
  // null = live mode; number = 1-based kernel loop index (same as trace / LOOP vitals)
  let replayLoopIndex = $state<number | null>(null);
  let replayPlaying = $state(false);
  let replayTimer: ReturnType<typeof setInterval> | null = null;

  // The activeState writable is what signal/trace stores consume.
  // In live mode it mirrors runStore; in replay mode events are sliced.
  const activeState = writable<RunState>({ ...$runStore });

  // Keep activeState in sync whenever runStore or replayLoopIndex changes
  $effect(() => {
    const run = $runStore;
    if (replayLoopIndex === null) {
      activeState.set(run);
    } else {
      // Slice events up to the Nth ReasoningIterationProgress boundary
      const events = run.events;
      let count = 0;
      let cutIdx = events.length - 1;
      for (let i = 0; i < events.length; i++) {
        if (events[i]!.type === "ReasoningIterationProgress") {
          count++;
          if (count >= replayLoopIndex) { cutIdx = i; break; }
        }
      }
      activeState.set({ ...run, events: events.slice(0, cutIdx + 1) });
    }
  });

  const signalStore = createSignalStore(activeState);
  const traceStore = createTraceStore(activeState);

  // Derived: max kernel loops available for replay (= trace step rows from RIP, before final-only rows)
  const replayMaxLoops = $derived(
    $runStore.events.filter((e) => e.type === "ReasoningIterationProgress").length,
  );

  /** LOOP in vitals = last framework-reported loop index; replay denominator = RIP events in this run. */
  const reportedLoopIteration = $derived($runStore.vitals.loopIteration);
  const reportedMaxIterations = $derived($runStore.vitals.maxIterations);

  const replayStoredVsReportedMismatch = $derived(
    $runStore.status !== "live" &&
      replayMaxLoops > 0 &&
      reportedLoopIteration > 0 &&
      reportedLoopIteration !== replayMaxLoops,
  );

  const replayMismatchExplain = $derived(
    `Replay moves through ${replayMaxLoops} stored ReasoningIterationProgress event(s). The LOOP figure in the bar (${reportedLoopIteration}${reportedMaxIterations > 0 ? `/${reportedMaxIterations}` : ""}) is the framework-reported loop index — they can differ if some loops were not recorded or telemetry used a different counter.`,
  );

  const replayActiveBadgeTooltip = $derived(
    replayStoredVsReportedMismatch
      ? `${REPLAY_LOOP_TOOLTIP}\n\nDenominator (${replayMaxLoops}) = ReasoningIterationProgress events stored for this run.\n\n${replayMismatchExplain}`
      : `${REPLAY_LOOP_TOOLTIP}\n\nDenominator (${replayMaxLoops}) = ReasoningIterationProgress events stored for this run.`,
  );

  const replayEnterButtonTooltip = $derived(
    replayStoredVsReportedMismatch
      ? `${REPLAY_LOOP_TOOLTIP}\n\nYou will scrub ${replayMaxLoops} stored event(s).\n\n${replayMismatchExplain}`
      : `${REPLAY_LOOP_TOOLTIP}\n\nYou will scrub ${replayMaxLoops} stored event(s).`,
  );

  function enterReplay() {
    if (replayMaxLoops === 0) return;
    replayLoopIndex = replayMaxLoops; // start at end (full view)
  }

  function exitReplay() {
    replayLoopIndex = null;
    stopReplayPlay();
  }

  function stepBack() {
    if (replayLoopIndex !== null && replayLoopIndex > 1) replayLoopIndex--;
  }

  function stepForward() {
    if (replayLoopIndex !== null && replayLoopIndex < replayMaxLoops) replayLoopIndex++;
    else if (replayLoopIndex === replayMaxLoops) exitReplay();
  }

  function startReplayPlay() {
    if (replayLoopIndex === null) enterReplay();
    replayLoopIndex = 1;
    replayPlaying = true;
    replayTimer = setInterval(() => {
      if (replayLoopIndex !== null && replayLoopIndex < replayMaxLoops) {
        replayLoopIndex++;
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

  const finalTraceFrame = $derived($traceStore.findLast((f) => f.kind === "final") ?? null);

  const finalDeliverableText = $derived.by(() => {
    const fromTrace = finalTraceFrame?.thought?.trim() ?? "";
    if (fromTrace) return fromTrace;
    for (let i = $runStore.events.length - 1; i >= 0; i--) {
      const e = $runStore.events[i];
      if (e?.type === "FinalAnswerProduced") {
        const a = e.payload?.answer;
        if (typeof a === "string" && a.trim()) return a.trim();
      }
    }
    return "";
  });

  const failurePrimaryMessage = $derived.by(() => {
    if ($runStore.status !== "failed") return "";
    const ev = $runStore.events.find(
      (e) =>
        e.type === "TaskFailed" ||
        (e.type === "AgentCompleted" && e.payload.success === false),
    );
    if (!ev) return "";
    const p = ev.payload;
    if (typeof p.error === "string") return p.error;
    if (typeof p.reason === "string") return p.reason;
    return "";
  });

  const finalDeliverableMeta = $derived(
    finalTraceFrame
      ? {
          model: finalTraceFrame.model,
          tokensUsed: finalTraceFrame.tokensUsed,
          estimatedCost: finalTraceFrame.estimatedCost,
          durationMs: finalTraceFrame.durationMs,
        }
      : undefined,
  );

  async function copyMarkdown() {
    const primary = finalDeliverableText.trim();
    if (primary) {
      await navigator.clipboard.writeText(primary);
      toast.success("Copied", "Final answer copied to clipboard");
      return;
    }
    const md = ($runStore.debrief as { markdown?: string } | null)?.markdown;
    if (typeof md === "string" && md) {
      await navigator.clipboard.writeText(md);
      toast.success("Copied debrief markdown");
    } else {
      const lines = [`# Run ${runId.slice(0, 8)}`, `**Status:** ${$runStore.status}`,
        `**Tokens:** ${$runStore.vitals.tokensUsed.toLocaleString()}`,
        `**Provider:** ${$runStore.vitals.provider ?? "unknown"} / ${$runStore.vitals.model ?? "unknown"}`, ""];
      for (const f of $traceStore) {
        lines.push(`## Loop ${f.iteration}`, f.thought, "");
      }
      await navigator.clipboard.writeText(lines.join("\n"));
      toast.success("Copied run as markdown");
    }
  }

  // ── Confirmation modal ────────────────────────────────────────────────
  let showDeleteConfirm = $state(false);

  let selectedIteration = $state<number | null>(null);
  let bottomTab = $state<
    "decisions" | "memory" | "context" | "debrief" | "signal" | "events" | "messages" | "chat"
  >("decisions");

  /** Matches `GET /api/runs/:runId/messages` — includes synthetic thought/action/observation rows. */
  const cortexMessageCount = $derived(
    countReasoningStepDisplayMessagesInRunEvents($runStore.events),
  );
  let deletingRun = $state(false);

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

  onDestroy(() => {
    stopReplayPlay();
    runStore.destroy();
  });
</script>

<svelte:head>
  <title>CORTEX — Run {runId.slice(0, 8)}</title>
</svelte:head>

<div class="flex flex-col h-full overflow-hidden min-h-0 bg-background/0">

  <!-- Breadcrumb + replay controls + export -->
  <nav
    class="flex-shrink-0 px-3 sm:px-4 py-2 border-b border-[var(--cortex-border)] flex flex-wrap items-center gap-x-2 gap-y-2 text-[10px] font-mono text-outline bg-surface-container-low/35 dark:bg-surface-container-low/25 backdrop-blur-sm"
  >
    <div class="flex items-center gap-1.5 min-w-0">
      <span class="material-symbols-outlined text-secondary/80 text-[15px] shrink-0" aria-hidden="true"
        >alt_route</span>
      <a href="/" class="text-secondary hover:text-primary no-underline shrink-0">Beacon</a>
      <span class="text-on-surface/25 shrink-0">/</span>
      <Tooltip text={runId} class="max-w-[min(100%,140px)] min-w-0">
        <span class="text-on-surface/70 truncate block font-mono text-[9px] normal-case tracking-normal"
          >{runId.slice(0, 12)}…</span>
      </Tooltip>
    </div>
    {#if $runStore.isChat}
      <span
        class="px-1.5 py-0.5 rounded-md border border-primary/35 bg-primary/8 text-primary text-[9px] font-semibold tracking-wide"
        >CHAT</span>
    {/if}

    {#if replayLoopIndex !== null}
      <!-- Replay mode: scrub index is 1..N where N = stored RIP count (may differ from header LOOP) -->
      <div
        class="flex items-center gap-1 flex-wrap min-w-0 max-w-[min(100%,320px)] rounded-lg border border-[var(--cortex-border)] bg-surface-container-low/50 px-1 py-0.5"
      >
        <Tooltip text={replayActiveBadgeTooltip}>
          <span
            class="rounded border border-amber-400/45 bg-amber-100/80 px-2 py-0.5 text-[9px] uppercase tracking-wider text-amber-900 dark:border-amber-800/50 dark:bg-amber-950/40 dark:text-amber-600/95"
          >
            REPLAY {replayLoopIndex}/{replayMaxLoops} events
          </span>
        </Tooltip>
        <div class="flex items-center gap-1">
            <Tooltip text="Previous stored ReasoningIterationProgress boundary">
              <span class="inline-flex">
                <button type="button" onclick={stepBack} disabled={replayLoopIndex <= 1}
                  aria-label="Previous stored progress event"
                  class="material-symbols-outlined text-sm text-outline hover:text-primary disabled:opacity-30 bg-transparent border-0 cursor-pointer p-0.5">skip_previous</button>
              </span>
            </Tooltip>
            {#if replayPlaying}
              <Tooltip text="Pause replay">
                <button type="button" onclick={stopReplayPlay} aria-label="Pause replay"
                  class="material-symbols-outlined cursor-pointer border-0 bg-transparent p-0.5 text-sm text-amber-800 dark:text-amber-600">
                  pause</button>
              </Tooltip>
            {:else}
              <Tooltip text="Play through stored progress events">
                <button type="button" onclick={startReplayPlay} aria-label="Play replay"
                  class="material-symbols-outlined text-sm text-outline hover:text-primary bg-transparent border-0 cursor-pointer p-0.5">play_arrow</button>
              </Tooltip>
            {/if}
            <Tooltip text="Next stored ReasoningIterationProgress boundary">
              <span class="inline-flex">
                <button type="button" onclick={stepForward} disabled={replayLoopIndex >= replayMaxLoops}
                  aria-label="Next stored progress event"
                  class="material-symbols-outlined text-sm text-outline hover:text-primary disabled:opacity-30 bg-transparent border-0 cursor-pointer p-0.5">skip_next</button>
              </span>
            </Tooltip>
            <Tooltip text="Exit replay mode">
              <button type="button" onclick={exitReplay} aria-label="Exit replay"
                class="material-symbols-outlined text-sm text-outline hover:text-error bg-transparent border-0 cursor-pointer p-0.5">close</button>
            </Tooltip>
        </div>
      </div>
    {:else if $runStore.status !== "live" && replayMaxLoops > 0}
      <Tooltip text={replayEnterButtonTooltip} class="min-w-0 max-w-[min(100%,280px)]">
        <button
          type="button"
          onclick={enterReplay}
          aria-label="Replay stored progress events"
          class="flex cursor-pointer items-center gap-1 rounded-md border border-outline-variant/20 bg-surface-container-low/40 px-2 py-1 text-[9px] uppercase text-outline transition-colors hover:border-amber-500/35 hover:bg-amber-100/50 hover:text-amber-900 dark:hover:border-amber-800/45 dark:hover:bg-amber-950/30 dark:hover:text-amber-600"
        >
          <span class="material-symbols-outlined text-[12px]">replay</span>
          Replay ({replayMaxLoops} events)
        </button>
      </Tooltip>
    {/if}

    <div class="flex-1 min-w-[8px]"></div>

    <!-- Export buttons -->
    <div
      class="inline-flex items-center rounded-lg border border-[var(--cortex-border)] bg-surface-container-low/45 p-0.5 gap-0.5 shrink-0"
    >
      <Tooltip text="Download run + events as JSON">
        <button
          type="button"
          onclick={exportJSON}
          aria-label="Download as JSON"
          class="flex items-center justify-center w-8 h-8 rounded-md text-outline hover:text-primary hover:bg-primary/10 transition-colors bg-transparent border-0 cursor-pointer"
        >
          <span class="material-symbols-outlined text-lg">download</span>
        </button>
      </Tooltip>
      <Tooltip text="Copy final answer (markdown), else debrief or trace export">
        <button
          type="button"
          onclick={copyMarkdown}
          aria-label="Copy as Markdown"
          class="flex items-center justify-center w-8 h-8 rounded-md text-outline hover:text-primary hover:bg-primary/10 transition-colors bg-transparent border-0 cursor-pointer"
        >
          <span class="material-symbols-outlined text-lg">content_copy</span>
        </button>
      </Tooltip>
    </div>
  </nav>

  <!-- Vitals strip -->
  <VitalsStrip
    vitals={$runStore.vitals}
    status={$runStore.status}
    {runId}
    replayLoopIndex={replayLoopIndex}
    replayMaxLoops={replayMaxLoops}
    replayPlaying={replayPlaying}
  />

  <RunFinalDeliverable
    status={$runStore.status}
    deliverableText={finalDeliverableText}
    streamText={$runStore.streamText}
    failureMessage={failurePrimaryMessage}
    meta={finalDeliverableMeta}
  />

  <!-- ── Main content: TRACE + SUMMARY (desk shell) ── -->
  <div class="flex-1 min-h-0 overflow-hidden px-3 sm:px-4 py-2">
    <div
      class="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-outline-variant/15 bg-surface-container-low/30 backdrop-blur-[6px] shadow-[inset_0_1px_0_rgba(0,0,0,0.05)] dark:bg-surface-container-low/22 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
    >
      <div
        class="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[minmax(0,1.2fr)_minmax(260px,0.88fr)] gap-3 md:gap-0 md:divide-x md:divide-outline-variant/12 p-2 sm:p-3 overflow-hidden"
      >
    <!-- Left: Execution Trace — the primary view -->
    <section class="min-h-0 overflow-hidden flex flex-col md:pr-3">
      {#if $runStore.status === "failed"}
        <!-- Error banner when run failed -->
        {@const errorEvents = $runStore.events.filter(
          (e) => e.type === "TaskFailed" || (e.type === "AgentCompleted" && e.payload.success === false),
        )}
        <div
          class="flex-shrink-0 mb-2 bg-error/8 border border-error/30 rounded-lg p-3 shadow-[inset_0_0_0_1px_rgba(239,68,68,0.08)]"
        >
          <div class="flex items-center gap-2 mb-1.5">
            <span class="material-symbols-outlined text-error text-sm" style="font-variation-settings: 'FILL' 1;">error</span>
            <span class="font-display text-[11px] text-error uppercase tracking-[0.12em] font-semibold">Run failed</span>
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

    <!-- Right: Summary panel -->
    <section class="min-h-0 overflow-hidden flex flex-col md:pl-3 pt-2 md:pt-0">
      <RunOverview
        vitals={$runStore.vitals}
        status={$runStore.status}
        signal={$signalStore}
        debrief={$runStore.debrief}
        eventCount={$runStore.events.length}
      />
    </section>
      </div>
    </div>
  </div>

  <!-- ── Footer: segmented tabs + actions (desk chrome) ─────────────────── -->
  <footer
    class="flex-shrink-0 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between px-3 sm:px-4 py-2 border-t border-[var(--cortex-border)] bg-surface-container-low/75 dark:bg-surface-container-low/55 backdrop-blur-xl"
  >
    <div
      class="cortex-no-scrollbar flex items-center gap-0.5 overflow-x-auto rounded-lg border border-[var(--cortex-border)] bg-surface-container-low/45 dark:bg-surface-container-low/35 p-0.5 min-w-0 flex-1"
    >
      {#each [
        { id: "decisions", label: "Decisions",    icon: "analytics"    },
        { id: "memory",    label: "Memory",       icon: "account_tree" },
        { id: "context",   label: "Context",      icon: "data_usage"   },
        { id: "debrief",   label: "Debrief",      icon: "summarize",
          dot: !!$runStore.debrief },
        { id: "signal",    label: "Signal",       icon: "show_chart"   },
        { id: "events",    label: "Events",       icon: "terminal"     },
        { id: "messages",  label: "Messages",     icon: "chat_bubble"  },
        { id: "chat",      label: "Chat",         icon: "forum"        },
      ] as tab (tab.id)}
        <button
          type="button"
          class="flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 sm:px-2.5 py-1.5 text-[10px] font-mono uppercase tracking-wide border-0 cursor-pointer transition-colors duration-150 shrink-0
                 {bottomTab === tab.id
            ? 'bg-primary/14 text-primary shadow-[inset_0_0_0_1px_rgba(139,92,246,0.28)]'
            : 'text-outline hover:text-on-surface hover:bg-surface-container-high/60 bg-transparent'}"
          onclick={() => {
            bottomTab = tab.id as typeof bottomTab;
            if (panelMinimized) panelMinimized = false;
          }}
        >
          <span class="relative inline-flex items-center shrink-0">
            <span class="material-symbols-outlined text-[16px] opacity-90">{tab.icon}</span>
            {#if (tab as { dot?: boolean }).dot}
              <span class="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-secondary ring-1 ring-surface-container-low"></span>
            {/if}
          </span>
          <span class="hidden sm:inline">{tab.label}</span>
          {#if tab.id === "messages" && cortexMessageCount > 0}
            <span
              class="shrink-0 min-h-[18px] min-w-[20px] px-1.5 py-0.5 rounded-md
                     bg-surface-container-lowest/80 border border-primary/40 text-[9px] font-mono font-semibold tabular-nums
                     text-primary leading-none flex items-center justify-center"
              title={`${cortexMessageCount} message row(s) from ReasoningStepCompleted`}
            >{cortexMessageCount > 99 ? "99+" : String(cortexMessageCount)}</span>
          {/if}
        </button>
      {/each}
    </div>

    <div class="flex flex-wrap items-center justify-end gap-1.5 shrink-0">
      {#if $runStore.status === "live"}
        <button
          type="button"
          class="px-3 py-1.5 border border-primary/35 text-primary font-mono text-[10px] uppercase
                 rounded-md bg-primary/5 cursor-pointer hover:bg-primary/12 transition-colors"
          onclick={() => void runStore.pause()}
        >Pause</button>
        <button
          type="button"
          class="px-3 py-1.5 border border-error/40 text-error font-mono text-[10px] uppercase
                 rounded-md bg-error/5 cursor-pointer hover:bg-error/10 transition-colors"
          onclick={() => void runStore.stop()}
        >Stop</button>
      {/if}
      <button
        type="button"
        class="px-3 py-1.5 border border-outline-variant/25 text-outline font-mono text-[10px]
               uppercase rounded-md bg-transparent cursor-pointer hover:text-on-surface hover:border-outline-variant/50
               transition-colors"
        onclick={() => goto("/")}
      >Back</button>
      <button
        type="button"
        disabled={deletingRun}
        class="px-3 py-1.5 border border-error/35 text-error font-mono text-[10px] uppercase
               rounded-md bg-transparent cursor-pointer hover:bg-error/10 transition-colors
               disabled:opacity-40 disabled:cursor-not-allowed"
        onclick={() => (showDeleteConfirm = true)}
      >{deletingRun ? "…" : "Delete"}</button>
    </div>
  </footer>

  <!-- ── Resizable bottom panel ─────────────────────────────────────────── -->
  <div
    class="flex-shrink-0 flex flex-col border-t border-[var(--cortex-border)] bg-surface-container-lowest/55 dark:bg-surface-container-lowest/45 backdrop-blur-sm transition-none"
    style="height: {panelMinimized ? '0px' : panelHeight + 'px'}; overflow: {panelMinimized ? 'hidden' : 'visible'};"
  >
    <!-- Drag handle row — resize + minimize control -->
    <div class="group relative flex h-6 flex-shrink-0 items-center border-b border-[var(--cortex-border)]">
      <!-- Draggable zone uses role=separator which is interactive -->
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <div
        class="flex-1 h-full cursor-ns-resize flex items-center justify-center
               hover:bg-primary/10 transition-colors {isDragging ? 'bg-primary/15' : ''}"
        onmousedown={startResize}
        ontouchstart={startResize}
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize panel"
      >
        <div
          class="w-10 h-0.5 rounded-full bg-on-surface/12 dark:bg-on-surface/20 group-hover:bg-primary/45 transition-colors"
        ></div>
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
        <MemoryPanel events={panelEvents($runStore.events)} agentId={$runStore.agentId} />
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
      {:else if bottomTab === "events"}
        <RawEventLog events={panelEvents($runStore.events)} />
      {:else if bottomTab === "messages"}
        <MessagesPanel {runId} />
      {:else if bottomTab === "chat"}
        <RunChatTab
          {runId}
          provider={$runStore.vitals.provider}
          model={$runStore.vitals.model}
        />
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
