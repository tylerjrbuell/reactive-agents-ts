<script lang="ts">
  /**
   * The run inspector's Memory tab: which memory tiers the run bootstrapped and
   * flushed (from its events), then what this run wrote to the agent's memory
   * (`GET /api/memory/:agentId?runId=`, read through the framework's
   * `agent.memory()`). Editing happens in the Lab Memory studio, linked here.
   */
  import Badge from "$lib/components/kit/Badge.svelte";
  import Button from "$lib/components/kit/Button.svelte";
  import { fetchMemory, memoryStudioHref, type MemoryListing } from "$lib/memory-studio.js";

  interface Ev {
    readonly type: string;
    readonly payload: Record<string, unknown>;
    readonly ts: number;
  }
  interface Props {
    events: Ev[];
    agentId?: string;
    runId?: string;
  }
  let { events, agentId, runId }: Props = $props();

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

  // ── What this run wrote (same API as the Memory studio) ────────────────
  let written = $state<MemoryListing | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);

  // Reload when the run finishes: memory is flushed at the end of a run.
  const loadKey = $derived(`${agentId ?? ""}|${runId ?? ""}|${summary.runCompleted}|${summary.flushCount}`);
  $effect(() => {
    void loadKey;
    if (!agentId || !runId) return;
    loading = true;
    error = null;
    fetchMemory(agentId, runId)
      .then((d) => { written = d; })
      .catch((e) => { error = e instanceof Error ? e.message : String(e); })
      .finally(() => { loading = false; });
  });

  const total = $derived(written ? written.semantic.length + written.procedural.length + written.episodic.length : 0);

  function truncate(s: string, n = 220): string {
    return s.length > n ? s.slice(0, n) + "…" : s;
  }
</script>

<section class="sec">
  {#if memoryEnabled}
    <div class="tiers">
      {#each summary.bootstrappedTiers as tier (tier)}<Badge tone="accent">{tier}</Badge>{/each}
      {#if summary.flushCount > 0}<span class="meta">{summary.flushCount} flush{summary.flushCount !== 1 ? "es" : ""}</span>{/if}
    </div>
  {/if}

  <h3>Memories this run wrote</h3>
  {#if loading && !written}
    <p class="hint" role="status">Loading memory…</p>
  {:else if error}
    <p class="hint bad" role="alert">Could not load memory: {error}</p>
  {:else if !written?.available}
    <p class="hint">
      {memoryEnabled
        ? "The run used memory, but this agent has no memory database yet."
        : summary.runCompleted
          ? "Memory was not on for this run. Turn it on in the agent's Memory settings."
          : "No memory events yet."}
    </p>
  {:else if total === 0}
    <p class="hint">{summary.runCompleted ? "This run stored nothing." : "Nothing stored yet. Memory is written as the run ends."}</p>
  {:else}
    {#each written.semantic as sm (sm.id)}
      <article class="entry">
        <span class="meta">fact · importance {sm.importance.toFixed(2)}</span>
        <p>{truncate(sm.content)}</p>
      </article>
    {/each}
    {#each written.procedural as pr (pr.id)}
      <article class="entry">
        <span class="meta">workflow · {Math.round(pr.successRate * 100)}% success</span>
        <p class="strong">{pr.name}</p>
        {#if pr.description}<p>{truncate(pr.description, 160)}</p>{/if}
      </article>
    {/each}
    {#each written.episodic as ep (ep.id)}
      <article class="entry">
        <span class="meta">log · {ep.eventType}</span>
        <p>{truncate(ep.content, 160)}</p>
      </article>
    {/each}
  {/if}

  {#if agentId && written?.available}
    <div class="links">
      {#if runId && total > 0}<Button size="sm" icon="edit" href={memoryStudioHref(agentId, runId)}>Edit in the Memory studio</Button>{/if}
      <Button size="sm" variant="ghost" icon="book" href={memoryStudioHref(agentId)}>All of this agent's memory</Button>
    </div>
  {/if}
</section>

<style>
  .sec { display: grid; gap: 10px; }
  h3 { margin: 0; font-size: var(--cortex-t-xs); font-weight: 600; color: var(--cortex-text-2); }
  .hint { margin: 0; font-size: var(--cortex-t-xs); color: var(--cortex-text-3); line-height: var(--cortex-lh-ui); }
  .bad { color: var(--cortex-bad); }
  .tiers { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
  .meta { font-family: var(--cortex-font-data); font-size: var(--cortex-t-2xs); color: var(--cortex-text-3); }
  .entry { display: grid; gap: 4px; padding: 8px 10px; border-radius: var(--cortex-r-ctl); background: var(--cortex-surface-2); }
  .entry p { margin: 0; font-size: var(--cortex-t-sm); line-height: var(--cortex-lh-ui); color: var(--cortex-text); white-space: pre-wrap; overflow-wrap: anywhere; }
  .strong { font-weight: 500; }
  .links { display: flex; flex-wrap: wrap; gap: 8px; }
</style>
