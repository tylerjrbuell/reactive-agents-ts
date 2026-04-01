<script lang="ts">
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { CORTEX_SERVER_URL } from "$lib/constants.js";

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
    debrief?: string | null;
  };

  let runs = $state<RunRow[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let searchText = $state("");
  let statusFilter = $state<"all" | "live" | "completed" | "failed">("all");

  onMount(async () => {
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
    runs.filter((r) => {
      const matchSearch =
        !searchText.trim() ||
        r.runId.toLowerCase().includes(searchText.toLowerCase()) ||
        r.agentId.toLowerCase().includes(searchText.toLowerCase());
      const matchStatus = statusFilter === "all" || r.status === statusFilter;
      return matchSearch && matchStatus;
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
          {stats.total} runs · {stats.completed} completed · {stats.failed} failed
          {#if stats.live > 0}· <span class="text-primary">{stats.live} live</span>{/if}
          · {stats.totalTokens.toLocaleString()} tokens · ${stats.totalCost.toFixed(4)} total
        </p>
      {/if}
    </div>
    <a
      href="/"
      class="text-[11px] font-mono text-secondary hover:text-primary transition-colors no-underline flex items-center gap-1"
    >
      <span class="material-symbols-outlined text-sm">arrow_back</span>
      Stage
    </a>
  </div>

  <!-- Filter bar -->
  <div class="flex items-center gap-3 flex-shrink-0">
    <div class="flex-1 flex items-center gap-2 bg-surface-container-low rounded-lg px-3 py-2 border border-outline-variant/10">
      <span class="material-symbols-outlined text-sm text-outline/50">search</span>
      <input
        type="text"
        bind:value={searchText}
        placeholder="Search by run ID or agent ID…"
        class="flex-1 bg-transparent border-none outline-none text-sm font-mono text-on-surface placeholder:text-outline/40"
      />
    </div>
    <div class="flex gap-1">
      {#each [["all", "All"], ["live", "Live"], ["completed", "Done"], ["failed", "Failed"]] as [val, label]}
        <button
          type="button"
          class="px-3 py-1.5 text-[10px] font-mono rounded border transition-colors
                 {statusFilter === val
                   ? 'bg-primary/10 border-primary/30 text-primary'
                   : 'border-outline-variant/20 text-outline hover:border-primary/20 hover:text-primary'}"
          onclick={() => (statusFilter = val as typeof statusFilter)}
        >
          {label}
        </button>
      {/each}
    </div>
  </div>

  <!-- Run list -->
  <div class="flex-1 overflow-y-auto min-h-0 space-y-1">
    {#if loading}
      <div class="flex items-center justify-center h-32">
        <span class="material-symbols-outlined text-primary animate-spin text-2xl">progress_activity</span>
      </div>
    {:else if error}
      <div class="text-center mt-8">
        <p class="font-mono text-sm text-error">{error}</p>
        <p class="font-mono text-xs text-outline mt-2">Is the Cortex server running?</p>
      </div>
    {:else if filtered.length === 0}
      <div class="text-center mt-8">
        <p class="font-mono text-xs text-outline">
          {searchText || statusFilter !== "all" ? "No runs match the filter." : "No runs yet."}
        </p>
      </div>
    {:else}
      {#each filtered as run (run.runId)}
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <!-- svelte-ignore a11y-no-static-element-interactions -->
        <div
          class="flex items-center gap-4 px-4 py-3 rounded-lg bg-surface-container-low/40
                 border border-outline-variant/10 hover:border-primary/20 hover:bg-surface-container-low/70
                 cursor-pointer transition-all hover-lift group"
          onclick={() => goto(`/run/${run.runId}`)}
        >
          <!-- Status icon -->
          <span
            class="material-symbols-outlined text-base flex-shrink-0 {statusClass(run.status)}"
            style="font-variation-settings: 'FILL' {run.status === 'live' ? '0' : '1'};"
            title={run.status}
          >
            {statusIcon(run.status)}
          </span>

          <!-- Run ID + Agent ID -->
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <span class="font-mono text-[11px] text-on-surface/80 truncate" title={run.runId}>
                {run.runId.slice(0, 12)}…
              </span>
              {#if run.hasDebrief}
                <span class="text-[9px] font-mono text-secondary/60 bg-secondary/10 px-1 rounded" title="Has debrief">
                  debrief
                </span>
              {/if}
              {#if run.status === "live"}
                <span class="text-[9px] font-mono text-primary animate-pulse">● LIVE</span>
              {/if}
            </div>
            <div class="font-mono text-[9px] text-outline/50 truncate mt-0.5" title={run.agentId}>
              {run.agentId}
            </div>
          </div>

          <!-- Metrics -->
          <div class="hidden md:flex items-center gap-4 font-mono text-[10px] text-outline/60 flex-shrink-0">
            <span title="Iterations">{run.iterationCount} iter</span>
            <span title="Tokens">{run.tokensUsed.toLocaleString()}t</span>
            <span title="Cost">${(run.cost ?? 0).toFixed(4)}</span>
            <span title="Duration" class="w-12 text-right">{durationStr(run)}</span>
          </div>

          <!-- Time -->
          <div class="flex-shrink-0 font-mono text-[10px] text-outline/40 w-20 text-right">
            {relativeTime(run.startedAt)}
          </div>

          <!-- Arrow -->
          <span class="material-symbols-outlined text-sm text-outline/20 group-hover:text-primary/40 flex-shrink-0 transition-colors">
            chevron_right
          </span>
        </div>
      {/each}
    {/if}
  </div>
</div>
