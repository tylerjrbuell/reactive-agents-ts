<script lang="ts">
  /**
   * Runs (Bench spec section 8, `runs.html`): every run Cortex has seen. The
   * page owns the data (REST seed, live broadcast socket, pins, selection);
   * `components/runs/` render it; the rules are pure in `lib/runs-table.ts`.
   */
  import { onDestroy, onMount } from "svelte";
  import { CORTEX_SERVER_URL } from "$lib/constants.js";
  import ConfirmModal from "$lib/components/ConfirmModal.svelte";
  import CortexDeskShell from "$lib/components/CortexDeskShell.svelte";
  import PageHeader from "$lib/components/kit/PageHeader.svelte";
  import Button from "$lib/components/kit/Button.svelte";
  import IconButton from "$lib/components/kit/IconButton.svelte";
  import EmptyState from "$lib/components/kit/EmptyState.svelte";
  import RunsTable from "$lib/components/runs/RunsTable.svelte";
  import RunsToolbar from "$lib/components/runs/RunsToolbar.svelte";
  import WaitingOnYou from "$lib/components/runs/WaitingOnYou.svelte";
  import CrashedRuns from "$lib/components/runs/CrashedRuns.svelte";
  import LoopStoppedRuns from "$lib/components/runs/LoopStoppedRuns.svelte";
  import { toast } from "$lib/stores/toast-store.js";
  import { loadCapabilities, strategyOptions } from "$lib/capabilities.js";
  import { createWsClient } from "$lib/stores/ws-client.js";
  import {
    applyRunLiveMessage,
    filterRuns,
    groupRuns,
    runTotals,
    sortRuns,
    statusCounts,
    type RunLiveMessage,
    type RunRow,
    type RunSort,
    type RunStatusFilter,
  } from "$lib/runs-table.js";
  import { waitingRunsOf, withWaitingStatus } from "$lib/waiting-on-you.js";
  import { compareHref, comparePair } from "$lib/run-compare.js";
  import { pendingApprovals } from "$lib/stores/approval-watcher.js";
  import { pendingInteractions } from "$lib/stores/interaction-watcher.js";

  let runs = $state<readonly RunRow[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let search = $state("");
  let status = $state<RunStatusFilter>("all");
  let sort = $state<RunSort>("started-desc");
  /** Desk runs the framework can continue (any interrupted kind), from the strip above the table. */
  let resumableIds = $state<ReadonlySet<string>>(new Set());
  let now = $state(Date.now());

  // ── Pins (localStorage) ──────────────────────────────────────────────
  const PINS_KEY = "cortex-pinned-runs";
  let pinned = $state<ReadonlySet<string>>(new Set());

  function loadPins() {
    try {
      const raw = localStorage.getItem(PINS_KEY);
      pinned = new Set(raw ? (JSON.parse(raw) as string[]) : []);
    } catch {
      pinned = new Set();
    }
  }

  function togglePin(runId: string) {
    const next = new Set(pinned);
    if (next.has(runId)) next.delete(runId);
    else next.add(runId);
    pinned = next;
    localStorage.setItem(PINS_KEY, JSON.stringify([...next]));
  }

  // ── Selection + bulk delete ──────────────────────────────────────────
  let selected = $state<ReadonlySet<string>>(new Set());
  let showBulkDeleteConfirm = $state(false);
  let bulkDeleting = $state(false);

  function toggleSelect(runId: string) {
    const next = new Set(selected);
    if (next.has(runId)) next.delete(runId);
    else next.add(runId);
    selected = next;
  }

  function toggleSelectAll() {
    const all = view.map((r) => r.runId);
    selected = all.every((id) => selected.has(id)) ? new Set() : new Set(all);
  }

  async function bulkDelete() {
    showBulkDeleteConfirm = false;
    bulkDeleting = true;
    let deleted = 0;
    for (const id of selected) {
      try {
        const res = await fetch(`${CORTEX_SERVER_URL}/api/runs/${encodeURIComponent(id)}`, { method: "DELETE" });
        if (res.ok) {
          deleted++;
          runs = runs.filter((r) => r.runId !== id);
        }
      } catch {
        /* one failed delete does not stop the rest */
      }
    }
    selected = new Set();
    bulkDeleting = false;
    toast.success(`Deleted ${deleted} run${deleted !== 1 ? "s" : ""}`);
  }

  // ── Data ─────────────────────────────────────────────────────────────
  async function fetchRuns() {
    error = null;
    loading = true;
    try {
      const res = await fetch(`${CORTEX_SERVER_URL}/api/runs?limit=100`);
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      runs = (await res.json()) as RunRow[];
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  // Strategy display names from the framework manifest (`reactive` reads `ReAct`); ids show as reported until it loads.
  let strategyLabels = $state<ReadonlyMap<string, string>>(new Map());
  const strategyLabel = (id: string): string => strategyLabels.get(id) ?? id;

  let wsClient: ReturnType<typeof createWsClient> | null = null;
  let wsUnsub: (() => void) | null = null;
  let clock: ReturnType<typeof setInterval> | null = null;

  onMount(() => {
    loadPins();
    void fetchRuns();
    loadCapabilities()
      .then((m) => (strategyLabels = new Map(strategyOptions(m).map((o) => [o.value, o.label]))))
      .catch(() => {
        /* ids stay as reported */
      });
    wsClient = createWsClient("/ws/live/cortex-broadcast");
    wsUnsub = wsClient.onMessage((raw) => {
      runs = applyRunLiveMessage(runs, raw as RunLiveMessage, Date.now());
    });
    // Relative times and live durations tick.
    clock = setInterval(() => (now = Date.now()), 5_000);
  });

  onDestroy(() => {
    wsUnsub?.();
    wsClient?.close();
    if (clock) clearInterval(clock);
  });

  // A run paused on an approval or a question publishes no terminal event, so
  // its stored status stays `live`: show it as "Waiting on you", not Running.
  const shown = $derived(withWaitingStatus(runs, waitingRunsOf(runs, $pendingApprovals, $pendingInteractions)));
  const view = $derived(sortRuns(filterRuns(shown, search, status, resumableIds), sort));
  const groups = $derived(groupRuns(view, pinned));
  const counts = $derived(statusCounts(filterRuns(shown, search, "all"), resumableIds));
  const totals = $derived(runTotals(view));
  const empty = $derived(!loading && !error && runs.length === 0);
  const pair = $derived(comparePair(selected));
</script>

<svelte:head>
  <title>Runs · Cortex</title>
</svelte:head>

<!-- Opaque canvas under the page: the engineering grid shows only on the header band (spec 5.2); the orbs sit above the canvas when empty. -->
<CortexDeskShell ambient={empty} class="bg-canvas">
  <div class="page">
    <div class="wrap">
      <PageHeader title="Runs" description="Every agent run Cortex has seen: chat turns, desk runs and gateway agents.">
        {#snippet actions()}
          <IconButton icon="retry" label="Reload runs" disabled={loading} onclick={() => void fetchRuns()} />
          <Button icon="plus" href="/lab">New run</Button>
        {/snippet}
      </PageHeader>
    </div>

    <div class="wrap body">
      {#if empty}
        <EmptyState hero title="No runs yet" description="Runs appear here as soon as an agent starts: a chat turn, a run from Beacon or the Lab, or any app built with .withCortex().">
          {#snippet actions()}
            <Button variant="primary" icon="chat" href="/chat">Open a chat</Button>
            <Button icon="lab" href="/lab">Build an agent</Button>
          {/snippet}
        </EmptyState>
      {:else}
        <WaitingOnYou {runs} />
        <CrashedRuns />
        <LoopStoppedRuns onChange={(ids) => (resumableIds = ids)} />

        <RunsToolbar bind:search bind:status bind:sort {counts} {totals} />

        {#if selected.size > 0}
          <div class="bulk" role="region" aria-label="Selected runs">
            <span><b>{selected.size}</b> selected</span>
            <Button size="sm" icon="steps" disabled={pair === null} title={pair === null ? "Select exactly two runs to compare" : undefined} href={pair ? compareHref(pair[0], pair[1]) : undefined}>Compare</Button>
            <Button size="sm" variant="danger" icon="trash" disabled={bulkDeleting} onclick={() => (showBulkDeleteConfirm = true)}>Delete</Button>
            <Button size="sm" variant="ghost" onclick={() => (selected = new Set())}>Clear selection</Button>
          </div>
        {/if}

        {#if loading && runs.length === 0}
          <p class="note" role="status">Loading runs…</p>
        {:else if error}
          <div class="note err" role="alert">
            <span>Could not load runs: {error}</span>
            <Button size="sm" onclick={() => void fetchRuns()}>Retry</Button>
          </div>
        {:else if view.length === 0}
          <EmptyState icon="filter" title="No runs match" description="Change the search or pick another status.">
            {#snippet actions()}
              <Button size="sm" onclick={() => { search = ""; status = "all"; }}>Clear filters</Button>
            {/snippet}
          </EmptyState>
        {:else}
          <RunsTable
            pinned={groups.pinned}
            recent={groups.recent}
            pinnedIds={pinned}
            {selected}
            {now}
            {strategyLabel}
            onToggleSelect={toggleSelect}
            onToggleSelectAll={toggleSelectAll}
            onTogglePin={togglePin}
          />
        {/if}
      {/if}
    </div>
  </div>
</CortexDeskShell>

{#if showBulkDeleteConfirm}
  <ConfirmModal
    title="Delete {selected.size} run{selected.size !== 1 ? 's' : ''}"
    message="This permanently deletes {selected.size} run{selected.size !== 1 ? 's' : ''} and all their events. This cannot be undone."
    confirmLabel="Delete all"
    onConfirm={bulkDelete}
    onCancel={() => (showBulkDeleteConfirm = false)}
  />
{/if}

<style>
  .page { position: relative; z-index: 1; height: 100%; min-height: 0; overflow-y: auto; }  .wrap { max-width: 1280px; margin: 0 auto; }
  .body { display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; padding: 0 32px 48px; }
  .bulk {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    border-radius: var(--cortex-r-ctl);
    background: var(--cortex-surface-2);
    font-size: var(--cortex-t-xs);
    color: var(--cortex-text-2);
  }
  .bulk b { font-family: var(--cortex-font-data); color: var(--cortex-text); }
  .note { margin: 24px 0; text-align: center; font-size: var(--cortex-t-sm); color: var(--cortex-text-2); }
  .err { display: flex; justify-content: center; align-items: center; gap: 12px; color: var(--cortex-bad); }
</style>
