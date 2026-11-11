<script module lang="ts">
  import type { IconName } from "$lib/icons.js";
  import { tooltip } from "$lib/actions/tooltip.js";

  /** One action button under a turn (kit icon, label is the accessible name). */
  export interface TurnAction {
    readonly label: string;
    readonly icon: IconName;
    readonly run: () => void | Promise<void>;
  }
</script>

<script lang="ts">
  import type { ChatTurn } from "$lib/stores/chat-store.js";
  import { turnEnding } from "$lib/stores/chat-timeline.js";
  import { statusOfTurn, type StatusTone } from "@reactive-agents/ui-core";
  import { clock } from "$lib/stores/clock.js";
  import { absoluteTime, relativeTime, strategyChip, turnTiming } from "$lib/chat-turn-meta.js";
  import ChatElapsed from "$lib/components/ChatElapsed.svelte";
  import Icon from "$lib/components/kit/Icon.svelte";
  import IconButton from "$lib/components/kit/IconButton.svelte";

  interface Props {
    turn: ChatTurn;
    /** Hover actions (copy is built in); hidden while a run goes. */
    actions?: readonly TurnAction[];
    showActions?: boolean;
    /** Keep the buttons visible (the last turn), not only on hover or focus. */
    pinned?: boolean;
    /** Text the copy button copies; no copy button when absent. */
    copyText?: string;
    onCopy?: (text: string) => void | Promise<void>;
    /** Strategy id → display name (the quick bar catalog). */
    strategyLabel?: (id: string) => string;
    /** Show the strategy chip here (off when the turn header already shows it). */
    showStrategy?: boolean;
  }
  const { turn, actions = [], showActions = true, pinned = false, copyText, onCopy, strategyLabel, showStrategy = true }: Props = $props();

  const assistant = $derived(turn.role === "assistant");
  // Status tick from ui-core's one status vocabulary (done, attention, failed, stopped).
  // Nothing while the reply streams.
  const ICON: Record<StatusTone, IconName> = {
    running: "circle",
    attention: "info",
    done: "check",
    failed: "alert-circle",
    stopped: "stop",
    idle: "circle",
  };
  const status = $derived.by(() => {
    if (!assistant || turn.streaming) return undefined;
    const view = statusOfTurn(turnEnding(turn));
    return { icon: ICON[view.tone], tone: view.tone, label: view.label };
  });
  const strategy = $derived(assistant && !turn.streaming && showStrategy ? strategyChip(turn, strategyLabel) : undefined);
  const hasTime = $derived(turn.ts > 0);
  const timing = $derived(turnTiming(turn, $clock));
</script>

<div class="turn-actions" class:user={!assistant} class:pinned data-testid="turn-actions">
  {#if status}
    <span class="tick" data-tone={status.tone} role="img" aria-label={status.label} use:tooltip={status.label}><Icon name={status.icon} size="sm" /></span>
  {/if}
  {#if assistant && turn.streaming && hasTime}
    <span class="when"><ChatElapsed since={turn.ts} /></span>
  {:else if assistant}
    {#if timing.ran}<span class="when" data-testid="turn-duration">{timing.ran}</span>{/if}
    {#if timing.finished}
      <time class="when" datetime={new Date(timing.finished.at).toISOString()} use:tooltip={timing.finished.absolute}>{timing.ran ? "finished " : ""}{timing.finished.relative}</time>
    {/if}
  {:else if hasTime}
    <time class="when" datetime={new Date(turn.ts).toISOString()} use:tooltip={absoluteTime(turn.ts)}>{relativeTime(turn.ts, Math.max($clock, turn.ts))}</time>
  {/if}
  {#if strategy}
    <span class="strategy" use:tooltip={strategy.title} data-testid="turn-strategy">{strategy.label}</span>
  {/if}
  {#if showActions}
    <span class="buttons">
      {#if copyText !== undefined && onCopy}
        <IconButton icon="copy" size="sm" label={assistant ? "Copy answer" : "Copy message"} class="act" onclick={() => void onCopy(copyText)} />
      {/if}
      {#each actions as action (action.label)}
        <IconButton icon={action.icon} size="sm" label={action.label} class="act" onclick={() => void action.run()} />
      {/each}
    </span>
  {/if}
</div>

<style>
  .turn-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 2px 6px;
    min-height: 26px;
    font-size: var(--cortex-t-xs);
    color: var(--cortex-text-3);
  }
  .turn-actions.user { justify-content: flex-end; }
  .tick { display: inline-flex; }
  .tick[data-tone="done"] { color: var(--cortex-ok); }
  .tick[data-tone="failed"] { color: var(--cortex-bad); }
  .tick[data-tone="attention"] { color: var(--cortex-warn); }
  .when { font-variant-numeric: tabular-nums; cursor: default; }
  .strategy {
    padding: 0 6px;
    border-radius: var(--cortex-r-chip);
    background: var(--cortex-surface-2);
    color: var(--cortex-text-2);
    line-height: 20px;
    cursor: default;
  }
  .buttons {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    opacity: 0;
    transition: opacity var(--cortex-d-fast);
  }
  .buttons :global(.act) { width: 26px; height: 26px; }
  /* On hover or focus anywhere in the turn; always on the last turn (spec section 8). */
  :global(.chat-turn:hover) .buttons,
  :global(.chat-turn:focus-within) .buttons,
  .pinned .buttons,
  .buttons:focus-within { opacity: 1; }
  @media (hover: none) {
    .buttons { opacity: 1; }
  }
</style>
