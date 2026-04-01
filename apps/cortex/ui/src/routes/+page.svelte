<script lang="ts">
  import { getContext } from "svelte";
  import AgentGrid from "$lib/components/AgentGrid.svelte";
  import EmptyStage from "$lib/components/EmptyStage.svelte";
  import BottomInputBar from "$lib/components/BottomInputBar.svelte";
  import type { AgentStore } from "$lib/stores/agent-store.js";
  import type { StageStore } from "$lib/stores/stage-store.js";

  const agentStore = getContext<AgentStore>("agentStore");
  const stageStore = getContext<StageStore>("stageStore");

  let inputBarRef = $state<{ focus: () => void } | undefined>(undefined);
</script>

<svelte:head>
  <title>CORTEX — Stage</title>
</svelte:head>

<div class="relative h-full flex flex-col overflow-hidden">
  <div
    class="absolute top-1/4 left-1/3 w-[500px] h-[500px] bg-primary/5 blur-[120px] rounded-full pointer-events-none"
  ></div>
  <div
    class="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] bg-secondary/5 blur-[100px] rounded-full pointer-events-none"
  ></div>

  <div class="flex justify-between items-start px-8 pt-8 pb-6 relative z-10 flex-shrink-0">
    <div>
      <h1 class="font-headline text-3xl font-light tracking-tight text-on-surface">
        Cortex <span class="font-bold text-primary">Stage</span>
      </h1>
      <p class="font-mono text-[10px] text-outline uppercase tracking-widest mt-1">
        {$agentStore.length > 0
          ? `${$agentStore.length} node${$agentStore.length !== 1 ? "s" : ""} · ${$agentStore.filter((a) => a.state === "running" || a.state === "exploring" || a.state === "stressed").length} active`
          : "Awaiting connections"}
      </p>
    </div>

    {#if $agentStore.length > 0}
      <div class="flex flex-col items-end">
        <span class="font-mono text-[10px] text-outline uppercase tracking-widest">Active Nodes</span>
        <span class="font-headline text-xl text-secondary">
          {String(
            $agentStore.filter((a) => ["running", "exploring", "stressed"].includes(a.state)).length,
          ).padStart(2, "0")}
        </span>
      </div>
    {/if}
  </div>

  <div class="flex-1 relative overflow-y-auto px-8 pb-32 z-10 min-h-0">
    {#if $agentStore.length > 0}
      <AgentGrid agents={$agentStore} />
    {:else}
      <div class="h-full flex items-center justify-center min-h-[40vh]">
        <EmptyStage onFocusInput={() => inputBarRef?.focus()} />
      </div>
    {/if}
  </div>

  {#if $stageStore.lastSubmitError}
    <div
      class="absolute bottom-28 left-1/2 -translate-x-1/2 z-30 max-w-xl px-4 text-center font-mono text-[10px] text-error"
      role="alert"
    >
      {$stageStore.lastSubmitError}
    </div>
  {/if}

  <BottomInputBar
    bind:this={inputBarRef}
    loading={$stageStore.submitting}
    onSubmit={(prompt) => void stageStore.submitPrompt(prompt)}
  />
</div>
