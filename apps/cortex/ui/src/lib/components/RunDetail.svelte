<script lang="ts">
  import { getContext } from "svelte";
  import { onDestroy } from "svelte";
  import { goto } from "$app/navigation";
  import VitalsStrip from "$lib/components/VitalsStrip.svelte";
  import SignalMonitor from "$lib/components/SignalMonitor.svelte";
  import TracePanel from "$lib/components/TracePanel.svelte";
  import DecisionLog from "$lib/components/DecisionLog.svelte";
  import MemoryPanel from "$lib/components/MemoryPanel.svelte";
  import ContextGauge from "$lib/components/ContextGauge.svelte";
  import DebriefCard from "$lib/components/DebriefCard.svelte";
  import ReplayControls from "$lib/components/ReplayControls.svelte";
  import RawEventLog from "$lib/components/RawEventLog.svelte";
  import { createRunStore } from "$lib/stores/run-store.js";
  import { createSignalStore } from "$lib/stores/signal-store.js";
  import { createTraceStore } from "$lib/stores/trace-store.js";
  import type { CortexLiveMsg } from "$lib/stores/run-store.js";
  import type { AgentStore } from "$lib/stores/agent-store.js";

  interface Props {
    runId: string;
  }
  let { runId }: Props = $props();

  /* #key on parent remounts this component when runId changes — one store per mount. */
  // svelte-ignore state_referenced_locally
  const runStore = createRunStore(runId);
  const agentStore = getContext<AgentStore>("agentStore");
  const signalStore = createSignalStore(runStore);
  const traceStore = createTraceStore(runStore);

  let selectedIteration = $state<number | null>(null);
  let bottomTab = $state<"decisions" | "memory" | "context" | "events">("decisions");
  let deletingRun = $state(false);

  function panelEvents(msgs: CortexLiveMsg[]): Array<{ type: string; payload: Record<string, unknown>; ts: number }> {
    return msgs.map((m) => ({ type: m.type, payload: m.payload, ts: m.ts }));
  }

  async function handleDeleteRun() {
    if (deletingRun) return;
    const ok = globalThis.confirm(`Delete run ${runId.slice(0, 8)}…? This also removes its events.`);
    if (!ok) return;
    deletingRun = true;
    try {
      const deleted = await runStore.deleteRun();
      if (deleted) {
        await agentStore.refresh();
        await goto("/");
      }
    } finally {
      deletingRun = false;
    }
  }

  onDestroy(() => runStore.destroy());
</script>

<svelte:head>
  <title>CORTEX — Run {runId.slice(0, 8)}</title>
</svelte:head>

<div class="flex flex-col h-full overflow-hidden min-h-0">
  <nav
    class="flex-shrink-0 px-4 py-2 border-b border-white/5 flex items-center gap-2 text-[10px] font-mono text-outline"
  >
    <a href="/" class="text-secondary hover:text-primary no-underline">Stage</a>
    <span class="text-on-surface/30">/</span>
    <span class="text-on-surface truncate max-w-[200px]" title={runId}>{runId}</span>
    {#if $runStore.isChat}
      <span class="ml-2 px-1.5 py-0.5 rounded border border-primary/30 text-primary text-[9px]">CHAT</span>
    {/if}
    <div class="flex-1"></div>
    <ReplayControls status={$runStore.status} />
  </nav>

  <VitalsStrip vitals={$runStore.vitals} status={$runStore.status} {runId} />

  <div class="flex-1 grid grid-cols-1 md:grid-cols-[65%_35%] gap-4 p-4 overflow-hidden min-h-0">
    <section class="flex flex-col gap-4 overflow-hidden min-h-0">
      <!-- Failed run error panel — shown prominently when run failed -->
      {#if $runStore.status === "failed"}
        {@const errorEvents = $runStore.events.filter(
          (e) => e.type === "TaskFailed" || e.type === "AgentCompleted" && e.payload.success === false,
        )}
        <div class="flex-shrink-0 gradient-border rounded-lg p-4 border-error/40 bg-error/5">
          <div class="flex items-center gap-2 mb-3">
            <span class="material-symbols-outlined text-error text-sm">error</span>
            <span class="font-mono text-xs text-error uppercase tracking-widest font-bold">Run Failed</span>
          </div>
          {#each errorEvents as ev}
            {@const msg = typeof ev.payload.error === "string"
              ? ev.payload.error
              : typeof ev.payload.reason === "string"
                ? ev.payload.reason
                : "Agent terminated with failure"}
            <p class="font-mono text-[11px] text-error/80 leading-relaxed bg-error/10 rounded p-2 border border-error/20">
              {msg}
            </p>
          {/each}
          {#if errorEvents.length === 0}
            <p class="font-mono text-[11px] text-error/60">
              The run failed without a captured error message. Check the trace and signal monitor for the last state.
            </p>
          {/if}
        </div>
      {/if}

      <div class="flex-1 min-h-[280px] overflow-hidden">
        <SignalMonitor
          data={$signalStore}
          onselectIteration={(n) => {
            selectedIteration = n;
            signalStore.selectIteration(n);
          }}
        />
      </div>

      {#if $runStore.debrief}
        <div class="flex-shrink-0 max-h-64 overflow-y-auto">
          <DebriefCard debrief={$runStore.debrief} />
        </div>
      {/if}
    </section>

    <section class="min-h-0 overflow-hidden flex flex-col">
      <TracePanel
        frames={$traceStore}
        status={$runStore.status}
        frame={selectedIteration === null
          ? $traceStore[$traceStore.length - 1] ?? null
          : ($traceStore.find((f) => f.iteration === selectedIteration) ?? null)}
      />
    </section>
  </div>

  <footer
    class="bg-[#111317]/80 backdrop-blur-md flex justify-between items-center px-6 flex-shrink-0 border-t border-primary/10 h-14"
  >
    <div class="flex items-center h-full">
      {#each [{ id: "decisions", label: "Decisions", icon: "analytics" }, { id: "memory", label: "Memory", icon: "account_tree" }, { id: "context", label: "Context", icon: "data_usage" }, { id: "events", label: "Raw Events", icon: "terminal" }] as tab (tab.id)}
        <button
          type="button"
          class="flex flex-col items-center justify-center px-5 h-full transition-all duration-200 font-mono text-[10px] uppercase tracking-wider border-0 bg-transparent cursor-pointer {bottomTab ===
          tab.id
            ? 'text-primary border-t-2 border-primary bg-primary/5 -mt-0.5'
            : 'text-outline hover:bg-white/5 hover:text-secondary'}"
          onclick={() => (bottomTab = tab.id as typeof bottomTab)}
        >
          <span class="material-symbols-outlined text-sm mb-0.5">{tab.icon}</span>
          {tab.label}
        </button>
      {/each}
    </div>

    <div class="flex items-center gap-3">
      {#if $runStore.status === "live"}
        <button
          type="button"
          class="px-5 py-1.5 border border-primary/20 text-primary font-mono text-xs uppercase hover:bg-primary/10 transition-colors rounded bg-transparent cursor-pointer"
          onclick={() => void runStore.pause()}
        >
          Pause
        </button>
        <button
          type="button"
          class="px-5 py-1.5 border border-error/20 text-error font-mono text-xs uppercase hover:bg-error/10 transition-colors rounded bg-transparent cursor-pointer"
          onclick={() => void runStore.stop()}
        >
          Stop
        </button>
      {/if}
      <button
        type="button"
        class="px-4 py-1.5 border border-outline-variant/20 text-outline font-mono text-xs uppercase rounded bg-transparent cursor-pointer hover:text-on-surface"
        onclick={() => goto("/")}
      >
        Back
      </button>
      <button
        type="button"
        disabled={deletingRun}
        class="px-4 py-1.5 border border-error/20 text-error font-mono text-xs uppercase rounded bg-transparent cursor-pointer hover:bg-error/10 disabled:opacity-50 disabled:cursor-not-allowed"
        onclick={() => void handleDeleteRun()}
      >
        {deletingRun ? "Deleting…" : "Delete Run"}
      </button>
    </div>
  </footer>

  <div
    class="bg-surface-container-low border-t border-outline-variant/10 overflow-hidden transition-all duration-300 flex-shrink-0
           {bottomTab === 'events' ? 'h-64' : 'h-40'}"
  >
    {#if bottomTab === "decisions"}
      <DecisionLog events={panelEvents($runStore.events)} />
    {:else if bottomTab === "memory"}
      <MemoryPanel events={panelEvents($runStore.events)} />
    {:else if bottomTab === "context"}
      <ContextGauge events={panelEvents($runStore.events)} />
    {:else}
      <RawEventLog events={panelEvents($runStore.events)} />
    {/if}
  </div>
</div>
