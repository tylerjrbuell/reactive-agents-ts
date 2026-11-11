<script lang="ts">
  // A chat turn paused on a durable approval gate: the user's message, the gated tool call,
  // and Approve / Deny / Dismiss. Approve and Deny resume the run on the server; its reply
  // then lands in the thread as an ordinary exchange and this card goes away. Dismiss hides
  // the card only (the turn stays paused and pending).
  import { chatStore } from "$lib/stores/chat-store.js";
  import { toast } from "$lib/stores/toast-store.js";
  import Button from "$lib/components/kit/Button.svelte";
  import Status from "$lib/components/kit/Status.svelte";
  import { approvalArgRows, decideChatApproval, type ApprovalVerb, type ChatPendingApprovalWire } from "$lib/chat-approvals.js";
  import { approvalCardKey, hiddenApprovalCards, hideApprovalCard } from "$lib/chat-live-approval.js";
  import { clearApproval } from "$lib/stores/approval-watcher.js";

  interface Props {
    sessionId: string;
  }
  const { sessionId: sessionIdProp }: Props = $props();
  const sessionId = $derived(sessionIdProp);

  const pending = $derived<readonly ChatPendingApprovalWire[]>(
    $chatStore.activeSessionId === sessionId ? $chatStore.activePendingApprovals : [],
  );

  /** runId -> the verb in flight. */
  let busy = $state<Record<string, ApprovalVerb>>({});
  let errors = $state<Record<string, string>>({});
  /** runIds whose deny-reason row is open. */
  let denying = $state<Record<string, boolean>>({});
  let reasons = $state<Record<string, string>>({});

  async function decide(p: ChatPendingApprovalWire, verb: ApprovalVerb) {
    busy = { ...busy, [p.runId]: verb };
    const { [p.runId]: _cleared, ...rest } = errors;
    errors = rest;
    const out = await decideChatApproval(sessionId, p.runId, verb, verb === "deny" ? reasons[p.runId] : undefined);
    const { [p.runId]: _done, ...stillBusy } = busy;
    busy = stillBusy;
    if (!out.ok) {
      errors = { ...errors, [p.runId]: out.error };
      return;
    }
    // Answered: clear it everywhere (toast, Runs strip, run header) now.
    clearApproval(p.runId);
    // A re-pause keeps the same runId: start its new gate from a clean card.
    denying = { ...denying, [p.runId]: false };
    reasons = { ...reasons, [p.runId]: "" };
    if (out.status === "awaiting-approval") toast.info("The run paused again", "It needs another approval to continue.");
    await chatStore.refreshActive();
  }

  const busyLabel = (verb: ApprovalVerb, tool: string): string =>
    verb === "approve" ? `Running ${tool}…` : verb === "deny" ? "Sending the denial…" : "Dismissing…";
</script>

{#each pending as p (p.runId)}
  {@const inFlight = busy[p.runId]}
  <div class="pause" data-testid="chat-approval" data-run-id={p.runId}>
    <div class="ask-user"><div class="bubble">{p.userMessage}</div></div>
    <!-- Waiting on you: the amber rail (spec: one status vocabulary). Dismiss hides the card
         only: the paused turn stays pending (run header, Runs "Waiting on you"). -->
    {#if !$hiddenApprovalCards.has(approvalCardKey(p))}
    <div class="card rail rail-attention">
      <p class="h"><Status tone="attention" label="Waiting on you" /></p>
      <p class="what">The agent wants to run <span class="tool">{p.toolName}</span>.</p>
      {#if approvalArgRows(p.args).length > 0}
        <dl class="args">
          {#each approvalArgRows(p.args) as row (row.key)}
            <dt>{row.key}</dt>
            <dd>{row.value}</dd>
          {/each}
        </dl>
      {/if}
      {#if errors[p.runId]}<p class="err" role="alert">{errors[p.runId]}</p>{/if}
      {#if inFlight}
        <p class="busy" aria-live="polite"><Status tone="running" label={busyLabel(inFlight, p.toolName)} /></p>
      {:else if denying[p.runId]}
        <form class="acts" onsubmit={(e) => { e.preventDefault(); void decide(p, "deny"); }}>
          <input type="text" bind:value={reasons[p.runId]} placeholder="Tell the agent why (optional)" aria-label="Reason for denying" class="cx-control reason" />
          <Button type="submit" size="sm" variant="danger">Deny</Button>
          <Button size="sm" variant="ghost" onclick={() => (denying = { ...denying, [p.runId]: false })}>Back</Button>
        </form>
      {:else}
        <div class="acts">
          <Button size="sm" variant="primary" icon="check" onclick={() => void decide(p, "approve")}>Approve</Button>
          <Button size="sm" variant="danger" onclick={() => (denying = { ...denying, [p.runId]: true })}>Deny</Button>
          <Button size="sm" variant="ghost" onclick={() => hideApprovalCard(p)}>Dismiss</Button>
          <span class="note">Nothing runs until you approve. New messages wait until you decide.</span>
        </div>
      {/if}
    </div>
    {/if}
  </div>
{/each}

<style>
  .pause { display: grid; gap: 16px; }
  .ask-user { display: flex; justify-content: flex-end; }
  .bubble {
    max-width: 78%;
    padding: 10px 14px;
    border-radius: var(--cortex-r-panel) var(--cortex-r-panel) 4px var(--cortex-r-panel);
    background: var(--cortex-surface-2);
    font-size: var(--cortex-t-md);
    line-height: var(--cortex-lh-read);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
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
