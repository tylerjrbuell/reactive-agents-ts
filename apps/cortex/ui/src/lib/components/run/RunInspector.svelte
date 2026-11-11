<script lang="ts">
  /**
   * The run inspector (Bench spec section 8): a 420px tab list beside the
   * trace at ≥1360px, stacked under it below that. Tabs come from
   * `inspectorTabsOf` (Summary, Decisions, Signal, Context, Memory, Messages,
   * Events; no Chat tab). It replaces the old resizable bottom panel.
   */
  import Tabs from "$lib/components/kit/Tabs.svelte";
  import RunOverview from "$lib/components/RunOverview.svelte";
  import RunConfigSnapshot from "$lib/components/RunConfigSnapshot.svelte";
  import DebriefPanel from "$lib/components/DebriefPanel.svelte";
  import DecisionLog from "$lib/components/DecisionLog.svelte";
  import SignalMonitor from "$lib/components/SignalMonitor.svelte";
  import ContextGauge from "$lib/components/ContextGauge.svelte";
  import MemoryPanel from "$lib/components/MemoryPanel.svelte";
  import MessagesPanel from "$lib/components/MessagesPanel.svelte";
  import RawEventLog from "$lib/components/RawEventLog.svelte";
  import { tabPanelId, tabId } from "$lib/tablist.js";
  import { inspectorTabsOf, type InspectorTabId } from "$lib/run-view.js";
  import type { RunStatus, RunVitals } from "$lib/stores/run-store.js";
  import type { SignalData } from "$lib/stores/signal-store.js";

  interface PanelEvent {
    readonly type: string;
    readonly payload: Record<string, unknown>;
    readonly ts: number;
  }

  interface Props {
    tab: InspectorTabId;
    runId: string;
    agentId: string;
    status: RunStatus;
    vitals: RunVitals;
    signal: SignalData;
    entropy: readonly number[];
    debrief: unknown;
    launchParams: Record<string, unknown> | null;
    events: PanelEvent[];
    messageCount: number;
    strategyLabel: (id: string) => string;
    onSelectIteration: (n: number) => void;
  }
  let {
    tab = $bindable(),
    runId,
    agentId,
    status,
    vitals,
    signal,
    entropy,
    debrief,
    launchParams,
    events,
    messageCount,
    strategyLabel,
    onSelectIteration,
  }: Props = $props();

  const ID = "run-insp";
  const tabs = $derived(inspectorTabsOf({ messages: messageCount, events: events.length }));
  /** The Tabs kit reports a plain string id; the list above is the only source of ids. */
  function onchange(id: string) {
    const next = tabs.find((t) => t.id === id);
    if (next) tab = next.id;
  }
</script>

<aside class="insp" aria-label="Run inspector">
  <Tabs items={tabs} value={tab} label="Run inspector" idBase={ID} {onchange} class="insp-tabs" />
  <div class="content" role="tabpanel" id={tabPanelId(ID, tab)} aria-labelledby={tabId(ID, tab)}>
    {#if tab === "summary"}
      <RunOverview {vitals} {status} {signal} {entropy} {strategyLabel} />
      <DebriefPanel {debrief} {status} />
      <RunConfigSnapshot {launchParams} />
    {:else if tab === "decisions"}
      <DecisionLog {events} />
    {:else if tab === "signal"}
      <SignalMonitor data={signal} onselectIteration={onSelectIteration} />
    {:else if tab === "context"}
      <ContextGauge {events} />
    {:else if tab === "memory"}
      <MemoryPanel {events} {agentId} {runId} />
    {:else if tab === "messages"}
      <MessagesPanel {runId} />
    {:else}
      <RawEventLog {events} />
    {/if}
  </div>
</aside>

<style>
  .insp { display: grid; grid-template-rows: auto minmax(0, 1fr); min-height: 0; background: var(--cortex-surface-1); }
  /* Seven tabs do not fit 420px on one row: they wrap, so every tab stays visible (arrow keys still move through all). */
  .insp :global(.insp-tabs) { flex-wrap: wrap; column-gap: 14px; row-gap: 0; padding: 0 16px; overflow: visible; }
  .content { display: grid; gap: 16px; align-content: start; min-height: 0; overflow-y: auto; padding: 16px; }
</style>
