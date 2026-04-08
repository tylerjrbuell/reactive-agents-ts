<script lang="ts">
  import AgentCard from "./AgentCard.svelte";
  import type { AgentNode } from "$lib/stores/agent-store.js";

  interface Props {
    agents: AgentNode[];
  }
  let { agents }: Props = $props();

  const activeCount = $derived(agents.filter((a) => ["running", "exploring", "stressed"].includes(a.state)).length);

  // Build hierarchy map: parentRunId → childRunIds[]
  const hierarchyMap = $derived.by(() => {
    const map = new Map<string, string[]>();
    for (const agent of agents) {
      if (agent.parentRunId) {
        if (!map.has(agent.parentRunId)) {
          map.set(agent.parentRunId, []);
        }
        map.get(agent.parentRunId)!.push(agent.runId);
      }
    }
    return map;
  });
</script>

<div
  class="rounded-xl backdrop-blur-[8px] p-3 sm:p-4
         bg-gradient-to-b from-white/92 via-violet-50/45 to-slate-100/90
         dark:from-surface-container-low/55 dark:via-[#12141c]/85 dark:to-[#0d0f14]/92
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
    {#each agents as agent, i (agent.runId)}
      <div
        class="animate-fade-up"
        style="animation-delay: {Math.min(i, 8) * 35}ms"
        data-agent-id={agent.runId}
        data-parent-run-id={agent.parentRunId}
      >
        <AgentCard {agent} parentRunId={agent.parentRunId} />
      </div>
    {/each}
  </div>
</div>
