<script lang="ts">
  import { onMount } from "svelte";
  import type { SubAgentCard } from "@reactive-agents/ui-core";
  import type { ChatSubAgent } from "$lib/sub-agent-view.js";
  import ChatTranscript from "$lib/components/ChatTranscript.svelte";

  interface Props {
    agent: ChatSubAgent;
    card: SubAgentCard;
    onClose: () => void;
  }
  const { agent, card, onClose }: Props = $props();

  const STATE_LABEL = { running: "Running", done: "Done", failed: "Failed", abstained: "Declined" } as const;
  let panel = $state<HTMLElement | null>(null);

  /** Mount the panel on <body>: an animated chat bubble (transform) would otherwise trap `position: fixed`. */
  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return { destroy: () => node.remove() };
  }

  onMount(() => {
    const prev = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      prev?.focus();
    };
  });
</script>

<div use:portal class="layer">
  <button type="button" class="scrim" aria-label="Close sub-agent panel" onclick={onClose}></button>
  <div bind:this={panel} class="panel" role="dialog" aria-modal="true" aria-label={`Sub-agent ${card.title}`} tabindex="-1" data-testid="sub-agent-drawer">
    <header class="head" data-state={card.state}>
      <span class="dot" aria-hidden="true"></span>
      <div class="id">
        <h2 class="title">{card.title}</h2>
        <p class="sub">{STATE_LABEL[card.state]} · {card.meta}{card.strategy ? ` · ${card.strategy}` : ""}</p>
      </div>
      <button type="button" class="close" onclick={onClose} aria-label="Close">
        <span class="material-symbols-outlined" aria-hidden="true">close</span>
      </button>
    </header>
    <div class="body">
      {#if (agent.turn.toolCalls?.length ?? 0) === 0 && (agent.turn.reasoningSteps?.length ?? 0) === 0 && !agent.turn.content && !agent.turn.subAgents?.length}
        <p class="empty">{card.state === "running" ? "Starting. Its work shows here as it runs." : "This agent left no transcript."}</p>
      {:else}
        <ChatTranscript turn={agent.turn} />
      {/if}
    </div>
  </div>
</div>

<style>
  .layer { position: fixed; inset: 0; z-index: 60; display: flex; justify-content: flex-end; }
  .scrim { position: absolute; inset: 0; border: 0; background: rgb(0 0 0 / 0.28); cursor: default; }
  .panel {
    position: relative;
    display: flex;
    flex-direction: column;
    width: min(34rem, 92vw);
    height: 100%;
    background: var(--cortex-surface, var(--cortex-surface-low));
    border-left: 1px solid var(--cortex-border);
    color: var(--cortex-text);
    outline: none;
  }
  .head {
    --tone: var(--cortex-text-muted);
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem 0.875rem;
    border-bottom: 1px solid var(--cortex-border);
  }
  .head[data-state="running"] { --tone: var(--cortex-accent); }
  .head[data-state="failed"] { --tone: var(--cortex-bad); }
  .head[data-state="abstained"] { --tone: var(--cortex-warn); }
  .dot { width: 8px; height: 8px; flex: none; border-radius: 9999px; background: var(--tone); }
  .id { min-width: 0; flex: 1; }
  .title { margin: 0; font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sub { margin: 0.125rem 0 0; font-family: ui-monospace, monospace; font-size: 10px; color: var(--cortex-text-muted); font-variant-numeric: tabular-nums; }
  .close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1.75rem;
    height: 1.75rem;
    border: 0;
    border-radius: 6px;
    background: none;
    color: var(--cortex-text-muted);
    cursor: pointer;
  }
  .close:hover { background: var(--cortex-surface-mid); color: var(--cortex-text); }
  .close:focus-visible { outline: 2px solid var(--cortex-focus); }
  .close .material-symbols-outlined { font-size: 18px; }
  .body { flex: 1; overflow-y: auto; padding: 0.75rem 0.875rem 1.5rem; }
  .empty { margin: 0; font-size: 11px; color: var(--cortex-text-muted); }
  @media (prefers-reduced-motion: no-preference) {
    .panel { animation: drawer-in 180ms ease-out; }
  }
  @keyframes drawer-in { from { transform: translateX(1.5rem); opacity: 0; } }
</style>
