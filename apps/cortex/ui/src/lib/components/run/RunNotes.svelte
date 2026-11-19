<script lang="ts">
  /**
   * Quiet notes under a finished turn or run: a finish the strategy accepted, an answer written
   * from tool results the model had not read, and the to-do outcome (rows the harness closed from
   * evidence, rows that ended with no evidence). Informational and muted, never an error. Display
   * model: `runNotesView` in `$lib/run-notes-view.ts`; renders nothing when there is nothing to say.
   */
  import type { RunNotes } from "@reactive-agents/ui-core";
  import { runNotesView } from "$lib/run-notes-view.js";
  import Icon from "$lib/components/kit/Icon.svelte";

  interface Props {
    notes: RunNotes | undefined;
  }
  const { notes }: Props = $props();
  const view = $derived(runNotesView(notes));
</script>

{#if view}
  <div class="notes" data-testid="run-notes" role="note">
    {#if view.accepted}
      <p class="line" data-testid="run-note-accepted"><span class="ico ok"><Icon name="check-circle" size="sm" /></span><span><strong>{view.accepted.heading}.</strong> {view.accepted.text}</span></p>
    {/if}
    {#if view.unread}
      <p class="line" data-testid="run-note-unread">
        <span class="ico"><Icon name="info" size="sm" /></span>
        <span>{view.unread.text}{#if view.unread.tools.length > 0} <span class="mono">({view.unread.tools.join(", ")})</span>{/if}</span>
      </p>
    {/if}
    {#if view.checklist}
      <div class="todo" data-testid="run-note-todo">
        <p class="line"><span class="ico"><Icon name="checklist" size="sm" /></span><span><strong>{view.checklist.summary}</strong>{#if view.checklist.unresolvedLine} · {view.checklist.unresolvedLine}{/if}</span></p>
        {#if view.checklist.closed.length > 0}
          <ul class="rows" data-testid="run-note-closed">
            {#each view.checklist.closed as r (r.id)}
              <li><span class="t">{r.title}</span><span class="why"> · {r.note}</span></li>
            {/each}
          </ul>
        {/if}
        {#if view.checklist.unresolved.length > 0}
          <p class="sub">Unresolved</p>
          <ul class="rows" data-testid="run-note-unresolved">
            {#each view.checklist.unresolved as r (r.id)}
              <li><span class="t">{r.title}</span><span class="why"> · {r.note}</span></li>
            {/each}
          </ul>
        {/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  .notes {
    display: grid;
    gap: 6px;
    max-width: var(--cortex-measure);
    padding: 10px 14px;
    border-radius: var(--cortex-r-ctl);
    background: var(--cortex-surface-2);
    font-family: var(--cortex-font-ui);
    font-size: var(--cortex-t-sm);
    line-height: var(--cortex-lh-ui);
    color: var(--cortex-text-2);
  }
  .line { display: flex; gap: 6px; align-items: flex-start; margin: 0; overflow-wrap: anywhere; }
  .line strong { font-weight: 600; color: var(--cortex-text); }
  .ico { display: inline-flex; flex: none; padding-top: 2px; color: var(--cortex-text-3); }
  .ico.ok { color: var(--cortex-ok); }
  .mono { font-family: var(--cortex-font-data); font-size: var(--cortex-t-xs); }
  .todo { display: grid; gap: 4px; }
  .sub { margin: 2px 0 0 20px; font-size: var(--cortex-t-xs); font-weight: 600; color: var(--cortex-text-2); }
  .rows { margin: 0; padding: 0 0 0 36px; display: grid; gap: 2px; font-size: var(--cortex-t-xs); }
  .t { color: var(--cortex-text); overflow-wrap: anywhere; }
  .why { color: var(--cortex-text-2); }
</style>
