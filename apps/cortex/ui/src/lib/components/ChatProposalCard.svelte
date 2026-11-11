<script lang="ts">
  import Tooltip from "$lib/components/Tooltip.svelte";
  import Icon from "$lib/components/kit/Icon.svelte";
  import Button from "$lib/components/kit/Button.svelte";
  import { proposalView, type ProposalWire } from "$lib/proposal-view.js";

  interface Props {
    proposal: ProposalWire;
    busy: boolean;
    onApply: () => void;
    onDismiss: () => void;
  }
  const { proposal, busy, onApply, onDismiss }: Props = $props();

  const view = $derived(proposalView(proposal));
</script>

<div class="proposal" data-tone={view.tone} data-testid="chat-proposal" data-status={proposal.status}>
  <p class="h">
    <Icon name="agents" size="sm" />
    <span>The agent proposes: <span class="action">{proposal.action}</span></span>
    {#if view.statusLabel}<span class="status">{view.statusLabel}</span>{/if}
  </p>
  <p class="summary">{view.summary}</p>
  {#if view.chips.length > 0}
    <div class="chips">
      {#each view.chips as chip (chip.key)}
        <Tooltip text={`${chip.key}: ${chip.value}`} class="min-w-0 max-w-full">
          <span class="chip"><span class="k">{chip.key}</span> {chip.value}</span>
        </Tooltip>
      {/each}
    </div>
  {/if}
  {#if view.error}<p class="err" role="alert">{view.error}</p>{/if}
  {#if view.pending}
    <div class="acts">
      <Button size="sm" variant="primary" disabled={busy} onclick={onApply}>{view.error ? "Retry" : "Apply"}</Button>
      <Button size="sm" variant="ghost" disabled={busy} onclick={onDismiss}>Dismiss</Button>
      <span class="note">Nothing changes until you apply.</span>
    </div>
  {/if}
</div>

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
  .proposal[data-tone="muted"] { opacity: 0.7; }
  .proposal[data-tone="error"] { border-color: var(--cortex-bad); }
  .h { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 0; font-size: var(--cortex-t-xs); color: var(--cortex-text-2); }
  .h :global(.cx-icon) { color: var(--cortex-accent); }
  .action { font-family: var(--cortex-font-data); color: var(--cortex-text); }
  .status { margin-left: auto; }
  .proposal[data-tone="ok"] .status { color: var(--cortex-ok); }
  .proposal[data-tone="error"] .status, .err { color: var(--cortex-bad); }
  .summary, .err { margin: 0; overflow-wrap: anywhere; }
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
