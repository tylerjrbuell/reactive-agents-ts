<script lang="ts">
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { CORTEX_SERVER_URL } from "$lib/constants.js";
  import ConfirmModal from "$lib/components/ConfirmModal.svelte";
  import { toast } from "$lib/stores/toast-store.js";

  type RunRow = {
    runId: string;
    agentId: string;
    startedAt: number;
    completedAt?: number;
    status: string;
    iterationCount: number;
    tokensUsed: number;
    cost: number;
    hasDebrief: boolean;
    provider?: string;
    model?: string;
    strategy?: string;
  };

  let runs = $state<RunRow[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let searchText = $state("");
  let statusFilter = $state<"all" | "live" | "completed" | "failed">("all");

  // ── Selection + bulk delete ──────────────────────────────────────────
  let selected = $state(new Set<string>());
  let showBulkDeleteConfirm = $state(false);
  let bulkDeleting = $state(false);

  function toggleSelect(runId: string, e: MouseEvent) {
    e.stopPropagation();
    const next = new Set(selected);
    if (next.has(runId)) next.delete(runId); else next.add(runId);
    selected = next;
  }

  function toggleSelectAll() {
    if (selected.size === filtered.length) {
      selected = new Set();
    } else {
      selected = new Set(filtered.map((r) => r.runId));
    }
  }

  async function bulkDelete() {
    showBulkDeleteConfirm = false;
    bulkDeleting = true;
    const ids = [...selected];
    let deleted = 0;
    for (const id of ids) {
      try {
        const res = await fetch(`${CORTEX_SERVER_URL}/api/runs/${encodeURIComponent(id)}`, { method: "DELETE" });
        if (res.ok) { deleted++; runs = runs.filter((r) => r.runId !== id); }
      } catch { /* ignore individual failures */ }
    }
    selected = new Set();
    bulkDeleting = false;
    toast.success(`Deleted ${deleted} run${deleted !== 1 ? "s" : ""}`);
  }

  // ── Pin (localStorage) ───────────────────────────────────────────────
  const PINS_KEY = "cortex-pinned-runs";
  let pinned = $state(new Set<string>());

  function loadPins() {
    try {
      const raw = localStorage.getItem(PINS_KEY);
      pinned = raw ? new Set(JSON.parse(raw) as string[]) : new Set();
    } catch { pinned = new Set(); }
  }

  function togglePin(runId: string, e: MouseEvent) {
    e.stopPropagation();
    const next = new Set(pinned);
    if (next.has(runId)) next.delete(runId); else next.add(runId);
    pinned = next;
    localStorage.setItem(PINS_KEY, JSON.stringify([...pinned]));
  }

  onMount(async () => {
    loadPins();
    try {
      const res = await fetch(`${CORTEX_SERVER_URL}/api/runs?limit=100`);
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      runs = await res.json();
    } catch (e) {
      error = String(e);
    } finally {
      loading = false;
    }
  });

  const filtered = $derived(
    runs
      .filter((r) => {
        const matchSearch =
          !searchText.trim() ||
          r.runId.toLowerCase().includes(searchText.toLowerCase()) ||
          r.agentId.toLowerCase().includes(searchText.toLowerCase()) ||
          (r.provider ?? "").toLowerCase().includes(searchText.toLowerCase()) ||
          (r.model ?? "").toLowerCase().includes(searchText.toLowerCase());
        const matchStatus = statusFilter === "all" || r.status === statusFilter;
        return matchSearch && matchStatus;
      })
      // Pinned runs float to top
      .sort((a, b) => {
        const ap = pinned.has(a.runId) ? 1 : 0;
        const bp = pinned.has(b.runId) ? 1 : 0;
        return bp - ap || b.startedAt - a.startedAt;
      }),
  );

  function statusIcon(s: string): string {
    if (s === "completed") return "check_circle";
    if (s === "failed") return "error";
    if (s === "live") return "radio_button_checked";
    return "schedule";
  }

  function statusClass(s: string): string {
    if (s === "completed") return "text-secondary";
    if (s === "failed") return "text-error";
    if (s === "live") return "text-primary";
    return "text-outline";
  }

  function durationStr(row: RunRow): string {
    if (!row.completedAt) return "—";
    const ms = row.completedAt - row.startedAt;
    return ms < 1000 ? `${ms}ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms / 60000)}m`;
  }

  function relativeTime(ts: number): string {
    const diff = Date.now() - ts;
    if (diff < 60000) return "just now";
    if (diff < 3600000) return `${Math.round(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.round(diff / 3600000)}h ago`;
    return `${Math.round(diff / 86400000)}d ago`;
  }

  const stats = $derived({
    total: runs.length,
    completed: runs.filter((r) => r.status === "completed").length,
    failed: runs.filter((r) => r.status === "failed").length,
    live: runs.filter((r) => r.status === "live").length,
    totalTokens: runs.reduce((s, r) => s + r.tokensUsed, 0),
    totalCost: runs.reduce((s, r) => s + (r.cost ?? 0), 0),
  });

  const allFilteredSelected = $derived(
    filtered.length > 0 && filtered.every((r) => selected.has(r.runId)),
  );
</script>

<svelte:head>
  <title>CORTEX — Run History</title>
</svelte:head>

<div class="h-full flex flex-col overflow-hidden p-6 gap-4">
  <!-- Header -->
  <div class="flex items-center justify-between flex-shrink-0">
    <div>
      <h1 class="font-headline text-2xl font-light text-on-surface">
        Run <span class="font-bold text-primary">History</span>
      </h1>
      {#if !loading && !error}
        <p class="font-mono text-[10px] text-outline mt-0.5">
          {stats.total} runs · {stats.completed} done · {stats.failed} failed
          {#if stats.live > 0}· <span class="text-primary">{stats.live} live</span>{/if}
          · {stats.totalTokens.toLocaleString()} tok · ${stats.totalCost.toFixed(4)}
        </p>
      {/if}
    </div>
    <a href="/" class="text-[11px] font-mono text-secondary hover:text-primary transition-colors no-underline flex items-center gap-1">
      <span class="material-symbols-outlined text-sm">arrow_back</span> Stage
    </a>
  </div>

  <!-- Filter bar -->
  <div class="flex items-center gap-3 flex-shrink-0">
    <div class="flex-1 flex items-center gap-2 bg-surface-container-low rounded-lg px-3 py-2 border border-outline-variant/10">
      <span class="material-symbols-outlined text-sm text-outline/50">search</span>
      <input type="text" bind:value={searchText} placeholder="Search run ID, agent, provider, model…"
        class="flex-1 bg-transparent border-none outline-none text-sm font-mono text-on-surface placeholder:text-outline/40" />
      {#if searchText}
        <button type="button" onclick={() => (searchText = "")}
          class="material-symbols-outlined text-sm text-outline hover:text-primary bg-transparent border-0 cursor-pointer">
          close</button>
      {/if}
    </div>
    <div class="flex gap-1">
      {#each [["all","All"],["live","Live"],["completed","Done"],["failed","Failed"]] as [val, label]}
        <button type="button"
          class="px-3 py-1.5 text-[10px] font-mono rounded border transition-colors
                 {statusFilter === val ? 'bg-primary/10 border-primary/30 text-primary' : 'border-outline-variant/20 text-outline hover:border-primary/20 hover:text-primary'}"
          onclick={() => (statusFilter = val as typeof statusFilter)}>
          {label}</button>
      {/each}
    </div>
  </div>

  <!-- Run list with select-all header -->
  <div class="flex-1 overflow-y-auto min-h-0 space-y-0.5">
    {#if loading}
      <div class="flex items-center justify-center h-32">
        <span class="material-symbols-outlined text-primary animate-spin text-2xl">progress_activity</span>
      </div>
    {:else if error}
      <div class="text-center mt-8">
        <p class="font-mono text-sm text-error">{error}</p>
      </div>
    {:else if filtered.length === 0}
      <p class="font-mono text-xs text-outline text-center mt-8">
        {searchText || statusFilter !== "all" ? "No runs match the filter." : "No runs yet."}
      </p>
    {:else}
      <!-- Select-all header (visible when any run is selected or on hover) -->
      {#if selected.size > 0}
        <div class="flex items-center gap-3 px-4 py-2 bg-primary/5 border border-primary/15 rounded-lg mb-1 text-[10px] font-mono">
          <input type="checkbox" checked={allFilteredSelected} onchange={toggleSelectAll}
            class="accent-primary w-3.5 h-3.5 cursor-pointer" />
          <span class="text-primary">{selected.size} selected</span>
          <div class="flex-1"></div>
          <button type="button" onclick={() => (showBulkDeleteConfirm = true)} disabled={bulkDeleting}
            class="flex items-center gap-1.5 px-3 py-1 border border-error/30 text-error rounded
                   hover:bg-error/10 transition-colors bg-transparent cursor-pointer disabled:opacity-40">
            <span class="material-symbols-outlined text-sm">delete_sweep</span>
            Delete {selected.size}
          </button>
          <button type="button" onclick={() => (selected = new Set())}
            class="text-outline hover:text-primary bg-transparent border-0 cursor-pointer">
            Clear</button>
        </div>
      {/if}

      {#each filtered as run (run.runId)}
        {@const isPinned = pinned.has(run.runId)}
        {@const isSelected = selected.has(run.runId)}
        <button
          type="button"
          class="w-full text-left flex items-center gap-3 px-4 py-3 rounded-lg border cursor-pointer transition-all group bg-transparent
                 {isSelected
                   ? 'bg-primary/8 border-primary/25'
                   : isPinned
                     ? 'bg-surface-container-low/60 border-primary/15 hover:border-primary/25'
                     : 'bg-surface-container-low/40 border-outline-variant/10 hover:border-primary/20 hover:bg-surface-container-low/70'}"
          onclick={() => goto(`/run/${run.runId}`)}
        >
          <!-- Checkbox col — span with role=button to avoid nested button -->
          <span role="button" tabindex="0"
            class="flex-shrink-0 w-5 flex items-center justify-center cursor-pointer"
            onclick={(e) => toggleSelect(run.runId, e)}
            onkeydown={(e) => e.key === "Enter" && toggleSelect(run.runId, e as any)}>
            {#if isSelected || selected.size > 0}
              <input type="checkbox" checked={isSelected} onchange={() => {}}
                class="accent-primary w-3.5 h-3.5 cursor-pointer" />
            {:else}
              <span class="material-symbols-outlined text-sm text-outline/0 group-hover:text-outline/40 transition-colors"
                style="font-variation-settings: 'FILL' 1;">
                {statusIcon(run.status)}</span>
            {/if}
          </span>

          <!-- Status icon (when no checkbox) -->
          {#if !isSelected && selected.size === 0}
            <span class="material-symbols-outlined text-base flex-shrink-0 {statusClass(run.status)}"
              style="font-variation-settings: 'FILL' {run.status === 'live' ? '0' : '1'};"
              title={run.status}>
              {statusIcon(run.status)}</span>
          {/if}

          <!-- Run info -->
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              {#if isPinned}
                <span class="material-symbols-outlined text-[11px] text-primary/60"
                  style="font-variation-settings: 'FILL' 1;">push_pin</span>
              {/if}
              <span class="font-mono text-[11px] text-on-surface/80 truncate" title={run.runId}>
                {run.runId.slice(0, 12)}…</span>
              {#if run.hasDebrief}
                <span class="text-[9px] font-mono text-secondary/60 bg-secondary/10 px-1 rounded">debrief</span>
              {/if}
              {#if run.status === "live"}
                <span class="text-[9px] font-mono text-primary animate-pulse">● LIVE</span>
              {/if}
            </div>
            <div class="flex items-center gap-2 mt-0.5">
              <span class="font-mono text-[9px] text-outline/40 truncate" title={run.agentId}>{run.agentId}</span>
              {#if run.provider}
                <span class="font-mono text-[9px] text-outline/30">·</span>
                <span class="font-mono text-[9px] text-primary/50">{run.provider}</span>
              {/if}
              {#if run.model}
                <span class="font-mono text-[9px] text-outline/30">·</span>
                <span class="font-mono text-[9px] text-primary/40 truncate max-w-[120px]">{run.model}</span>
              {/if}
            </div>
          </div>

          <!-- Metrics -->
          <div class="hidden md:flex items-center gap-4 font-mono text-[10px] text-outline/60 flex-shrink-0">
            <span>{run.iterationCount} iter</span>
            <span>{run.tokensUsed.toLocaleString()}t</span>
            <span>${(run.cost ?? 0).toFixed(4)}</span>
            <span class="w-12 text-right">{durationStr(run)}</span>
          </div>

          <!-- Time + pin + arrow -->
          <div class="flex items-center gap-2 flex-shrink-0">
            <span class="font-mono text-[10px] text-outline/40 w-16 text-right">{relativeTime(run.startedAt)}</span>
            <!-- Pin toggle — span/role=button (nested button not allowed) -->
            <span role="button" tabindex="0"
              class="material-symbols-outlined text-sm transition-colors cursor-pointer
                     {isPinned ? 'text-primary/60 hover:text-primary' : 'text-outline/0 group-hover:text-outline/30 hover:text-primary'}"
              style="font-variation-settings: 'FILL' {isPinned ? '1' : '0'};"
              title={isPinned ? "Unpin" : "Pin"}
              onclick={(e) => togglePin(run.runId, e)}
              onkeydown={(e) => e.key === "Enter" && togglePin(run.runId, e as any)}
            >push_pin</span>
            <span class="material-symbols-outlined text-sm text-outline/20 group-hover:text-primary/40 transition-colors">
              chevron_right</span>
          </div>
        </button>
      {/each}
    {/if}
  </div>
</div>

{#if showBulkDeleteConfirm}
  <ConfirmModal
    title="Delete {selected.size} run{selected.size !== 1 ? 's' : ''}"
    message="This permanently deletes {selected.size} run{selected.size !== 1 ? 's' : ''} and all their events. This cannot be undone."
    confirmLabel="Delete all"
    onConfirm={bulkDelete}
    onCancel={() => (showBulkDeleteConfirm = false)}
  />
{/if}
