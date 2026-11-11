<script lang="ts">
  /**
   * How a chat turn ended when it did not simply answer: a failed run's cause
   * (`ChatRunFailedNote`), an abstention's reason (a quiet decline, not a red
   * failure), a partial run's unfinished items, or the files a run produced when
   * its output is empty. Display model: `endingNote` in `$lib/turn-ending.ts`.
   * Renders nothing for a plain success.
   */
  import type { TurnOutcome } from "@reactive-agents/ui-core";
  import { endingNote } from "$lib/turn-ending.js";
  import ChatRunFailedNote from "$lib/components/ChatRunFailedNote.svelte";

  interface Props {
    outcome: TurnOutcome;
  }
  const { outcome }: Props = $props();
  const note = $derived(endingNote(outcome));
  const toneClass = $derived(note?.tone === "warn" ? "text-amber-800 dark:text-amber-300" : "text-[var(--cortex-text-muted)]");
</script>

{#if note?.kind === "failed"}
  <div data-testid="chat-run-ending" data-ending="failed"><ChatRunFailedNote error={outcome.error} /></div>
{:else if note}
  <div data-testid="chat-run-ending" data-ending={note.kind} class="mb-1.5 mt-1 font-mono text-[10px] leading-relaxed {toneClass}">
    <p class="m-0 flex items-start gap-1 break-words">
      <span class="material-symbols-outlined text-[13px] leading-none" aria-hidden="true">{note.icon}</span>
      <span><span class="font-semibold">{note.heading}{note.line || note.items.length > 0 ? ":" : ""}</span>{#if note.line}{" "}{note.line}{/if}</span>
    </p>
    {#if note.items.length > 0}
      <ul class="m-0 mt-0.5 list-none pl-[17px]">
        {#each note.items as item, i (i)}
          <li class="break-words before:mr-1 before:content-['–']">{item}</li>
        {/each}
      </ul>
    {/if}
  </div>
{/if}
