<script lang="ts">
  import type { AgentNode } from "$lib/stores/agent-store.js";
  import { goto } from "$app/navigation";
  import { toast } from "$lib/stores/toast-store.js";

  interface Props {
    agent: AgentNode;
  }
  let { agent }: Props = $props();

  const isRunning = $derived(["running", "exploring", "stressed"].includes(agent.state));
  const isIdle = $derived(agent.state === "idle");

  type SV = { icon: string; color: string; glow: string; label: string };
  const stateVis: Record<string, SV> = {
    running:   { icon: "psychology",     color: "#a78bfa", glow: "rgba(139,92,246,0.5)",  label: "RUNNING"   },
    exploring: { icon: "travel_explore", color: "#fbbf24", glow: "rgba(245,158,11,0.45)", label: "EXPLORING" },
    stressed:  { icon: "crisis_alert",   color: "#f87171", glow: "rgba(239,68,68,0.5)",   label: "STRESSED"  },
    completed: { icon: "dataset",        color: "#22d3ee", glow: "rgba(6,182,212,0.4)",   label: "SETTLED"   },
    error:     { icon: "bug_report",     color: "#f87171", glow: "rgba(239,68,68,0.45)",  label: "ERROR"     },
    idle:      { icon: "schedule",       color: "#6b7280", glow: "none",                  label: "IDLE"      },
  };

  /* Light-mode icon/text color overrides — same hue, darker for contrast */
  const stateColorLight: Record<string, string> = {
    running:   "#6d28d9",
    exploring: "#b45309",
    stressed:  "#dc2626",
    completed: "#0e7490",
    error:     "#dc2626",
    idle:      "#94a3b8",
  };

  const sv = $derived(stateVis[agent.state] ?? stateVis.idle);

  const runIdShort = $derived(
    agent.runId.length > 10
      ? `${agent.runId.slice(0, 5)}…${agent.runId.slice(-3)}`
      : agent.runId,
  );

  function handleClick() { void goto(`/run/${agent.runId}`); }
  function copyId(e: MouseEvent) {
    e.stopPropagation();
    void navigator.clipboard.writeText(agent.runId).then(() =>
      toast.success("Copied", agent.runId),
    );
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
  class="beacon-node flex flex-col items-center gap-2 cursor-pointer group select-none outline-none"
  class:node-live={isRunning}
  class:node-idle={isIdle}
  role="button"
  tabindex="0"
  onclick={handleClick}
  onkeydown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleClick(); } }}
  title="Open run {agent.runId}"
  style="--sv-color: {sv.color}; --sv-glow: {sv.glow}; --sv-color-light: {stateColorLight[agent.state] ?? stateColorLight.idle};"
>
  <!-- Icon box -->
  <div class="node-box relative w-[64px] h-[64px]">
    {#if isRunning}
      <div class="scan-ring absolute inset-[-8px] rounded-[18px] pointer-events-none"></div>
    {/if}

    <div class="node-box-inner relative z-10 w-full h-full rounded-[14px] flex items-center justify-center border transition-transform duration-200 group-hover:scale-[1.07]">
      <span
        class="node-icon material-symbols-outlined text-[28px] transition-all duration-300"
        style="{isRunning ? 'font-variation-settings: \'FILL\' 1;' : 'opacity: 0.8;'}"
      >
        {sv.icon}
      </span>
    </div>
  </div>

  <!-- Labels -->
  <div class="text-center w-[120px]">
    <p class="node-name font-mono text-[8px] uppercase tracking-[0.17em] leading-tight truncate">
      {agent.name}
    </p>
    <p class="node-status font-mono text-[7px] uppercase tracking-[0.12em] mt-0.5 leading-tight">
      STATUS: {sv.label}
    </p>

    {#if isRunning && agent.maxIterations > 0}
      <div class="mt-1.5 flex gap-px items-end h-[10px] justify-center">
        {#each Array(Math.min(agent.loopIteration, 10)) as _, i (i)}
          <div
            class="node-bar-filled w-[2px] rounded-full"
            style="height: {30 + ((i * 11) % 50)}%; opacity: {0.28 + (i / 10) * 0.72};"
          ></div>
        {/each}
        {#each Array(Math.max(0, Math.min(10, agent.maxIterations) - Math.min(agent.loopIteration, 10))) as _, i (i)}
          <div
            class="node-bar-empty w-[2px] rounded-full"
            style="height: {30 + (((agent.loopIteration + i) * 11) % 50)}%;"
          ></div>
        {/each}
      </div>
      <p class="node-iter font-mono text-[7px] tabular-nums mt-0.5">
        {agent.loopIteration}/{agent.maxIterations}
      </p>
    {/if}

    {#if agent.tokensUsed > 0 && !isIdle}
      <p class="node-tokens font-mono text-[7px] tabular-nums mt-0.5">
        {agent.tokensUsed >= 1000 ? `${(agent.tokensUsed / 1000).toFixed(1)}k tok` : `${agent.tokensUsed} tok`}
      </p>
    {/if}
  </div>

  <button
    type="button"
    class="node-runid font-mono text-[6.5px] tabular-nums tracking-widest pointer-events-auto transition-colors"
    onclick={copyId}
    title="Click to copy run ID"
  >{runIdShort}</button>
</div>

<style>
  /* ── Node box surface — adaptive light/dark ── */
  .node-box-inner {
    background: color-mix(in srgb, var(--sv-color) 10%, #1e2130);
    border-color: color-mix(in srgb, var(--sv-color) 38%, transparent);
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.5);
  }
  :global(html:not(.dark)) .node-box-inner {
    background: color-mix(in srgb, var(--sv-color) 7%, #ffffff);
    border-color: color-mix(in srgb, var(--sv-color) 30%, rgba(0,0,0,0.06));
    box-shadow: 0 1px 6px rgba(0, 0, 0, 0.08), 0 0 0 1px rgba(0,0,0,0.04);
  }

  /* Running glow */
  .node-live .node-box-inner {
    box-shadow:
      0 0 0 1px color-mix(in srgb, var(--sv-color) 28%, transparent),
      0 0 16px var(--sv-glow);
  }
  :global(html:not(.dark)) .node-live .node-box-inner {
    box-shadow:
      0 2px 8px rgba(0, 0, 0, 0.1),
      0 0 0 1px color-mix(in srgb, var(--sv-color) 30%, transparent);
  }

  /* Icon color */
  .node-icon {
    color: var(--sv-color);
  }
  :global(html:not(.dark)) .node-icon {
    color: var(--sv-color-light);
  }
  .node-live .node-icon {
    filter: drop-shadow(0 0 5px var(--sv-glow));
  }
  :global(html:not(.dark)) .node-live .node-icon {
    filter: none;
  }

  /* Text */
  .node-name {
    color: rgba(203, 213, 225, 0.75);
  }
  :global(html:not(.dark)) .node-name {
    color: rgba(30, 41, 59, 0.72);
  }

  .node-status {
    color: color-mix(in srgb, var(--sv-color) 70%, transparent);
  }
  :global(html:not(.dark)) .node-status {
    color: color-mix(in srgb, var(--sv-color-light) 65%, transparent);
  }

  .node-bar-filled {
    background: var(--sv-color);
  }
  :global(html:not(.dark)) .node-bar-filled {
    background: var(--sv-color-light);
  }

  .node-bar-empty {
    background: rgba(100, 116, 139, 0.25);
  }
  :global(html:not(.dark)) .node-bar-empty {
    background: rgba(100, 116, 139, 0.18);
  }

  .node-iter,
  .node-tokens {
    color: rgba(71, 85, 105, 0.8);
  }
  :global(html:not(.dark)) .node-iter,
  :global(html:not(.dark)) .node-tokens {
    color: rgba(100, 116, 139, 0.7);
  }

  .node-runid {
    color: rgba(71, 85, 105, 0.7);
  }
  .node-runid:hover { color: #a78bfa; }
  :global(html:not(.dark)) .node-runid {
    color: rgba(148, 163, 184, 0.8);
  }
  :global(html:not(.dark)) .node-runid:hover { color: #6d28d9; }

  /* ── Float animation for live nodes ── */
  .node-live {
    animation: node-float 4s ease-in-out infinite;
  }
  .node-live:nth-child(2n) { animation-delay: -1.4s; animation-duration: 4.8s; }
  .node-live:nth-child(3n) { animation-delay: -2.2s; animation-duration: 5.2s; }
  @keyframes node-float {
    0%, 100% { transform: translateY(0); }
    50%       { transform: translateY(-5px); }
  }

  /* ── Scan ring ── */
  .scan-ring {
    border: 1px solid var(--sv-color);
    opacity: 0;
    animation: scan-pulse 2.4s ease-out infinite;
  }
  @keyframes scan-pulse {
    0%   { opacity: 0.4; transform: scale(0.9); }
    100% { opacity: 0;   transform: scale(1.3); }
  }
  :global(html:not(.dark)) .scan-ring {
    opacity: 0;
    animation: scan-pulse-light 2.4s ease-out infinite;
  }
  @keyframes scan-pulse-light {
    0%   { opacity: 0.25; transform: scale(0.9); }
    100% { opacity: 0;    transform: scale(1.3); }
  }

  /* ── Idle dimming ── */
  .node-idle {
    opacity: 0.45;
    filter: grayscale(0.45);
    transition: opacity 0.25s, filter 0.25s;
  }
  .node-idle:hover {
    opacity: 0.8;
    filter: grayscale(0);
  }
  :global(html:not(.dark)) .node-idle {
    opacity: 0.5;
    filter: grayscale(0.35);
  }
</style>
