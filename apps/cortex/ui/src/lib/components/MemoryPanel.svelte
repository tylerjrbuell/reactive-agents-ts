<script lang="ts">
  import { CORTEX_SERVER_URL } from "$lib/constants.js";

  interface Ev {
    readonly type: string;
    readonly payload: Record<string, unknown>;
    readonly ts: number;
  }
  interface Props {
    events: Ev[];
    agentId?: string;
  }
  let { events, agentId }: Props = $props();

  // ── Bootstrap/flush summary from event stream ──────────────────────────
  const summary = $derived.by(() => {
    const tiers = new Set<string>();
    let flushCount = 0;
    let runCompleted = false;
    for (const e of events) {
      if (e.type === "MemoryBootstrapped") {
        if (typeof e.payload.tier === "string") tiers.add(e.payload.tier);
      } else if (e.type === "MemoryFlushed") {
        flushCount += 1;
      } else if (e.type === "AgentCompleted" || e.type === "TaskFailed") {
        runCompleted = true;
      }
    }
    return { bootstrappedTiers: [...tiers], flushCount, runCompleted };
  });

  const memoryEnabled = $derived(summary.bootstrappedTiers.length > 0 || summary.flushCount > 0);

  // ── Fetch actual memory content from server ────────────────────────────
  type MemoryData = {
    available: boolean;
    episodic: Array<{ id: string; date: string; content: string; taskId: string | null; eventType: string | null; createdAt: number }>;
    semantic: Array<{ id: string; content: string; summary: string | null; importance: number; tags: string[]; accessCount: number }>;
    procedural: Array<{ id: string; name: string; description: string | null; successRate: number; useCount: number }>;
    sessions: Array<{ id: string; summary: string | null; keyDecisions: string[]; startedAt: number; endedAt: number | null; totalTokens: number }>;
  };

  let memoryData = $state<MemoryData | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let activeTab = $state<"episodic" | "semantic" | "procedural" | "sessions">("episodic");

  $effect(() => {
    if (!agentId) return;
    loading = true;
    error = null;
    fetch(`${CORTEX_SERVER_URL}/api/memory/${encodeURIComponent(agentId)}`)
      .then((r) => r.json())
      .then((d) => { memoryData = d as MemoryData; })
      .catch((e) => { error = e instanceof Error ? e.message : String(e); })
      .finally(() => { loading = false; });
  });

  function fmtDate(ts: number | string): string {
    try {
      const d = typeof ts === "number" ? new Date(ts) : new Date(ts);
      return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    } catch { return String(ts); }
  }

  function truncate(s: string, n = 200): string {
    return s.length > n ? s.slice(0, n) + "…" : s;
  }
</script>

<div class="h-full overflow-y-auto px-4 py-3 flex flex-col gap-3">

  {#if loading}
    <p class="font-mono text-[10px] text-outline text-center mt-4">Loading memory…</p>

  {:else if error}
    <p class="font-mono text-[10px] text-error text-center mt-4">Error: {error}</p>

  {:else if !memoryEnabled && !memoryData?.available}
    <p class="font-mono text-[10px] text-outline text-center mt-4">
      {summary.runCompleted ? "Memory was not enabled for this run." : "No memory events yet."}
    </p>

  {:else}

    <!-- Bootstrap tiers + flush counts -->
    <div class="flex items-center gap-3 flex-wrap">
      {#if summary.bootstrappedTiers.length > 0}
        {#each summary.bootstrappedTiers as tier}
          <span class="px-2 py-0.5 bg-primary/10 border border-primary/20 text-[9px] font-mono text-primary rounded">{tier}</span>
        {/each}
      {/if}
      {#if summary.flushCount > 0}
        <span class="text-[9px] font-mono text-outline">{summary.flushCount} flush{summary.flushCount !== 1 ? "es" : ""}</span>
      {/if}
      {#if memoryData}
        <span class="text-[9px] font-mono text-outline ml-auto">
          {memoryData.episodic.length} episodic · {memoryData.semantic.length} semantic · {memoryData.procedural.length} procedural
        </span>
      {/if}
    </div>

    {#if memoryData?.available}
      <!-- Sub-tabs -->
      <div class="flex flex-shrink-0 gap-0 border-b border-[var(--cortex-border)]">
        {#each [
          { id: "episodic",   label: "Episodic",   count: memoryData.episodic.length },
          { id: "semantic",   label: "Semantic",   count: memoryData.semantic.length },
          { id: "procedural", label: "Procedural", count: memoryData.procedural.length },
          { id: "sessions",   label: "Sessions",   count: memoryData.sessions.length },
        ] as tab (tab.id)}
          <button
            type="button"
            onclick={() => activeTab = tab.id as typeof activeTab}
            class="px-3 py-1.5 text-[9px] font-mono uppercase tracking-wider border-0 bg-transparent cursor-pointer
                   transition-colors {activeTab === tab.id
                     ? 'text-primary border-b border-primary -mb-px'
                     : 'text-outline hover:text-on-surface'}"
          >{tab.label} {#if tab.count > 0}<span class="opacity-50">({tab.count})</span>{/if}</button>
        {/each}
      </div>

      <!-- Episodic -->
      {#if activeTab === "episodic"}
        {#if memoryData.episodic.length === 0}
          <p class="font-mono text-[10px] text-outline/50 text-center py-4">No episodic entries.</p>
        {:else}
          <div class="space-y-2">
            {#each memoryData.episodic as ep (ep.id)}
              <div class="bg-surface-container-low/40 border border-[var(--cortex-border)] rounded p-2.5 space-y-1">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="text-[9px] font-mono text-outline">{fmtDate(ep.date || ep.createdAt)}</span>
                  {#if ep.eventType}
                    <span class="px-1.5 py-0.5 bg-secondary/10 border border-secondary/15 text-[8px] font-mono text-secondary rounded">{ep.eventType}</span>
                  {/if}
                </div>
                <p class="text-[10px] font-mono text-on-surface/80 leading-relaxed whitespace-pre-wrap">{truncate(ep.content, 300)}</p>
              </div>
            {/each}
          </div>
        {/if}

      <!-- Semantic -->
      {:else if activeTab === "semantic"}
        {#if memoryData.semantic.length === 0}
          <p class="font-mono text-[10px] text-outline/50 text-center py-4">No semantic entries.</p>
        {:else}
          <div class="space-y-2">
            {#each memoryData.semantic as sm (sm.id)}
              <div class="bg-surface-container-low/40 border border-[var(--cortex-border)] rounded p-2.5 space-y-1">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="text-[9px] font-mono text-primary/60">importance {sm.importance.toFixed(2)}</span>
                  <span class="text-[9px] font-mono text-outline">{sm.accessCount} access{sm.accessCount !== 1 ? "es" : ""}</span>
                  {#each sm.tags.slice(0, 4) as tag}
                    <span class="px-1.5 py-0.5 bg-tertiary/10 border border-tertiary/15 text-[8px] font-mono text-tertiary rounded">{tag}</span>
                  {/each}
                </div>
                {#if sm.summary}
                  <p class="text-[10px] font-mono text-primary/80 leading-relaxed">{sm.summary}</p>
                {/if}
                <p class="text-[10px] font-mono text-on-surface/60 leading-relaxed whitespace-pre-wrap">{truncate(sm.content, 250)}</p>
              </div>
            {/each}
          </div>
        {/if}

      <!-- Procedural -->
      {:else if activeTab === "procedural"}
        {#if memoryData.procedural.length === 0}
          <p class="font-mono text-[10px] text-outline/50 text-center py-4">No procedural entries.</p>
        {:else}
          <div class="space-y-2">
            {#each memoryData.procedural as pr (pr.id)}
              <div class="bg-surface-container-low/40 border border-[var(--cortex-border)] rounded p-2.5 space-y-1">
                <div class="flex items-center gap-2">
                  <span class="text-[10px] font-mono text-on-surface/80 font-semibold">{pr.name}</span>
                  <span class="text-[9px] font-mono text-outline">{(pr.successRate * 100).toFixed(0)}% success</span>
                  <span class="text-[9px] font-mono text-outline">{pr.useCount}× used</span>
                </div>
                {#if pr.description}
                  <p class="text-[10px] font-mono text-on-surface/60 leading-relaxed">{truncate(pr.description, 200)}</p>
                {/if}
              </div>
            {/each}
          </div>
        {/if}

      <!-- Sessions -->
      {:else if activeTab === "sessions"}
        {#if memoryData.sessions.length === 0}
          <p class="font-mono text-[10px] text-outline/50 text-center py-4">No session snapshots.</p>
        {:else}
          <div class="space-y-2">
            {#each memoryData.sessions as sess (sess.id)}
              <div class="bg-surface-container-low/40 border border-[var(--cortex-border)] rounded p-2.5 space-y-1">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="text-[9px] font-mono text-outline">{fmtDate(sess.startedAt)}</span>
                  {#if sess.totalTokens > 0}
                    <span class="text-[9px] font-mono text-outline">{sess.totalTokens.toLocaleString()} tokens</span>
                  {/if}
                </div>
                {#if sess.summary}
                  <p class="text-[10px] font-mono text-on-surface/80 leading-relaxed">{truncate(sess.summary, 250)}</p>
                {/if}
                {#if sess.keyDecisions.length > 0}
                  <ul class="space-y-0.5 pl-2">
                    {#each sess.keyDecisions.slice(0, 5) as kd}
                      <li class="text-[9px] font-mono text-on-surface/50 leading-relaxed list-disc list-inside">{truncate(kd, 120)}</li>
                    {/each}
                  </ul>
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      {/if}

    {:else}
      <!-- Memory was enabled (bootstrap events seen) but DB not found / no data yet -->
      <p class="font-mono text-[10px] text-outline/50 text-center py-4">Memory DB not found for this agent.</p>
    {/if}

  {/if}
</div>
