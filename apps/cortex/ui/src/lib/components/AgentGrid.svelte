<script lang="ts">
  import AgentCard from "./AgentCard.svelte";
  import type { AgentNode } from "$lib/stores/agent-store.js";

  interface Props {
    agents: AgentNode[];
  }
  let { agents }: Props = $props();
</script>

<div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6 relative z-10">
  {#each agents as agent (agent.runId)}
    <div class="animate-fade-up">
      <AgentCard {agent} />
    </div>
  {/each}
</div>
