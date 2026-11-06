<script lang="ts">
  // A chat turn paused on a durable approval gate: the user's message, the gated tool call,
  // and Approve / Deny / Dismiss. Approve and Deny resume the run on the server; its reply
  // then lands in the thread as an ordinary exchange and this card goes away.
  import { chatStore } from "$lib/stores/chat-store.js";
  import { toast } from "$lib/stores/toast-store.js";
  import { approvalArgRows, decideChatApproval, type ApprovalVerb, type ChatPendingApprovalWire } from "$lib/chat-approvals.js";

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
  <div class="flex flex-col gap-2" data-testid="chat-approval" data-run-id={p.runId}>
    <div class="flex justify-end">
      <div class="max-w-[80%] rounded-lg border border-primary/25 bg-primary/10 px-3 py-2 text-[var(--cortex-text)]">
        <div class="mb-1 text-[9px] uppercase tracking-widest text-primary/80">user</div>
        <div class="whitespace-pre-wrap break-words text-[13px]">{p.userMessage}</div>
      </div>
    </div>
    <div class="flex justify-start">
      <div class="max-w-[80%] min-w-[16rem] rounded-lg border border-secondary/40 bg-[var(--cortex-surface-low)] px-3 py-2 font-mono text-[11px] text-[var(--cortex-text)]">
        <div class="flex items-start gap-2">
          <span class="material-symbols-outlined mt-px flex-shrink-0 text-[15px] leading-none text-secondary">front_hand</span>
          <div class="min-w-0 flex-1">
            <div class="text-[var(--cortex-text)]">The agent wants to run <span class="text-secondary">{p.toolName}</span> and is waiting for you.</div>
            {#if approvalArgRows(p.args).length > 0}
              <dl class="mt-1.5 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[10px]">
                {#each approvalArgRows(p.args) as row (row.key)}
                  <dt class="text-[var(--cortex-text-muted)]">{row.key}</dt>
                  <dd class="min-w-0 break-all text-[var(--cortex-text)]">{row.value}</dd>
                {/each}
              </dl>
            {/if}
            {#if errors[p.runId]}
              <div class="mt-1.5 break-words text-[10px] text-error" role="alert">{errors[p.runId]}</div>
            {/if}
            {#if inFlight}
              <div class="mt-2 flex items-center gap-1.5 text-[10px] text-[var(--cortex-text-muted)]" aria-live="polite">
                <span class="material-symbols-outlined animate-spin text-[13px] leading-none">progress_activity</span>{busyLabel(inFlight, p.toolName)}
              </div>
            {:else if denying[p.runId]}
              <form class="mt-2 flex flex-wrap items-center gap-2" onsubmit={(e) => { e.preventDefault(); void decide(p, "deny"); }}>
                <input
                  type="text"
                  bind:value={reasons[p.runId]}
                  placeholder="Tell the agent why (optional)"
                  aria-label="Reason for denying"
                  class="min-w-0 flex-1 rounded border border-[color:var(--cortex-border)] bg-[var(--cortex-surface-mid)] px-2 py-0.5 text-[10px] text-[var(--cortex-text)] outline-none focus-visible:border-secondary/60"
                />
                <button type="submit" class="cursor-pointer rounded border border-error/50 bg-error/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-error transition-colors hover:bg-error/20">Deny</button>
                <button type="button" onclick={() => (denying = { ...denying, [p.runId]: false })} class="cursor-pointer rounded border border-[color:var(--cortex-border)] px-2 py-0.5 text-[10px] uppercase tracking-wider text-[var(--cortex-text-muted)] transition-colors hover:bg-[var(--cortex-surface-mid)] hover:text-[var(--cortex-text)]">Back</button>
              </form>
            {:else}
              <div class="mt-2 flex flex-wrap items-center gap-2">
                <button type="button" onclick={() => void decide(p, "approve")} class="cursor-pointer rounded border border-primary/50 bg-primary/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-primary transition-colors hover:bg-primary/20">Approve</button>
                <button type="button" onclick={() => (denying = { ...denying, [p.runId]: true })} class="cursor-pointer rounded border border-error/40 px-2 py-0.5 text-[10px] uppercase tracking-wider text-error transition-colors hover:bg-error/10">Deny</button>
                <button type="button" onclick={() => void decide(p, "dismiss")} class="cursor-pointer rounded border border-[color:var(--cortex-border)] px-2 py-0.5 text-[10px] uppercase tracking-wider text-[var(--cortex-text-muted)] transition-colors hover:bg-[var(--cortex-surface-mid)] hover:text-[var(--cortex-text)]">Dismiss</button>
                <span class="text-[9px] text-[var(--cortex-text-muted)]">Nothing runs until you approve. New messages wait until you decide.</span>
              </div>
            {/if}
          </div>
        </div>
      </div>
    </div>
  </div>
{/each}
