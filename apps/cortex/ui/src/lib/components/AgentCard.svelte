<script lang="ts">
  import type { AgentNode } from "$lib/stores/agent-store.js";
  import { agentRunDeskTooltipText } from "$lib/stores/agent-store.js";
  import Tooltip from "$lib/components/Tooltip.svelte";
  import { AGENT_STATE_COLORS } from "$lib/constants.js";
  import { goto } from "$app/navigation";
  import { toast } from "$lib/stores/toast-store.js";

  interface Props {
    agent: AgentNode;
    parentRunId?: string;
  }
  let { agent, parentRunId }: Props = $props();

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

  function handleRunIdClick(e: Event) {
    e.stopPropagation();
    navigator.clipboard.writeText(agent.runId).then(() => {
      toast.success("Run ID copied", agent.runId);
    });
  }

  function handleRunIdKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleRunIdClick(e);
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
    running: "Running",
    exploring: "Exploring",
    stressed: "Stressed",
    completed: "Settled",
    error: "Halted",
    idle: "Idle",
  };

  const statePillClass: Record<string, string> = {
    running:
      "border-violet-400/55 dark:border-primary/60 bg-violet-100 dark:bg-primary/22 text-violet-900 dark:text-violet-200 shadow-sm dark:shadow-[0_0_12px_rgba(139,92,246,0.45)]",
    exploring:
      "border-amber-500/45 dark:border-amber-400/55 bg-amber-100 dark:bg-amber-500/20 text-amber-900 dark:text-amber-200 shadow-sm dark:shadow-[0_0_10px_rgba(234,179,8,0.35)]",
    stressed:
      "border-red-400/50 dark:border-red-400/55 bg-red-50 dark:bg-red-500/18 text-red-800 dark:text-red-200 shadow-sm dark:shadow-[0_0_12px_rgba(239,68,68,0.4)]",
    completed:
      "border-cyan-500/45 dark:border-cyan-400/50 bg-cyan-100 dark:bg-cyan-500/15 text-cyan-900 dark:text-cyan-200 shadow-sm dark:shadow-[0_0_10px_rgba(6,182,212,0.35)]",
    error:
      "border-red-500/50 dark:border-red-500/60 bg-red-100 dark:bg-red-600/20 text-red-900 dark:text-red-100 shadow-sm dark:shadow-[0_0_12px_rgba(239,68,68,0.45)]",
    idle:
      "border-slate-300/80 dark:border-violet-900/50 bg-slate-100/90 dark:bg-surface-container-high/50 text-slate-600 dark:text-violet-300/80",
  };

  const accentBarClass = $derived.by(() => {
    if (agent.state === "running") return "bg-gradient-to-b from-primary via-primary/70 to-secondary";
    if (agent.state === "exploring") return "bg-gradient-to-b from-tertiary to-tertiary/60";
    if (agent.state === "stressed") return "bg-gradient-to-b from-error to-error/70";
    if (agent.state === "completed") return "bg-gradient-to-b from-secondary to-secondary/60";
    if (agent.state === "error") return "bg-gradient-to-b from-error to-error/60";
    return "bg-outline-variant/45";
  });

  function barHeightPct(i: number): number {
    return 40 + ((i * 7) % 36);
  }

  const runIdShort = $derived(
    agent.runId.length > 10 ? `${agent.runId.slice(0, 6)}…${agent.runId.slice(-4)}` : agent.runId,
  );

  const runTooltip = $derived(agentRunDeskTooltipText(agent));
</script>

<Tooltip text={runTooltip} placement="top" class="flex h-full min-h-[132px] w-full min-w-0">
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
  class="group relative flex h-full min-h-[132px] rounded-lg text-left outline-none transition-all duration-200
         bg-gradient-to-br from-white/95 via-violet-50/35 to-slate-100/92
         dark:from-surface-container-low/70 dark:via-[#14161f]/90 dark:to-[#0f1118]/90
         shadow-[0_0_0_1px_rgba(124,58,237,0.18),0_0_0_1px_rgba(255,255,255,0.45)_inset]
         hover:shadow-[0_0_0_1px_rgba(124,58,237,0.32),0_8px_22px_rgba(124,58,237,0.1)]
         dark:shadow-[0_0_0_1px_rgba(139,92,246,0.22),0_0_0_1px_rgba(6,182,212,0.06)_inset]
         dark:hover:shadow-[0_0_0_1px_rgba(139,92,246,0.45),0_0_20px_rgba(139,92,246,0.12)]
         {isRunning
    ? 'shadow-[0_0_0_1px_rgba(124,58,237,0.32),0_6px_20px_rgba(124,58,237,0.12)] dark:shadow-[0_0_0_1px_rgba(139,92,246,0.5),0_0_24px_rgba(6,182,212,0.15),inset_0_0_20px_rgba(139,92,246,0.06)]'
    : ''}
         {isCompleted
    ? 'hover:shadow-[0_0_0_1px_rgba(6,182,212,0.35),0_8px_18px_rgba(6,182,212,0.1)] dark:hover:shadow-[0_0_0_1px_rgba(6,182,212,0.4),0_0_16px_rgba(6,182,212,0.12)]'
    : ''}
         {isError
    ? 'shadow-[0_0_0_1px_rgba(220,38,38,0.3),0_6px_16px_rgba(239,68,68,0.1)] dark:shadow-[0_0_0_1px_rgba(239,68,68,0.35),0_0_16px_rgba(239,68,68,0.12)]'
    : ''}
         {isIdle ? 'opacity-[0.78] hover:opacity-95' : ''}"
  style="--glow: {stateColor.glow};"
  onclick={handleClick}
  onkeydown={handleKeydown}
  role="button"
  tabindex="0"
>
  <div class="w-1 self-stretch shrink-0 rounded-l-lg {accentBarClass}" aria-hidden="true"></div>

  <div class="flex flex-1 min-w-0 gap-3 p-3 sm:p-3.5">
    <div class="relative shrink-0 w-11 h-11 sm:w-12 sm:h-12">
      {#if isRunning}
        <div class="absolute inset-0 flex items-center justify-center pointer-events-none opacity-40">
          <div class="sonar-ring w-[88%] h-[88%] absolute" style="--ring-color: {stateColor.ring};"></div>
          <div class="sonar-ring w-[88%] h-[88%] absolute" style="--ring-color: {stateColor.ring};"></div>
        </div>
      {/if}
      <div
        class="relative z-10 w-full h-full rounded-lg flex items-center justify-center border transition-colors
               {isRunning && agent.state === 'stressed'
          ? 'bg-error/15 border-error/35'
          : ''} {isRunning && agent.state === 'exploring'
          ? 'bg-tertiary/12 border-tertiary/35'
          : ''} {isRunning && agent.state === 'running'
          ? 'bg-primary/12 border-primary/35'
          : ''} {!isRunning && isCompleted
          ? 'bg-secondary/8 border-secondary/30'
          : ''} {!isRunning && isError
          ? 'bg-error/10 border-error/35'
          : ''} {!isRunning && isIdle
          ? 'bg-surface-container-highest/80 border-outline-variant/20'
          : ''} {!isRunning && !isCompleted && !isError && !isIdle
          ? 'bg-surface-container-high/50 border-outline-variant/20'
          : ''}"
        style={isRunning ? `box-shadow: 0 0 16px ${stateColor.glow};` : ""}
      >
        <span
          class="material-symbols-outlined text-[22px] sm:text-[24px] {isRunning && agent.state === 'stressed'
            ? 'text-error'
            : ''} {isRunning && agent.state === 'exploring'
            ? 'text-tertiary'
            : ''} {isRunning && agent.state === 'running'
            ? 'text-primary'
            : ''} {!isRunning && isCompleted
            ? 'text-secondary'
            : ''} {!isRunning && isError
            ? 'text-error'
            : ''} {!isRunning && isIdle
            ? 'text-outline'
            : ''}"
          style={isRunning ? "font-variation-settings: 'FILL' 1;" : ""}
        >
          {stateIcon[agent.state] ?? "hub"}
        </span>
      </div>
    </div>

    <div class="flex flex-1 min-w-0 flex-col gap-1.5">
      <div class="flex items-start justify-between gap-2">
        <span
          class="inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[9px] font-mono uppercase tracking-[0.14em] {statePillClass[
            agent.state
          ] ?? statePillClass.idle}"
        >
          {#if isRunning}
            <span class="w-1.5 h-1.5 rounded-full bg-current opacity-90 animate-pulse shrink-0"></span>
          {/if}
          {stateLabel[agent.state] ?? agent.state}
        </span>
        <span
          class="material-symbols-outlined text-slate-400 dark:text-secondary/50 text-lg shrink-0 transition-colors group-hover:text-cyan-700 dark:group-hover:text-cyan-300 dark:group-hover:drop-shadow-[0_0_6px_rgba(34,211,238,0.5)]"
          aria-hidden="true"
        >
          chevron_right
        </span>
      </div>

      <h3
        class="font-display text-sm font-semibold leading-snug truncate {isIdle
          ? 'text-on-surface-variant'
          : 'text-on-surface'}"
      >
        {agent.name}
      </h3>

      <p
        class="font-mono text-[10px] text-outline/55 truncate cursor-pointer hover:text-primary hover:drop-shadow-[0_0_4px_rgba(139,92,246,0.3)] transition-colors"
        title={agent.runId}
        role="button"
        tabindex="0"
        onclick={handleRunIdClick}
        onkeydown={handleRunIdKeydown}
      >
        <span class="text-outline/40">run</span>
        {runIdShort}
      </p>

      {#if isRunning && agent.maxIterations > 0}
        <div class="flex gap-1 items-end h-4 mt-0.5">
          {#each Array(Math.min(agent.loopIteration, 12)) as _, i (i)}
            <div
              class="w-0.5 rounded-full transition-all {agent.state === 'running'
                ? 'bg-primary'
                : ''} {agent.state === 'exploring' ? 'bg-tertiary' : ''} {agent.state === 'stressed'
                ? 'bg-error'
                : ''}"
              style="height: {barHeightPct(i)}%; opacity: {0.35 + (i / 12) * 0.65};"
            ></div>
          {/each}
        </div>
        <p class="text-[10px] font-mono text-outline/50">
          loop {agent.loopIteration}/{agent.maxIterations}{#if agent.reasoningSteps > agent.loopIteration}
            <span class="text-outline/40"> · steps {agent.reasoningSteps}</span>{/if}
        </p>
      {/if}

      <div class="flex flex-wrap gap-1 mt-auto pt-0.5">
        {#if agent.provider}
          <span
            class="px-1.5 py-0.5 rounded-md border border-cyan-600/25 dark:border-secondary/45 bg-cyan-100 dark:bg-cyan-950/40 text-[8px] font-mono text-cyan-900 dark:text-cyan-200/90 uppercase tracking-wide shadow-sm dark:shadow-[0_0_8px_rgba(6,182,212,0.15)]"
          >
            {agent.provider}
          </span>
        {/if}
        {#if agent.model}
          <span
            class="px-1.5 py-0.5 rounded-md border border-violet-400/40 dark:border-primary/50 bg-violet-100 dark:bg-violet-950/35 text-[8px] font-mono text-violet-900 dark:text-violet-200 max-w-[140px] truncate shadow-sm dark:shadow-[0_0_8px_rgba(139,92,246,0.2)]"
            title={agent.model}
          >
            {agent.model}
          </span>
        {/if}
        {#if agent.strategy}
          <span
            class="px-1.5 py-0.5 rounded-md border border-cyan-500/35 dark:border-cyan-500/40 bg-cyan-50 dark:bg-cyan-950/30 text-[8px] font-mono text-cyan-900 dark:text-cyan-200/95 max-w-[120px] truncate shadow-sm dark:shadow-[0_0_6px_rgba(34,211,238,0.15)]"
            title={agent.strategy}
          >
            {agent.strategy}
          </span>
        {/if}
      </div>

      {#if agent.tokensUsed > 0}
        <p class="text-[10px] font-mono text-outline/55">
          {agent.tokensUsed.toLocaleString()} tok{#if agent.cost > 0}
            <span class="text-outline/45"> · ${agent.cost.toFixed(4)}</span>{/if}
        </p>
      {/if}

      {#if isError}
        <p class="text-[10px] font-mono text-error/90 border border-error/20 bg-error/5 rounded px-2 py-0.5 w-fit">
          Run halted — open trace
        </p>
      {/if}
    </div>
  </div>
</div>
</Tooltip>
