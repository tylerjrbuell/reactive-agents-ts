<script lang="ts">
  /**
   * One sub-agent's own transcript in the kit drawer (scrim, Esc, focus trap, focus
   * returns to the card). Portaled to <body>: an animated chat turn (transform) would
   * otherwise trap `position: fixed`.
   */
  import { statusOfSubAgent, type SubAgentCard } from "@reactive-agents/ui-core";
  import type { ChatSubAgent } from "$lib/sub-agent-view.js";
  import ChatTranscript from "$lib/components/ChatTranscript.svelte";
  import Overlay from "$lib/components/kit/Overlay.svelte";
  import Status from "$lib/components/kit/Status.svelte";
  import { portal } from "$lib/actions/portal.js";

  interface Props {
    agent: ChatSubAgent;
    card: SubAgentCard;
    onClose: () => void;
  }
  const { agent, card, onClose }: Props = $props();
  const status = $derived(statusOfSubAgent(card.state));
  const label = $derived(card.state === "abstained" ? "Declined" : status.label);
  const empty = $derived(
    (agent.turn.toolCalls?.length ?? 0) === 0 && (agent.turn.reasoningSteps?.length ?? 0) === 0 && !agent.turn.content && !agent.turn.subAgents?.length,
  );
</script>

<div use:portal={typeof document !== "undefined" ? document.body : undefined}>
  <Overlay open kind="drawer" title={card.title} width={420} onclose={onClose} class="sub-agent-drawer">
    <div class="body" data-testid="sub-agent-drawer">
      <p class="meta">
        <Status tone={status.tone} {label} />
        {#if card.strategy}<span class="chip">{card.strategy}</span>{/if}
        {#if card.meta}<span class="chip data">{card.meta}</span>{/if}
      </p>
      {#if empty}
        <p class="empty">{card.state === "running" ? "Starting. Its work shows here as it runs." : "This agent left no transcript."}</p>
      {:else}
        <ChatTranscript turn={agent.turn} />
      {/if}
    </div>
  </Overlay>
</div>

<style>
  .body { display: grid; gap: 16px; }
  .meta { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 0; padding-bottom: 12px; border-bottom: 1px solid var(--cortex-line); }
  .chip {
    display: inline-flex;
    align-items: center;
    height: 22px;
    padding: 0 7px;
    border-radius: var(--cortex-r-chip);
    background: var(--cortex-surface-2);
    color: var(--cortex-text-2);
    font-size: var(--cortex-t-xs);
  }
  .chip.data { font-family: var(--cortex-font-data); font-size: var(--cortex-t-2xs); }
  .empty { margin: 0; font-size: var(--cortex-t-sm); color: var(--cortex-text-2); }
  /* The transcript reads a size down inside the drawer. */
  .body :global(.prose) { font-size: var(--cortex-t-sm); }
</style>
