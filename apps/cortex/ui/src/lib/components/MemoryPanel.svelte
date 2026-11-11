<script lang="ts">
  /**
   * The inspector's Memory tab: which memory tiers the run bootstrapped and
   * flushed (from its events), then the agent's stored episodic, semantic,
   * procedural and session entries (`GET /api/memory/:agentId`).
   */
  import { CORTEX_SERVER_URL } from "$lib/constants.js";
  import Badge from "$lib/components/kit/Badge.svelte";

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
      return new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    } catch { return String(ts); }
  }

  function truncate(s: string, n = 200): string {
    return s.length > n ? s.slice(0, n) + "…" : s;
  }

  const kinds = $derived(
    memoryData
      ? ([
          { id: "episodic", label: "Episodic", count: memoryData.episodic.length },
          { id: "semantic", label: "Semantic", count: memoryData.semantic.length },
          { id: "procedural", label: "Procedural", count: memoryData.procedural.length },
          { id: "sessions", label: "Sessions", count: memoryData.sessions.length },
        ] as const)
      : [],
  );
</script>

<section class="sec">
  {#if loading}
    <p class="hint" role="status">Loading memory…</p>
  {:else if error}
    <p class="hint bad" role="alert">Could not load memory: {error}</p>
  {:else if !memoryEnabled && !memoryData?.available}
    <h3>Memory</h3>
    <p class="hint">
      {summary.runCompleted ? "Memory was not on for this run. Turn it on in the agent's Memory settings." : "No memory events yet."}
    </p>
  {:else}
    <div class="tiers">
      {#each summary.bootstrappedTiers as tier (tier)}<Badge tone="accent">{tier}</Badge>{/each}
      {#if summary.flushCount > 0}<span class="meta">{summary.flushCount} flush{summary.flushCount !== 1 ? "es" : ""}</span>{/if}
    </div>

    {#if memoryData?.available}
      <div class="seg" role="group" aria-label="Memory kind">
        {#each kinds as k (k.id)}
          <button type="button" aria-pressed={activeTab === k.id} onclick={() => (activeTab = k.id)}>{k.label} <span class="n">{k.count}</span></button>
        {/each}
      </div>

      {#if activeTab === "episodic"}
        {#each memoryData.episodic as ep (ep.id)}
          <article class="entry">
            <span class="meta">{fmtDate(ep.date || ep.createdAt)}{#if ep.eventType} · {ep.eventType}{/if}</span>
            <p>{truncate(ep.content, 300)}</p>
          </article>
        {:else}<p class="hint">No episodic entries.</p>{/each}
      {:else if activeTab === "semantic"}
        {#each memoryData.semantic as sm (sm.id)}
          <article class="entry">
            <span class="meta">importance {sm.importance.toFixed(2)} · {sm.accessCount} access{sm.accessCount !== 1 ? "es" : ""}{#each sm.tags.slice(0, 4) as tag (tag)} · {tag}{/each}</span>
            {#if sm.summary}<p class="strong">{sm.summary}</p>{/if}
            <p>{truncate(sm.content, 250)}</p>
          </article>
        {:else}<p class="hint">No semantic entries.</p>{/each}
      {:else if activeTab === "procedural"}
        {#each memoryData.procedural as pr (pr.id)}
          <article class="entry">
            <span class="strong">{pr.name}</span>
            <span class="meta">{(pr.successRate * 100).toFixed(0)}% success · used {pr.useCount}×</span>
            {#if pr.description}<p>{truncate(pr.description, 200)}</p>{/if}
          </article>
        {:else}<p class="hint">No procedural entries.</p>{/each}
      {:else}
        {#each memoryData.sessions as sess (sess.id)}
          <article class="entry">
            <span class="meta">{fmtDate(sess.startedAt)}{#if sess.totalTokens > 0} · {sess.totalTokens.toLocaleString()} tokens{/if}</span>
            {#if sess.summary}<p>{truncate(sess.summary, 250)}</p>{/if}
            {#if sess.keyDecisions.length > 0}
              <ul>{#each sess.keyDecisions.slice(0, 5) as kd, i (i)}<li>{truncate(kd, 120)}</li>{/each}</ul>
            {/if}
          </article>
        {:else}<p class="hint">No session snapshots.</p>{/each}
      {/if}
    {:else}
      <p class="hint">The run used memory, but no memory database was found for this agent.</p>
    {/if}
  {/if}
</section>

<style>
  .sec { display: grid; gap: 10px; }
  h3 { margin: 0; font-size: var(--cortex-t-xs); font-weight: 600; color: var(--cortex-text-2); }
  .hint { margin: 0; font-size: var(--cortex-t-xs); color: var(--cortex-text-3); line-height: var(--cortex-lh-ui); }
  .bad { color: var(--cortex-bad); }
  .tiers { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
  .meta { font-family: var(--cortex-font-data); font-size: var(--cortex-t-2xs); color: var(--cortex-text-3); }
  .seg { display: inline-flex; flex-wrap: wrap; padding: 2px; border-radius: var(--cortex-r-ctl); background: var(--cortex-surface-2); justify-self: start; }
  .seg button { display: inline-flex; gap: 6px; padding: 4px 9px; border: 0; border-radius: 6px; background: none; color: var(--cortex-text-2); font: inherit; font-size: var(--cortex-t-xs); cursor: pointer; }
  .seg button[aria-pressed="true"] { background: var(--cortex-surface-1); color: var(--cortex-text); box-shadow: 0 0 0 1px var(--cortex-line-strong); }
  .seg button:focus-visible { outline: 2px solid var(--cortex-focus); outline-offset: 1px; }
  .n { font-family: var(--cortex-font-data); font-size: var(--cortex-t-2xs); color: var(--cortex-text-3); }
  .entry { display: grid; gap: 4px; padding: 8px 10px; border-radius: var(--cortex-r-ctl); background: var(--cortex-surface-2); }
  .entry p { margin: 0; font-size: var(--cortex-t-sm); line-height: var(--cortex-lh-ui); color: var(--cortex-text); white-space: pre-wrap; overflow-wrap: anywhere; }
  .strong { font-weight: 500; color: var(--cortex-text); font-size: var(--cortex-t-sm); }
  ul { margin: 0; padding-left: 18px; font-size: var(--cortex-t-xs); color: var(--cortex-text-2); }
</style>
