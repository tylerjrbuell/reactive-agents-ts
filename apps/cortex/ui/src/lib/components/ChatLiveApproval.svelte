<script lang="ts">
  // A streaming chat turn whose run waits LIVE on an approval (no durable runs): the
  // gated call and Approve / Deny. The run stays open; the decision goes to the shared
  // approval routes and the same turn continues (or tells the agent it was refused).
  // Same look as the durable pause card (ChatApprovalCards): the amber "Waiting on you" rail.
  import Button from "$lib/components/kit/Button.svelte";
  import Status from "$lib/components/kit/Status.svelte";
  import { approvalArgRows } from "$lib/chat-approvals.js";
  import { approvalCardKey, decideLiveApproval, hiddenApprovalCards, hideApprovalCard, type LiveApproval } from "$lib/chat-live-approval.js";
  import { clearApproval } from "$lib/stores/approval-watcher.js";

  interface Props {
    approval: LiveApproval;
  }
  const { approval }: Props = $props();

  let busy = $state<"approve" | "deny" | undefined>(undefined);
  let error = $state<string | undefined>(undefined);
  let denying = $state(false);
  let reason = $state("");
  let answered = $state(false);
  const rows = $derived(approvalArgRows(approval.args));
  // Dismiss hides this card only; the approval stays pending (run header, Runs "Waiting on you").
  const hidden = $derived($hiddenApprovalCards.has(approvalCardKey(approval)));

  async function decide(verb: "approve" | "deny") {
    busy = verb;
    error = undefined;
    const out = await decideLiveApproval(approval.runId, verb, verb === "deny" ? reason : undefined);
    if (out.ok) {
      // Answered: clear it everywhere (toast, Runs strip, run header) and drop this card;
      // the running tool row shows what the call is doing from here.
      clearApproval(approval.runId);
      answered = true;
      return;
    }
    busy = undefined;
    error = out.error;
  }
</script>

{#if !hidden && !answered}
<div class="card rail rail-attention" data-testid="chat-live-approval" data-run-id={approval.runId}>
  <p class="h"><Status tone="attention" label="Waiting on you" /></p>
  <p class="what">The agent wants to run <span class="tool">{approval.toolName}</span>.</p>
  {#if rows.length > 0}
    <dl class="args">
      {#each rows as row (row.key)}
        <dt>{row.key}</dt>
        <dd>{row.value}</dd>
      {/each}
    </dl>
  {/if}
  {#if error}<p class="err" role="alert">{error}</p>{/if}
  {#if busy}
    <p class="busy" aria-live="polite"><Status tone="running" label={busy === "approve" ? `Running ${approval.toolName}…` : "Sending the denial…"} /></p>
  {:else if denying}
    <form class="acts" onsubmit={(e) => { e.preventDefault(); void decide("deny"); }}>
      <input type="text" bind:value={reason} placeholder="Tell the agent why (optional)" aria-label="Reason for denying" class="cx-control reason" />
      <Button type="submit" size="sm" variant="danger">Deny</Button>
      <Button size="sm" variant="ghost" onclick={() => (denying = false)}>Back</Button>
    </form>
  {:else}
    <div class="acts">
      <Button size="sm" variant="primary" icon="check" onclick={() => void decide("approve")}>Approve</Button>
      <Button size="sm" variant="danger" onclick={() => (denying = true)}>Deny</Button>
      <Button size="sm" variant="ghost" onclick={() => hideApprovalCard(approval)}>Dismiss</Button>
      <span class="note">The run is paused here until you decide.</span>
    </div>
  {/if}
</div>
{/if}

<style>
  .card { display: grid; gap: 8px; padding-left: 20px; max-width: var(--cortex-measure); font-size: var(--cortex-t-sm); }
  .h, .what, .busy, .err { margin: 0; }
  .what { color: var(--cortex-text); }
  .tool { font-family: var(--cortex-font-data); font-size: var(--cortex-t-xs); color: var(--cortex-io); }
  .args { display: grid; grid-template-columns: auto 1fr; gap: 2px 12px; margin: 0; font-family: var(--cortex-font-data); font-size: var(--cortex-t-2xs); }
  dt { color: var(--cortex-text-3); }
  dd { margin: 0; min-width: 0; overflow-wrap: anywhere; color: var(--cortex-text); }
  .err { color: var(--cortex-bad); overflow-wrap: anywhere; }
  .acts { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  .reason { flex: 1; min-width: 12rem; height: 28px; }
  .note { font-size: var(--cortex-t-xs); color: var(--cortex-text-3); }
</style>
