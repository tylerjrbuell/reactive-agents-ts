<script lang="ts">
  /**
   * How a chat turn ended when it did not simply answer: a failed run's cause
   * (`ChatRunFailedNote`), an abstention's reason (a quiet decline, not a red
   * failure), a partial run's unfinished items, an interruption, or the files a run
   * produced when its output is empty. Display model: `endingNote` in
   * `$lib/turn-ending.ts`. Renders nothing for a plain success. Every state that
   * did not finish offers the next step (Retry) when the host passes `onRetry`.
   */
  import type { TurnOutcome } from "@reactive-agents/ui-core";
  import { endingNote } from "$lib/turn-ending.js";
  import ChatRunFailedNote from "$lib/components/ChatRunFailedNote.svelte";
  import Icon from "$lib/components/kit/Icon.svelte";
  import Button from "$lib/components/kit/Button.svelte";

  interface Props {
    outcome: TurnOutcome;
    /** Retry the turn (the latest one only). */
    onRetry?: () => void;
  }
  const { outcome, onRetry }: Props = $props();
  const note = $derived(endingNote(outcome));
</script>

{#if note?.kind === "failed"}
  <div data-testid="chat-run-ending" data-ending="failed"><ChatRunFailedNote error={outcome.error} {onRetry} /></div>
{:else if note}
  <div data-testid="chat-run-ending" data-ending={note.kind} data-tone={note.tone} class="ending" role="note">
    <p class="h"><Icon name={note.icon} size="sm" /><span>{note.heading}</span></p>
    {#if note.line}<p class="line">{note.line}</p>{/if}
    {#if note.items.length > 0}
      <ul>
        {#each note.items as item, i (i)}<li>{item}</li>{/each}
      </ul>
    {/if}
    {#if onRetry && note.kind !== "files"}
      <div class="acts"><Button size="sm" variant="ghost" icon="retry" onclick={onRetry}>Retry</Button></div>
    {/if}
  </div>
{/if}

<style>
  .ending {
    display: grid;
    gap: 6px;
    max-width: var(--cortex-measure);
    padding: 12px 14px;
    border-radius: var(--cortex-r-ctl);
    background: var(--cortex-surface-2);
    color: var(--cortex-text);
  }
  .ending[data-tone="warn"] { background: var(--cortex-warn-tint); }
  .h { display: flex; align-items: center; gap: 6px; margin: 0; font-size: var(--cortex-t-sm); font-weight: 600; color: var(--cortex-text-2); }
  .ending[data-tone="warn"] .h { color: var(--cortex-warn); }
  .line { margin: 0; font-size: var(--cortex-t-sm); line-height: var(--cortex-lh-ui); color: var(--cortex-text-2); overflow-wrap: anywhere; }
  ul { margin: 0; padding-left: 18px; font-size: var(--cortex-t-sm); color: var(--cortex-text-2); }
  li { overflow-wrap: anywhere; }
  .acts { display: flex; gap: 6px; margin-top: 2px; }
</style>
