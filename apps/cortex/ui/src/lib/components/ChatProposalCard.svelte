<script lang="ts">
  import Tooltip from "$lib/components/Tooltip.svelte";
  import { proposalView, type ProposalWire } from "$lib/proposal-view.js";

  interface Props {
    proposal: ProposalWire;
    busy: boolean;
    onApply: () => void;
    onDismiss: () => void;
  }
  const { proposal, busy, onApply, onDismiss }: Props = $props();

  const view = $derived(proposalView(proposal));
  const toneClass = $derived(
    view.tone === "ok" ? "border-primary/40" : view.tone === "error" ? "border-error/50" : view.tone === "muted" ? "border-[color:var(--cortex-border)] opacity-70" : "border-primary/30",
  );
</script>

<div class="rounded-lg border bg-[var(--cortex-surface-low)] px-3 py-2 font-mono text-[11px] {toneClass}" data-testid="chat-proposal" data-status={proposal.status}>
  <div class="flex items-start gap-2">
    <span class="material-symbols-outlined mt-px flex-shrink-0 text-[14px] leading-none text-primary">smart_toy</span>
    <div class="min-w-0 flex-1">
      <div class="text-[9px] uppercase tracking-wider text-[var(--cortex-text-muted)]">
        Agent proposes · {proposal.action}{#if view.statusLabel} · <span class={view.tone === "error" ? "text-error" : view.tone === "ok" ? "text-primary" : ""}>{view.statusLabel}</span>{/if}
      </div>
      <div class="mt-0.5 break-words text-[var(--cortex-text)]">{view.summary}</div>
      {#if view.chips.length > 0}
        <div class="mt-1.5 flex flex-wrap gap-1">
          {#each view.chips as chip (chip.key)}
            <Tooltip text={`${chip.key}: ${chip.value}`} class="min-w-0 max-w-full">
              <span class="block max-w-full truncate rounded-full border border-[color:var(--cortex-border)] bg-[var(--cortex-surface-mid)] px-2 py-0.5 text-[10px] text-[var(--cortex-text-muted)]">
                <span class="opacity-70">{chip.key}</span> {chip.value}
              </span>
            </Tooltip>
          {/each}
        </div>
      {/if}
      {#if view.error}
        <div class="mt-1.5 break-words text-[10px] text-error" role="alert">{view.error}</div>
      {/if}
      {#if view.pending}
        <div class="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onclick={onApply}
            class="cursor-pointer rounded border border-primary/50 bg-primary/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-primary transition-colors hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
          >{view.error ? "Retry" : "Apply"}</button>
          <button
            type="button"
            disabled={busy}
            onclick={onDismiss}
            class="cursor-pointer rounded border border-[color:var(--cortex-border)] px-2 py-0.5 text-[10px] uppercase tracking-wider text-[var(--cortex-text-muted)] transition-colors hover:bg-[var(--cortex-surface-mid)] hover:text-[var(--cortex-text)] disabled:cursor-not-allowed disabled:opacity-50"
          >Dismiss</button>
          <span class="text-[9px] text-[var(--cortex-text-muted)]">Nothing changes until you apply.</span>
        </div>
      {/if}
    </div>
  </div>
</div>
