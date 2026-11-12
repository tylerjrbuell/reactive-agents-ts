<script lang="ts">
  import Tooltip from "$lib/components/Tooltip.svelte";
  import Icon from "$lib/components/kit/Icon.svelte";
  import Button from "$lib/components/kit/Button.svelte";
  import { proposalView, type ProposalWire } from "$lib/proposal-view.js";

  interface Props {
    proposal: ProposalWire;
    busy: boolean;
    onApply: () => void;
    /** Reject a pending proposal (keeps it as a "Dismissed" row). */
    onDismiss: () => void;
    /** Take the banner out of the thread. */
    onRemove: () => void;
  }
  const { proposal, busy, onApply, onDismiss, onRemove }: Props = $props();

  const view = $derived(proposalView(proposal));
</script>

{#if view.settled}
  <!-- Applied / dismissed: one line, with a control to remove it. Text is escaped by Svelte; it is never rendered as HTML. -->
  <div class="proposal row" data-tone={view.tone} data-testid="chat-proposal" data-status={proposal.status}>
    <Icon name="agents" size="sm" />
    <Tooltip text={view.note ?? view.summary} class="min-w-0 flex-1">
      <span class="grow"><span class="action">{proposal.action}</span> {view.summary}</span>
    </Tooltip>
    <span class="status">{view.statusLabel}{view.note ? " (auto)" : ""}</span>
    <Tooltip text="Remove from the chat">
      <button type="button" class="x" disabled={busy} aria-label="Remove this proposal from the chat" onclick={onRemove}>
        <Icon name="x" size="sm" />
      </button>
    </Tooltip>
  </div>
{:else}
  <div class="proposal" data-tone={view.tone} data-testid="chat-proposal" data-status={proposal.status}>
    <p class="h">
      <Icon name="agents" size="sm" />
      <span>The agent proposes: <span class="action">{proposal.action}</span></span>
      {#if view.loosens}<span class="loosens">Gives the agent more reach</span>{/if}
      {#if view.statusLabel}<span class="status">{view.statusLabel}</span>{/if}
    </p>
    <p class="summary">{view.summary}</p>
    {#if view.diff.length > 0}
      <dl class="diff" data-testid="chat-proposal-diff">
        {#each view.diff as d (d.label)}
          <dt>{d.label}</dt>
          <dd><span class="before">{d.before}</span> <span class="arrow" aria-hidden="true">to</span> <span class="after">{d.after}</span></dd>
        {/each}
      </dl>
    {/if}
    {#if view.chips.length > 0}
      <div class="chips">
        {#each view.chips as chip (chip.key)}
          <Tooltip text={`${chip.key}: ${chip.value}`} class="min-w-0 max-w-full">
            <span class="chip"><span class="k">{chip.key}</span> {chip.value}</span>
          </Tooltip>
        {/each}
      </div>
    {/if}
    {#if view.flag}<p class="flag" role="note" data-testid="chat-proposal-flag">{view.flag}</p>{/if}
    {#if view.error}<p class="err" role="alert">{view.error}</p>{/if}
    <div class="acts">
      <Button size="sm" variant="primary" disabled={busy} onclick={onApply}>{view.error ? "Retry" : "Apply"}</Button>
      <Button size="sm" variant="ghost" disabled={busy} onclick={onDismiss}>Dismiss</Button>
      <span class="note">Nothing changes until you apply.</span>
    </div>
  </div>
{/if}

<style>
  .proposal {
    display: grid;
    gap: 6px;
    max-width: var(--cortex-measure);
    padding: 10px 12px;
    border: 1px solid var(--cortex-line);
    border-radius: var(--cortex-r-ctl);
    background: var(--cortex-surface-1);
    font-size: var(--cortex-t-sm);
  }
  .proposal.row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 8px 4px 10px;
    color: var(--cortex-text-2);
    font-size: var(--cortex-t-xs);
  }
  .proposal.row .grow { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .proposal.row :global(.cx-icon) { flex: none; color: var(--cortex-text-3); }
  .x {
    display: inline-grid;
    place-items: center;
    flex: none;
    width: 22px;
    height: 22px;
    border: 0;
    border-radius: var(--cortex-r-chip);
    background: transparent;
    color: var(--cortex-text-3);
    cursor: pointer;
  }
  .x:hover:not(:disabled) { background: var(--cortex-surface-2); color: var(--cortex-text); }
  .x:focus-visible { outline: 2px solid var(--cortex-accent); outline-offset: 1px; }
  .proposal[data-tone="muted"] { opacity: 0.75; }
  .proposal[data-tone="error"] { border-color: var(--cortex-bad); }
  .h { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 0; font-size: var(--cortex-t-xs); color: var(--cortex-text-2); }
  .h :global(.cx-icon) { color: var(--cortex-accent); }
  .action { font-family: var(--cortex-font-data); color: var(--cortex-text); }
  .status { margin-left: auto; font-size: var(--cortex-t-xs); }
  .proposal[data-tone="ok"] .status { color: var(--cortex-ok); }
  .proposal[data-tone="error"] .status, .err { color: var(--cortex-bad); }
  .loosens { color: var(--cortex-warn); }
  .summary, .err, .flag { margin: 0; overflow-wrap: anywhere; }
  .flag { padding: 6px 8px; border-left: 2px solid var(--cortex-warn); background: var(--cortex-warn-tint); color: var(--cortex-text); font-size: var(--cortex-t-xs); }
  .diff { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 2px 10px; margin: 0; font-size: var(--cortex-t-xs); }
  .diff dt { color: var(--cortex-text-3); }
  .diff dd { margin: 0; overflow-wrap: anywhere; }
  .before { font-family: var(--cortex-font-data); color: var(--cortex-text-3); text-decoration: line-through; }
  .after { font-family: var(--cortex-font-data); color: var(--cortex-text); }
  .arrow { color: var(--cortex-text-3); }
  .chips { display: flex; flex-wrap: wrap; gap: 4px; }
  .chip {
    display: block;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding: 1px 7px;
    border-radius: var(--cortex-r-chip);
    background: var(--cortex-surface-2);
    font-family: var(--cortex-font-data);
    font-size: var(--cortex-t-2xs);
    color: var(--cortex-text-2);
  }
  .k { color: var(--cortex-text-3); }
  .acts { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  .note { font-size: var(--cortex-t-xs); color: var(--cortex-text-3); }
</style>
