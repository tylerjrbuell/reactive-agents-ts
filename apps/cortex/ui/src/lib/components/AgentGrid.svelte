<script lang="ts">
  import AgentCard from "./AgentCard.svelte";
  import type { AgentNode } from "$lib/stores/agent-store.js";
  import { buildRunHierarchy, flattenVisible, descendantCount } from "$lib/run-hierarchy.js";

  interface Props {
    agents: AgentNode[];
  }
  let { agents }: Props = $props();

  const activeCount = $derived(agents.filter((a) => ["running", "exploring", "stressed"].includes(a.state)).length);

  // Delegation forest (edges by run id); children are listed under their parent.
  const hierarchy = $derived(buildRunHierarchy(agents));
  let collapsed = $state(new Set<string>());
  const rows = $derived(flattenVisible(hierarchy.roots, collapsed));

  function toggle(runId: string) {
    const next = new Set(collapsed);
    if (next.has(runId)) next.delete(runId);
    else next.add(runId);
    collapsed = next;
  }
</script>

<div
  class="rounded-xl backdrop-blur-[8px] p-3 sm:p-4
         bg-gradient-to-b from-white/90 via-violet-50/45 to-slate-100/90
         dark:from-surface-container-low/55 dark:via-[#12141c]/85 dark:to-[#0d0f14]/[0.92]
         shadow-[0_0_0_1px_rgba(124,58,237,0.2),0_0_0_1px_rgba(255,255,255,0.5)_inset,0_8px_28px_rgba(124,58,237,0.08)]
         dark:shadow-[0_0_0_1px_rgba(139,92,246,0.35),0_0_0_1px_rgba(6,182,212,0.08)_inset,0_8px_40px_rgba(139,92,246,0.12),0_0_60px_rgba(6,182,212,0.06)]"
  aria-label="Agent desk"
>
  <div
    class="flex items-center justify-between gap-3 mb-3 sm:mb-4 pb-2 border-b border-primary/20"
  >
    <div class="flex items-center gap-2 min-w-0">
      <span
        class="material-symbols-outlined text-cyan-700 dark:text-secondary text-lg shrink-0 dark:drop-shadow-[0_0_8px_rgba(6,182,212,0.5)]"
        aria-hidden="true">dashboard</span>
      <div class="min-w-0">
        <h2 class="font-display text-xs font-semibold uppercase tracking-[0.12em] text-on-surface truncate">
          Desk
        </h2>
        <p class="text-[10px] font-mono text-outline/60 truncate">
          {agents.length} run{agents.length !== 1 ? "s" : ""}
          {#if activeCount > 0}
            <span
              class="text-cyan-700 dark:text-cyan-300 font-semibold dark:drop-shadow-[0_0_6px_rgba(34,211,238,0.45)]"
            >
              · {activeCount} live</span>
          {/if}
        </p>
      </div>
    </div>
  </div>

  <div class="cortex-beacon-desk-grid relative z-10">
    {#each rows as row, i (row.agent.runId)}
      {@const agent = row.agent}
      {@const hidden = descendantCount(row)}
      <div
        class="animate-fade-up"
        style="animation-delay: {Math.min(i, 8) * 35}ms; margin-left: {Math.min(row.depth, 4) * 1.25}rem;"
        data-agent-id={agent.runId}
        data-parent-run-id={hierarchy.parentOf.get(agent.runId)}
        data-depth={row.depth}
      >
        {#if row.children.length > 0}
          <button
            type="button"
            class="mb-1 flex items-center gap-1 text-[10px] font-mono text-outline/70 hover:text-primary"
            aria-expanded={!collapsed.has(agent.runId)}
            onclick={() => toggle(agent.runId)}
          >
            <span class="material-symbols-outlined text-sm" aria-hidden="true">
              {collapsed.has(agent.runId) ? "chevron_right" : "expand_more"}
            </span>
            {collapsed.has(agent.runId) ? `Show ${hidden} sub-agent${hidden === 1 ? "" : "s"}` : `${hidden} sub-agent${hidden === 1 ? "" : "s"}`}
          </button>
        {/if}
        <AgentCard {agent} parentRunId={hierarchy.parentOf.get(agent.runId)} />
      </div>
    {/each}
  </div>
</div>
