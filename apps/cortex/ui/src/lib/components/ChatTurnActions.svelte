<script module lang="ts">
  export interface TurnAction {
    readonly label: string;
    readonly icon: string;
    readonly run: () => void | Promise<void>;
  }
</script>

<script lang="ts">
  import type { ChatTurn } from "$lib/stores/chat-store.js";
  import { clock } from "$lib/stores/clock.js";
  import { absoluteTime, relativeTime, strategyChip, turnTiming } from "$lib/chat-turn-meta.js";
  import Tooltip from "$lib/components/Tooltip.svelte";
  import ChatElapsed from "$lib/components/ChatElapsed.svelte";

  interface Props {
    turn: ChatTurn;
    /** Hover actions (copy is built in); hidden while a run goes. */
    actions?: readonly TurnAction[];
    showActions?: boolean;
    /** Text the copy button copies; no copy button when absent. */
    copyText?: string;
    onCopy?: (text: string) => void | Promise<void>;
    /** Strategy id → display name (the quick bar catalog). */
    strategyLabel?: (id: string) => string;
  }
  const { turn, actions = [], showActions = true, copyText, onCopy, strategyLabel }: Props = $props();

  const assistant = $derived(turn.role === "assistant");
  // Status tick: done, failed, or stopped. Nothing while the reply streams.
  const status = $derived(
    !assistant || turn.streaming
      ? undefined
      : turn.runFailed || turn.incomplete
        ? turn.cancelled
          ? { icon: "stop_circle", tone: "muted", label: "Stopped" }
          : { icon: "error", tone: "error", label: "Did not finish" }
        : { icon: "check", tone: "ok", label: "Finished" },
  );
  const strategy = $derived(assistant && !turn.streaming ? strategyChip(turn, strategyLabel) : undefined);
  const hasTime = $derived(turn.ts > 0);
  const timing = $derived(turnTiming(turn, $clock));
</script>

<div class="turn-actions {assistant ? '' : 'justify-end'}" data-testid="turn-actions">
  {#if status}
    <span class="material-symbols-outlined tick" data-tone={status.tone} aria-label={status.label} title={status.label}>{status.icon}</span>
  {/if}
  {#if assistant && turn.streaming && hasTime}
    <span class="when"><ChatElapsed since={turn.ts} /></span>
  {:else if assistant}
    {#if timing.ran}<span class="when" data-testid="turn-duration">{timing.ran}</span>{/if}
    {#if timing.finished}
      <time class="when" datetime={new Date(timing.finished.at).toISOString()} title={timing.finished.absolute}>{timing.ran ? "finished " : ""}{timing.finished.relative}</time>
    {/if}
  {:else if hasTime}
    <time class="when" datetime={new Date(turn.ts).toISOString()} title={absoluteTime(turn.ts)}>{relativeTime(turn.ts, Math.max($clock, turn.ts))}</time>
  {/if}
  {#if strategy}
    <span class="strategy" title={strategy.title} data-testid="turn-strategy">{strategy.label}</span>
  {/if}
  {#if showActions}
    <span class="buttons">
      {#if copyText !== undefined && onCopy}
        <Tooltip text="Copy"><button type="button" class="act" aria-label="Copy message" onclick={() => void onCopy(copyText)}>
          <span class="material-symbols-outlined" aria-hidden="true">content_copy</span>
        </button></Tooltip>
      {/if}
      {#each actions as action (action.label)}
        <Tooltip text={action.label}><button type="button" class="act" aria-label={action.label} onclick={() => void action.run()}>
          <span class="material-symbols-outlined" aria-hidden="true">{action.icon}</span>
        </button></Tooltip>
      {/each}
    </span>
  {/if}
</div>

<style>
  .turn-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.375rem;
    margin-top: 0.375rem;
    min-height: 1.25rem;
    font-family: ui-monospace, monospace;
    font-size: 9.5px;
    color: var(--cortex-text-muted);
  }
  .tick { font-size: 12px; line-height: 1; }
  .tick[data-tone="ok"] { color: var(--color-secondary, #7ee3c3); }
  .tick[data-tone="error"] { color: var(--color-error, #ff6b6b); }
  .when { font-variant-numeric: tabular-nums; cursor: default; }
  .strategy {
    padding: 0 0.3125rem;
    border: 1px solid var(--cortex-border);
    border-radius: 4px;
    line-height: 1.5;
    cursor: default;
  }
  .buttons {
    display: inline-flex;
    align-items: center;
    gap: 0.125rem;
    opacity: 0;
    transition: opacity 120ms;
  }
  :global(.group:hover) .buttons,
  .buttons:focus-within { opacity: 1; }
  .act {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.375rem;
    height: 1.375rem;
    border: 0;
    border-radius: 5px;
    background: none;
    color: var(--cortex-text-muted);
    cursor: pointer;
  }
  .act:hover { background: var(--cortex-surface-mid); color: var(--cortex-text); }
  .act:focus-visible { outline: 2px solid var(--color-secondary, #7ee3c3); }
  .act .material-symbols-outlined { font-size: 14px; line-height: 1; }
  @media (hover: none) {
    .buttons { opacity: 1; }
  }
  @media (prefers-reduced-motion: reduce) {
    .buttons { transition: none; }
  }
</style>
