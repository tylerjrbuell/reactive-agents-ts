<script lang="ts">
  import type { AgentNode } from "$lib/stores/agent-store.js";
  import { AGENT_STATE_COLORS } from "$lib/constants.js";
  import { goto } from "$app/navigation";

  interface Props {
    agent: AgentNode;
  }
  let { agent }: Props = $props();

  const stateColor = $derived(AGENT_STATE_COLORS[agent.state] ?? AGENT_STATE_COLORS.idle);
  const isRunning = $derived(
    agent.state === "running" || agent.state === "exploring" || agent.state === "stressed",
  );
  const isCompleted = $derived(agent.state === "completed");
  const isError = $derived(agent.state === "error");
  const isIdle = $derived(agent.state === "idle");

  function handleClick() {
    void goto(`/run/${agent.runId}`);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleClick();
    }
  }

  const stateIcon: Record<string, string> = {
    running: "science",
    exploring: "psychology",
    stressed: "warning",
    completed: "check_circle",
    error: "error",
    idle: "schedule",
  };

  const stateLabel: Record<string, string> = {
    running: "RUNNING",
    exploring: "EXPLORING",
    stressed: "STRESSED",
    completed: "SETTLED",
    error: "HALTED",
    idle: "IDLE",
  };

  const stateLabelClass: Record<string, string> = {
    running: "text-primary",
    exploring: "text-tertiary",
    stressed: "text-error",
    completed: "text-secondary",
    error: "text-error",
    idle: "text-outline",
  };

  function barHeightPct(i: number): number {
    return 40 + ((i * 7) % 36);
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
  class="relative p-6 rounded-xl flex flex-col items-center justify-center min-h-[280px] cursor-pointer transition-all duration-300 group outline-none focus-visible:ring-2 focus-visible:ring-primary/50 {isRunning
    ? 'gradient-border-glow shadow-neural'
    : ''} {isCompleted
    ? 'bg-surface-container-low border border-secondary/10 hover:border-secondary/30'
    : ''} {isError ? 'bg-surface-container-low border border-error/10' : ''} {isIdle
    ? 'bg-surface-container-lowest border border-outline-variant/5 opacity-60'
    : ''} {!isRunning && !isCompleted && !isError && !isIdle
    ? 'bg-surface-container-low border border-outline-variant/10'
    : ''} hover:scale-[1.02]"
  style="--ring-color: {stateColor.ring};"
  onclick={handleClick}
  onkeydown={handleKeydown}
  role="button"
  tabindex="0"
>
  {#if isRunning}
    <div class="relative w-24 h-24 mb-6 flex items-center justify-center">
      <div class="sonar-ring w-full h-full absolute"></div>
      <div class="sonar-ring w-full h-full absolute"></div>
      <div class="sonar-ring w-full h-full absolute"></div>
      <div
        class="w-12 h-12 rounded-full flex items-center justify-center border relative z-10 {agent.state ===
        'stressed'
          ? 'bg-error/20 border-error'
          : ''} {agent.state === 'exploring' ? 'bg-tertiary/20 border-tertiary' : ''} {agent.state === 'running'
          ? 'bg-primary/20 border-primary'
          : ''}"
        style="box-shadow: 0 0 20px {stateColor.glow};"
      >
        <span
          class="material-symbols-outlined {agent.state === 'stressed'
            ? 'text-error'
            : ''} {agent.state === 'exploring' ? 'text-tertiary' : ''} {agent.state === 'running'
            ? 'text-primary'
            : ''}"
          style="font-variation-settings: 'FILL' 1;"
        >
          {stateIcon[agent.state] ?? "science"}
        </span>
      </div>
    </div>
  {:else}
    <div
      class="w-12 h-12 rounded-full flex items-center justify-center border mb-6 transition-all duration-300 {isCompleted
        ? 'bg-secondary/10 border-secondary/40 group-hover:shadow-glow-secondary'
        : ''} {isError ? 'bg-error/10 border-error/40' : ''} {isIdle
        ? 'bg-surface-container-highest border-outline-variant/20'
        : ''}"
    >
      <span
        class="material-symbols-outlined {isCompleted ? 'text-secondary' : ''} {isError
          ? 'text-error'
          : ''} {isIdle ? 'text-outline' : ''}"
      >
        {stateIcon[agent.state] ?? "hub"}
      </span>
    </div>
  {/if}

  <div class="text-center">
    <span
      class="font-mono text-[10px] uppercase tracking-[0.2em] block mb-1 {stateLabelClass[agent.state] ??
        'text-outline'}"
    >
      {stateLabel[agent.state] ?? agent.state.toUpperCase()}
    </span>
    <h3 class="font-headline text-sm font-bold {isIdle ? 'text-on-surface-variant' : 'text-on-surface'}">
      {agent.name}
    </h3>

    {#if isRunning && agent.maxIterations > 0}
      <div class="mt-4 flex gap-1 justify-center items-end h-5">
        {#each Array(Math.min(agent.iteration, 8)) as _, i (i)}
          <div
            class="w-1 rounded-full transition-all {agent.state === 'running'
              ? 'bg-primary'
              : ''} {agent.state === 'exploring' ? 'bg-tertiary' : ''} {agent.state === 'stressed'
              ? 'bg-error'
              : ''}"
            style="height: {barHeightPct(i)}%; opacity: {0.4 + (i / 8) * 0.6};"
          ></div>
        {/each}
      </div>
      <div class="mt-2 text-[10px] font-mono text-outline">
        iter {agent.iteration}/{agent.maxIterations}
      </div>
    {/if}

    <!-- Tokens: show for any state when we have real data -->
    {#if agent.tokensUsed > 0}
      <div class="mt-3 text-[10px] font-mono {isCompleted ? 'text-outline' : 'text-outline/60'}">
        {agent.tokensUsed.toLocaleString()} tok
        {#if agent.cost > 0} · ${agent.cost.toFixed(4)}{/if}
      </div>
    {/if}

    {#if isError}
      <div
        class="mt-4 text-[10px] font-mono px-2 py-0.5 bg-error/10 text-error rounded border border-error/20 uppercase"
      >
        Halted
      </div>
    {/if}

    {#if isIdle}
      <div class="mt-4 text-xs font-mono text-on-surface-variant/60">
        {agent.name}
      </div>
    {/if}
  </div>
</div>
