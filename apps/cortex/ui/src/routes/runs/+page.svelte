<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { CORTEX_SERVER_URL } from "$lib/constants.js";
  import ConfirmModal from "$lib/components/ConfirmModal.svelte";
  import CortexDeskShell from "$lib/components/CortexDeskShell.svelte";
  import { toast } from "$lib/stores/toast-store.js";
  import { createWsClient } from "$lib/stores/ws-client.js";

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

  let wsClient = $state<ReturnType<typeof createWsClient> | null>(null);
  let wsUnsub: (() => void) | null = null;

  // ── Selection + bulk delete ──────────────────────────────────────────
  let selected = $state(new Set<string>());
  let showBulkDeleteConfirm = $state(false);
  let bulkDeleting = $state(false);

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

  function togglePin(runId: string, e: MouseEvent | KeyboardEvent) {
    e.stopPropagation();
    const next = new Set(pinned);
    if (next.has(runId)) next.delete(runId); else next.add(runId);
    pinned = next;
    localStorage.setItem(PINS_KEY, JSON.stringify([...pinned]));
  }

  function handleLiveMessage(msg: {
    agentId?: string;
    runId?: string;
    type?: string;
    payload?: Record<string, unknown>;
  }) {
    if (!msg?.agentId || !msg.runId || !msg.type) return;

    const runId = msg.runId;
    const type = msg.type;
    const payload = msg.payload ?? {};

    // Find or create run entry
    let runIdx = runs.findIndex((r) => r.runId === runId);
    if (runIdx === -1) {
      // New run from live event — might not be in DB yet
      // Create minimal entry; will be filled by subsequent events
      const newRun: RunRow = {
        runId,
        agentId: msg.agentId,
        startedAt: typeof payload.startedAt === "number" ? payload.startedAt : Date.now(),
        status: "live",
        iterationCount: 0,
        tokensUsed: 0,
        cost: 0,
        hasDebrief: false,
        provider: typeof payload.provider === "string" ? payload.provider : undefined,
        model: typeof payload.model === "string" ? payload.model : undefined,
        strategy: typeof payload.strategy === "string" ? payload.strategy : undefined,
      };
      runs = [newRun, ...runs];
      runIdx = 0;
    }

    // Update run based on event type
    const run = runs[runIdx];
    let updated = false;

    switch (type) {
      case "AgentStarted": {
        if (typeof payload.provider === "string" && payload.provider) {
          run.provider = payload.provider;
          updated = true;
        }
        if (typeof payload.model === "string" && payload.model) {
          run.model = payload.model;
          updated = true;
        }
        break;
      }
      case "ReasoningIterationProgress": {
        const iter = typeof payload.iteration === "number" ? payload.iteration : run.iterationCount;
        if (iter !== run.iterationCount) {
          run.iterationCount = iter;
          updated = true;
        }
        if (typeof payload.strategy === "string" && payload.strategy && !run.strategy) {
          run.strategy = payload.strategy;
          updated = true;
        }
        break;
      }
      case "LLMRequestCompleted": {
        const tokens =
          typeof payload.tokensUsed === "number"
            ? payload.tokensUsed
            : typeof (payload.tokensUsed as { total?: number } | undefined)?.total === "number"
              ? (payload.tokensUsed as { total: number }).total
              : 0;
        const cost = typeof payload.estimatedCost === "number" ? payload.estimatedCost : 0;
        if (tokens > 0 || cost > 0) {
          run.tokensUsed += tokens;
          run.cost += cost;
          updated = true;
        }
        break;
      }
      case "ReasoningStepCompleted": {
        // Re-sync iteration count if not yet set
        if (run.iterationCount === 0) {
          const step = typeof payload.step === "number" ? payload.step : 0;
          if (step > 0) {
            run.iterationCount = step;
            updated = true;
          }
        }
        break;
      }
      case "AgentCompleted": {
        if (run.status !== "completed") {
          run.status = payload.success === true ? "completed" : "failed";
          run.completedAt = typeof payload.durationMs === "number"
            ? run.startedAt + payload.durationMs
            : Date.now();
          if (typeof payload.totalTokens === "number") {
            run.tokensUsed = Math.max(run.tokensUsed, payload.totalTokens);
          }
          updated = true;
        }
        break;
      }
      case "TaskFailed": {
        if (run.status !== "failed") {
          run.status = "failed";
          run.completedAt = Date.now();
          updated = true;
        }
        break;
      }
      case "DebriefCompleted": {
        if (!run.hasDebrief) {
          run.hasDebrief = true;
          updated = true;
        }
        break;
      }
    }

    // Trigger reactivity by reassigning the array
    if (updated) {
      runs = runs;
    }
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

    // Subscribe to live WebSocket messages
    wsClient = createWsClient("/ws/live/cortex-broadcast");
    wsUnsub = wsClient.onMessage((raw) => {
      const msg = raw as {
        agentId?: string;
        runId?: string;
        type?: string;
        payload?: Record<string, unknown>;
      };
      handleLiveMessage(msg);
    });
  });

  onDestroy(() => {
    wsUnsub?.();
    wsUnsub = null;
    wsClient?.close();
    wsClient = null;
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
    if (s === "paused") return "pause_circle";
    if (s === "loading") return "hourglass_empty";
    return "schedule";
  }

  function statusClass(s: string): string {
    if (s === "completed") return "text-emerald-600 dark:text-emerald-400";
    if (s === "failed") return "text-error";
    if (s === "live") return "text-primary";
    if (s === "paused") return "text-amber-700 dark:text-amber-500";
    if (s === "loading") return "text-slate-600 dark:text-slate-400";
    return "text-outline dark:text-on-surface-variant";
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

  const someFilteredSelected = $derived(
    filtered.length > 0 && selected.size > 0 && !allFilteredSelected,
  );

  type SortKey = "started-desc" | "started-asc" | "tokens-desc" | "cost-desc";
  let sortBy = $state<SortKey>("started-desc");

  const sortedFiltered = $derived.by(() => {
    const rows = [...filtered];
    const pinRank = (r: RunRow) => (pinned.has(r.runId) ? 1 : 0);
    const byPinned = (a: RunRow, b: RunRow) => pinRank(b) - pinRank(a);
    switch (sortBy) {
      case "started-asc":
        rows.sort((a, b) => {
          const p = byPinned(a, b);
          return p !== 0 ? p : a.startedAt - b.startedAt;
        });
        break;
      case "tokens-desc":
        rows.sort((a, b) => {
          const p = byPinned(a, b);
          return p !== 0 ? p : b.tokensUsed - a.tokensUsed || b.startedAt - a.startedAt;
        });
        break;
      case "cost-desc":
        rows.sort((a, b) => {
          const p = byPinned(a, b);
          return p !== 0 ? p : (b.cost ?? 0) - (a.cost ?? 0) || b.startedAt - a.startedAt;
        });
        break;
      default:
        rows.sort((a, b) => {
          const p = byPinned(a, b);
          return p !== 0 ? p : b.startedAt - a.startedAt;
        });
        break;
    }
    return rows;
  });

  let selectAllRef = $state<HTMLInputElement | null>(null);

  $effect(() => {
    const el = selectAllRef;
    if (!el) return;
    el.indeterminate = someFilteredSelected;
  });

  async function refetchRuns() {
    error = null;
    loading = true;
    try {
      const res = await fetch(`${CORTEX_SERVER_URL}/api/runs?limit=100`);
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      runs = await res.json();
    } catch (e) {
      error = String(e);
    } finally {
      loading = false;
    }
  }

  function rowSurfaceClass(run: RunRow, isSelected: boolean, isPinned: boolean): string {
    if (isSelected) {
      return "border-primary/35 bg-violet-50/95 shadow-[inset_0_0_0_1px_rgba(124,58,237,0.12)] dark:border-primary/28 dark:bg-primary/[0.11] dark:shadow-[inset_0_0_0_1px_rgba(139,92,246,0.2)]";
    }
    if (run.status === "failed") {
      return isPinned
        ? "border-[var(--cortex-border)] bg-white/88 dark:bg-surface-container-low/55 border-l-[3px] border-l-error/55 hover:border-error/35 dark:hover:bg-surface-container-low/75"
        : "border-[var(--cortex-border)] bg-white/80 dark:bg-surface-container-low/45 border-l-[3px] border-l-error/40 hover:bg-rose-50/50 dark:hover:bg-surface-container-low/70";
    }
    if (run.status === "live") {
      return isPinned
        ? "border-primary/30 bg-white/92 dark:bg-surface-container-low/60 shadow-[0_0_0_1px_rgba(6,182,212,0.12)] dark:shadow-[0_0_0_1px_rgba(6,182,212,0.14)]"
        : "border-[var(--cortex-border)] bg-white/82 dark:bg-surface-container-low/48 shadow-[0_0_12px_-4px_rgba(6,182,212,0.25)] dark:shadow-[0_0_14px_-4px_rgba(6,182,212,0.2)] hover:border-secondary/35";
    }
    if (run.status === "completed") {
      return isPinned
        ? "border-[var(--cortex-border)] bg-white/90 dark:bg-surface-container-low/55 border-l-[3px] border-l-emerald-500/45"
        : "border-[var(--cortex-border)] bg-white/78 dark:bg-surface-container-low/45 border-l-[3px] border-l-emerald-500/30 hover:bg-emerald-50/40 dark:hover:bg-surface-container-low/70";
    }
    if (isPinned) {
      return "border-primary/28 bg-white/92 dark:bg-primary/[0.07] hover:border-primary/40";
    }
    return "border-[var(--cortex-border)] bg-white/78 dark:bg-surface-container-low/45 hover:bg-white dark:hover:bg-surface-container-low/72 hover:border-primary/22";
  }
</script>

<svelte:head>
  <title>CORTEX — Trace</title>
</svelte:head>

<CortexDeskShell>
<div class="relative z-10 flex h-full min-h-0 flex-col gap-4 overflow-hidden p-4 sm:p-6">
  <!-- Header -->
  <div class="flex flex-shrink-0 flex-wrap items-start justify-between gap-3">
    <div>
      <h1 class="font-display text-2xl font-light tracking-tight text-slate-900 dark:text-on-surface">
        Execution <span class="font-semibold text-primary">Trace</span>
      </h1>
      <p class="font-mono text-[10px] uppercase tracking-[0.12em] text-slate-500 dark:text-on-surface-variant/85 mt-1">
        Live list · bulk delete · pins stay on top
      </p>
    </div>
    <div class="flex items-center gap-2">
      <button
        type="button"
        onclick={() => void refetchRuns()}
        disabled={loading}
        class="inline-flex items-center gap-1.5 rounded-md border border-[var(--cortex-border)] bg-white/90 px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-slate-700 shadow-sm transition-colors hover:border-secondary hover:text-secondary disabled:opacity-40 dark:bg-surface-container-low/55 dark:text-on-surface-variant dark:hover:text-secondary"
        title="Reload runs from server"
      >
        <span class="material-symbols-outlined text-[16px]" class:animate-spin={loading}>refresh</span>
        Sync
      </button>
      <a
        href="/"
        class="flex items-center gap-1 font-mono text-[11px] text-cyan-700 no-underline transition-colors hover:text-primary dark:text-secondary"
      >
        <span class="material-symbols-outlined text-sm">arrow_back</span> Beacon
      </a>
    </div>
  </div>

  {#if !loading && !error}
    <div
      class="gradient-border flex flex-shrink-0 flex-wrap gap-3 rounded-lg px-4 py-3 shadow-sm backdrop-blur-sm sm:gap-4 dark:shadow-[0_0_0_1px_rgba(139,92,246,0.08)]"
    >
      <div class="min-w-[4.5rem]">
        <div class="font-mono text-[9px] uppercase tracking-widest text-slate-500 dark:text-outline">Total</div>
        <div class="font-mono text-sm tabular-nums text-slate-900 dark:text-on-surface">{stats.total}</div>
      </div>
      <div class="h-8 w-px self-center bg-[var(--cortex-border)]" aria-hidden="true"></div>
      <div class="min-w-[4.5rem]">
        <div class="font-mono text-[9px] uppercase tracking-widest text-emerald-700 dark:text-emerald-400/90">Done</div>
        <div class="font-mono text-sm tabular-nums text-emerald-800 dark:text-emerald-300/90">{stats.completed}</div>
      </div>
      <div class="min-w-[4.5rem]">
        <div class="font-mono text-[9px] uppercase tracking-widest text-error">Failed</div>
        <div class="font-mono text-sm tabular-nums text-error">{stats.failed}</div>
      </div>
      <div class="min-w-[4.5rem]">
        <div class="font-mono text-[9px] uppercase tracking-widest text-primary">Live</div>
        <div class="font-mono text-sm tabular-nums text-primary">{stats.live}</div>
      </div>
      <div class="min-w-[5.5rem]">
        <div class="font-mono text-[9px] uppercase tracking-widest text-slate-500 dark:text-outline">Tokens</div>
        <div class="font-mono text-sm tabular-nums text-slate-900 dark:text-on-surface">
          {stats.totalTokens.toLocaleString()}
        </div>
      </div>
      <div class="min-w-[4.5rem]">
        <div class="font-mono text-[9px] uppercase tracking-widest text-secondary">Cost</div>
        <div class="font-mono text-sm tabular-nums text-cyan-800 dark:text-secondary">${stats.totalCost.toFixed(4)}</div>
      </div>
    </div>
  {/if}

  <!-- Filter + sort -->
  <div class="flex flex-shrink-0 flex-col gap-3 sm:flex-row sm:items-center">
    <div
      class="gradient-border flex flex-1 items-center gap-2 rounded-lg px-3 py-2 shadow-sm backdrop-blur-sm dark:shadow-[0_0_0_1px_rgba(139,92,246,0.08)]"
    >
      <span class="material-symbols-outlined text-sm text-slate-400 dark:text-outline/55">search</span>
      <input
        type="text"
        bind:value={searchText}
        placeholder="Run ID, agent, provider, model…"
        class="flex-1 border-none bg-transparent font-mono text-sm text-slate-900 outline-none placeholder:text-slate-400 dark:text-on-surface dark:placeholder:text-outline/45"
      />
      {#if searchText}
        <button
          type="button"
          onclick={() => (searchText = "")}
          class="material-symbols-outlined cursor-pointer border-0 bg-transparent text-sm text-slate-500 hover:text-primary dark:text-outline dark:hover:text-primary"
        >
          close
        </button>
      {/if}
    </div>
    <div class="flex flex-wrap items-center gap-2">
      <label for="trace-sort" class="sr-only">Sort runs</label>
      <select
        id="trace-sort"
        bind:value={sortBy}
        class="rounded-md border border-[var(--cortex-border)] bg-white/95 px-2 py-1.5 font-mono text-[11px] text-slate-800 outline-none transition-colors focus:border-secondary dark:bg-surface-container-low/70 dark:text-on-surface"
      >
        <option value="started-desc">Newest first</option>
        <option value="started-asc">Oldest first</option>
        <option value="tokens-desc">Most tokens</option>
        <option value="cost-desc">Highest cost</option>
      </select>
      <div
        class="inline-flex items-center gap-0.5 rounded-lg border border-[var(--cortex-border)] bg-white/85 p-0.5 shadow-sm backdrop-blur-sm dark:bg-surface-container-low/45"
      >
        {#each [["all", "All"], ["live", "Live"], ["completed", "Done"], ["failed", "Failed"]] as [val, label]}
          <button
            type="button"
            class="rounded-md px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.08em] transition-colors duration-150
              {statusFilter === val
              ? 'bg-violet-100/95 text-violet-900 shadow-[inset_0_0_0_1px_rgba(124,58,237,0.2)] dark:bg-primary/14 dark:text-primary dark:shadow-[inset_0_0_0_1px_rgba(139,92,246,0.25)]'
              : 'text-slate-600 hover:bg-slate-100/90 hover:text-slate-900 dark:text-on-surface-variant dark:hover:bg-surface-container-high/80 dark:hover:text-on-surface'}"
            onclick={() => (statusFilter = val as typeof statusFilter)}
          >
            {label}
          </button>
        {/each}
      </div>
    </div>
  </div>

  <!-- Run list -->
  <div class="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
    {#if loading}
      <div class="flex h-32 items-center justify-center">
        <span class="material-symbols-outlined animate-spin text-2xl text-primary">progress_activity</span>
      </div>
    {:else if error}
      <div class="mt-8 text-center">
        <p class="font-mono text-sm text-error">{error}</p>
        <button
          type="button"
          onclick={() => void refetchRuns()}
          class="mt-3 inline-flex items-center gap-1 rounded-md border border-[var(--cortex-border)] bg-white/90 px-3 py-1.5 font-mono text-[11px] text-slate-700 dark:bg-surface-container-low/60 dark:text-on-surface-variant"
        >
          Retry
        </button>
      </div>
    {:else if filtered.length === 0}
      <p class="mt-8 text-center font-mono text-xs text-slate-500 dark:text-outline">
        {searchText || statusFilter !== "all" ? "No runs match the filter." : "No runs yet."}
      </p>
    {:else}
      <!-- Always-visible run management: select all + actions -->
      <div
        class="gradient-border flex flex-shrink-0 flex-wrap items-center gap-3 rounded-lg px-3 py-2.5 shadow-sm backdrop-blur-sm dark:shadow-[0_0_0_1px_rgba(139,92,246,0.08)]"
      >
        <div class="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
          <input
            bind:this={selectAllRef}
            type="checkbox"
            checked={allFilteredSelected}
            onchange={toggleSelectAll}
            class="h-3.5 w-3.5 shrink-0 cursor-pointer accent-primary"
            title={allFilteredSelected ? "Deselect all in view" : "Select all in view"}
            aria-label="Select all runs matching the current filter"
          />
          <span class="font-mono text-[10px] uppercase tracking-[0.1em] text-slate-600 dark:text-on-surface-variant">
            {#if selected.size === 0}
              <span class="text-slate-800 dark:text-on-surface">Select all</span>
              <span class="text-slate-400 dark:text-outline/60"> · {filtered.length} in view</span>
            {:else}
              <span class="text-primary">{selected.size}</span>
              <span class="text-slate-400 dark:text-outline/60"> / {filtered.length} selected</span>
            {/if}
          </span>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          {#if selected.size > 0}
            <button
              type="button"
              onclick={() => (showBulkDeleteConfirm = true)}
              disabled={bulkDeleting}
              class="inline-flex cursor-pointer items-center gap-1 rounded-md border border-error/35 bg-rose-50/80 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-error transition-colors hover:bg-error/10 disabled:opacity-40 dark:bg-error/[0.08] dark:hover:bg-error/15"
            >
              <span class="material-symbols-outlined text-[15px]">delete_sweep</span>
              Delete ({selected.size})
            </button>
            <button
              type="button"
              onclick={() => (selected = new Set())}
              class="cursor-pointer border-0 bg-transparent font-mono text-[10px] uppercase tracking-[0.1em] text-slate-500 underline-offset-2 hover:text-primary dark:text-outline dark:hover:text-primary"
            >
              Clear selection
            </button>
          {/if}
        </div>
      </div>

      <div class="min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-0.5">
        {#each sortedFiltered as run (run.runId)}
          {@const isPinned = pinned.has(run.runId)}
          {@const isSelected = selected.has(run.runId)}
          <div
            class="group flex w-full items-center gap-2.5 rounded-lg border px-3 py-2.5 transition-all duration-150 sm:gap-3 sm:px-4 sm:py-3 {rowSurfaceClass(
              run,
              isSelected,
              isPinned,
            )}"
          >
            <!-- Clicks on the checkbox hit target must not follow the row link -->
            <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
            <div class="flex w-7 shrink-0 items-center justify-center" onclick={(e) => e.stopPropagation()}>
              <input
                type="checkbox"
                checked={isSelected}
                onclick={(e) => e.stopPropagation()}
                onchange={() => {
                  const next = new Set(selected);
                  if (next.has(run.runId)) next.delete(run.runId);
                  else next.add(run.runId);
                  selected = next;
                }}
                class="h-3.5 w-3.5 cursor-pointer accent-primary"
                aria-label={`Select run ${run.runId}`}
              />
            </div>

            <a
              href={`/run/${run.runId}`}
              data-sveltekit-preload-data="hover"
              class="flex min-w-0 flex-1 items-center gap-2.5 no-underline outline-none transition-colors visited:text-inherit focus-visible:ring-2 focus-visible:ring-secondary focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--cortex-bg)] sm:gap-3 text-inherit"
            >
              <span
                class="material-symbols-outlined flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[var(--cortex-border)] bg-white/60 text-[18px] dark:bg-surface-container/50 {statusClass(
                  run.status,
                )}"
                style="font-variation-settings: 'FILL' {run.status === 'live' ? '0' : '1'};"
                title={run.status}
              >
                {statusIcon(run.status)}
              </span>

              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  {#if isPinned}
                    <span
                      class="material-symbols-outlined text-[11px] text-primary/70"
                      style="font-variation-settings: 'FILL' 1;">push_pin</span>
                  {/if}
                  <span
                    class="truncate font-mono text-[11px] text-slate-900 dark:text-on-surface/95"
                    title={run.runId}>{run.runId.slice(0, 12)}…</span>
                  {#if run.hasDebrief}
                    <span
                      class="rounded bg-cyan-50/90 px-1 font-mono text-[9px] text-cyan-800 dark:bg-secondary/10 dark:text-secondary/80"
                      >debrief</span>
                  {/if}
                  {#if run.status === "live"}
                    <span class="animate-pulse font-mono text-[9px] text-primary">● LIVE</span>
                  {:else if run.status === "paused"}
                    <span class="font-mono text-[9px] text-amber-800 dark:text-amber-400">● PAUSED</span>
                  {/if}
                  {#if run.strategy}
                    <span
                      class="hidden font-mono text-[9px] text-slate-500 sm:inline dark:text-outline/70"
                      title="Kernel / strategy">{run.strategy}</span>
                  {/if}
                </div>
                <div class="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span
                    class="truncate font-mono text-[9px] text-slate-500 dark:text-on-surface-variant/75"
                    title={run.agentId}>{run.agentId}</span>
                  {#if run.provider}
                    <span class="font-mono text-[9px] text-slate-300 dark:text-outline/35">·</span>
                    <span class="font-mono text-[9px] text-violet-700 dark:text-primary/70">{run.provider}</span>
                  {/if}
                  {#if run.model}
                    <span class="font-mono text-[9px] text-slate-300 dark:text-outline/35">·</span>
                    <span
                      class="max-w-[140px] truncate font-mono text-[9px] text-cyan-800 dark:text-secondary/75"
                      >{run.model}</span>
                  {/if}
                </div>
              </div>

              <div
                class="hidden shrink-0 items-center gap-4 font-mono text-[10px] text-slate-500 tabular-nums md:flex dark:text-on-surface-variant/65"
              >
                <span>{run.iterationCount} iter</span>
                <span>{run.tokensUsed.toLocaleString()}t</span>
                <span>${(run.cost ?? 0).toFixed(4)}</span>
                <span class="w-12 text-right">{durationStr(run)}</span>
              </div>

              <div class="flex shrink-0 items-center gap-1.5 sm:gap-2">
                <span
                  class="w-14 text-right font-mono text-[10px] text-slate-400 tabular-nums dark:text-outline/50 sm:w-16"
                  >{relativeTime(run.startedAt)}</span>
                <span
                  class="material-symbols-outlined text-sm text-slate-300 transition-colors group-hover:text-primary/50 dark:text-outline/25"
                  >chevron_right</span>
              </div>
            </a>

            <button
              type="button"
              class="material-symbols-outlined shrink-0 cursor-pointer border-0 bg-transparent p-1 text-sm transition-colors
                {isPinned
                ? 'text-primary/70 hover:text-primary'
                : 'text-slate-300 opacity-0 group-hover:opacity-100 hover:text-primary dark:text-outline/25 dark:group-hover:opacity-100'}"
              style="font-variation-settings: 'FILL' {isPinned ? '1' : '0'};"
              title={isPinned ? "Unpin run" : "Pin run"}
              aria-label={isPinned ? "Unpin run" : "Pin run"}
              onclick={(e) => togglePin(run.runId, e)}
            >
              push_pin
            </button>
          </div>
        {/each}
      </div>
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
