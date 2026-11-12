<script lang="ts">
  /**
   * "Waiting on you" (Bench spec section 8, `runs.html`): durable runs paused
   * on an approval gate or on a `request_user_input` question, with the answer
   * inline (Approve / Deny, the choice buttons, Yes / No, or a short form).
   * Renders nothing when nothing waits. Approvals poll
   * `GET /api/runs/pending-approvals`; questions come from the app-wide
   * `interaction-watcher` store. A chat approval also offers Open chat.
   */
  import { onDestroy, onMount } from "svelte";
  import type { PendingInteractionWire } from "@reactive-agents/ui-core";
  import Button from "$lib/components/kit/Button.svelte";
  import Status from "$lib/components/kit/Status.svelte";
  import StructuredQuestionForm from "$lib/components/StructuredQuestionForm.svelte";
  import { questionsOf } from "$lib/structured-questions.js";
  import { CORTEX_SERVER_URL } from "$lib/constants.js";
  import { pendingInteractions } from "$lib/stores/interaction-watcher.js";
  import { toast } from "$lib/stores/toast-store.js";
  import type { RunRow } from "$lib/runs-table.js";
  import { choiceOptions, formFields, waitingItemsOf, type PendingApprovalWire } from "$lib/waiting-on-you.js";

  interface Props {
    /** The Runs list, for each item's run name and source. */
    runs: readonly RunRow[];
    pollMs?: number;
  }
  const { runs, pollMs = 2000 }: Props = $props();

  let approvals = $state<PendingApprovalWire[]>([]);
  let interactions = $state<PendingInteractionWire[]>([]);
  let busy = $state<string | null>(null);
  let openForm = $state<string | null>(null);
  let drafts = $state<Record<string, Record<string, string>>>({});
  let timer: ReturnType<typeof setInterval> | null = null;

  const unsubscribe = pendingInteractions.subscribe((v) => (interactions = v));
  const items = $derived(waitingItemsOf(approvals, interactions, runs));

  async function load(): Promise<void> {
    try {
      const res = await fetch(`${CORTEX_SERVER_URL}/api/runs/pending-approvals`);
      if (!res.ok) return;
      approvals = ((await res.json()) as { approvals?: PendingApprovalWire[] }).approvals ?? [];
    } catch {
      /* the next poll retries */
    }
  }

  async function post(key: string, url: string, body: unknown, failTitle: string): Promise<boolean> {
    busy = key;
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) {
        const reason = ((await res.json().catch(() => ({}))) as { error?: string }).error;
        throw new Error(reason ?? `Server returned ${res.status}`);
      }
      return true;
    } catch (e) {
      toast.error(failTitle, e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      busy = null;
    }
  }

  // The gate says WHICH request: parallel sub-agents share the run id, and each is answered on its own.
  async function decide(key: string, runId: string, gateId: string, action: "approve" | "deny") {
    const body = { ...(action === "deny" ? { reason: "Denied from Cortex" } : {}), ...(gateId ? { gateId } : {}) };
    const ok = await post(key, `${CORTEX_SERVER_URL}/api/runs/${encodeURIComponent(runId)}/${action}`, body, action === "approve" ? "Approve failed" : "Deny failed");
    if (ok) approvals = approvals.filter((a) => !(a.runId === runId && a.gateId === gateId));
    void load();
  }

  async function respond(key: string, item: PendingInteractionWire, value: unknown) {
    const ok = await post(key, `${CORTEX_SERVER_URL}/api/runs/${encodeURIComponent(item.runId)}/interaction`, { interactionId: item.interactionId, value }, "Answer failed");
    if (ok) {
      interactions = interactions.filter((i) => i.interactionId !== item.interactionId);
      openForm = null;
    }
  }

  function setField(id: string, name: string, value: string) {
    drafts = { ...drafts, [id]: { ...(drafts[id] ?? {}), [name]: value } };
  }

  onMount(() => {
    void load();
    timer = setInterval(() => void load(), pollMs);
  });
  onDestroy(() => {
    unsubscribe();
    if (timer) clearInterval(timer);
  });
</script>

{#if items.length > 0}
  <section class="needs" aria-label="Waiting on you">
    {#each items as item (item.key)}
      <div class="need">
        <div class="line">
          <Status tone="attention" label={item.kind === "approval" ? "Approval" : "Question"} />
          {#if item.kind === "approval"}
            <span class="what">{#if item.subAgent}<span class="who">{item.subAgent} wants </span>{/if}{item.toolName}{#if item.detail}<span class="data">{item.detail}</span>{/if}</span>
          {:else}
            <span class="what">{item.interaction.prompt}</span>
          {/if}
          {#if item.context}<span class="ctx">{item.context}</span>{/if}
          <div class="btns">
            {#if item.kind === "approval"}
              <Button size="sm" variant="primary" disabled={busy === item.key} onclick={() => decide(item.key, item.runId, item.gateId, "approve")}>Approve</Button>
              <Button size="sm" variant="danger" disabled={busy === item.key} onclick={() => decide(item.key, item.runId, item.gateId, "deny")}>Deny</Button>
              {#if item.chatSessionId}
                <Button size="sm" variant="ghost" href="/chat?session={encodeURIComponent(item.chatSessionId)}">Open chat</Button>
              {:else if item.openRunId}
                <Button size="sm" variant="ghost" href="/run/{encodeURIComponent(item.openRunId)}">Open run</Button>
              {/if}
            {:else if questionsOf(item.interaction).length > 0}
              <Button size="sm" aria-expanded={openForm === item.key} onclick={() => (openForm = openForm === item.key ? null : item.key)}>Answer</Button>
            {:else if item.interaction.kind === "choice"}
              {#each choiceOptions(item.interaction.schema) as option (option)}
                <Button size="sm" disabled={busy === item.key} onclick={() => respond(item.key, item.interaction, option)}>{option}</Button>
              {/each}
            {:else if item.interaction.kind === "confirmation"}
              <Button size="sm" variant="primary" disabled={busy === item.key} onclick={() => respond(item.key, item.interaction, true)}>Yes</Button>
              <Button size="sm" disabled={busy === item.key} onclick={() => respond(item.key, item.interaction, false)}>No</Button>
            {:else}
              <Button size="sm" aria-expanded={openForm === item.key} onclick={() => (openForm = openForm === item.key ? null : item.key)}>Answer</Button>
            {/if}
            {#if item.kind === "question" && item.openRunId}
              <Button size="sm" variant="ghost" href="/run/{encodeURIComponent(item.openRunId)}">Open run</Button>
            {/if}
          </div>
        </div>
        {#if item.kind === "question" && questionsOf(item.interaction).length > 0 && openForm === item.key}
          {@const asked = item.interaction}
          <div class="form">
            <StructuredQuestionForm questions={questionsOf(asked)} disabled={busy === item.key} onSend={(answers) => void respond(item.key, asked, answers)} />
          </div>
        {:else if item.kind === "question" && item.interaction.kind === "form" && openForm === item.key}
          {@const id = item.interaction.interactionId}
          <form class="form" onsubmit={(e) => { e.preventDefault(); void respond(item.key, item.interaction, drafts[id] ?? {}); }}>
            {#each formFields(item.interaction.schema) as field (field.name)}
              <label class="field">
                <span>{field.label}</span>
                {#if field.type === "boolean"}
                  <input type="checkbox" checked={drafts[id]?.[field.name] === "true"} onchange={(e) => setField(id, field.name, String(e.currentTarget.checked))} />
                {:else}
                  <input class="cx-control" type={field.type === "number" ? "number" : "text"} value={drafts[id]?.[field.name] ?? ""} oninput={(e) => setField(id, field.name, e.currentTarget.value)} />
                {/if}
              </label>
            {/each}
            <Button size="sm" variant="primary" type="submit" disabled={busy === item.key}>Send answer</Button>
          </form>
        {/if}
      </div>
    {/each}
  </section>
{/if}

<style>
  .needs {
    display: grid;
    gap: 1px;
    overflow: hidden;
    border: 1px solid color-mix(in srgb, var(--cortex-warn) 35%, var(--cortex-line));
    border-radius: var(--cortex-r-panel);
    background: var(--cortex-line);
  }
  .need { padding: 10px 16px; background: var(--cortex-surface-1); }
  .line { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; }
  .what { min-width: 0; font-weight: 500; color: var(--cortex-text); display: inline-flex; gap: 8px; align-items: baseline; flex-wrap: wrap; }
  .data { font-family: var(--cortex-font-data); font-size: var(--cortex-t-xs); font-weight: 400; color: var(--cortex-text-2); word-break: break-all; }
  .ctx { color: var(--cortex-text-2); font-size: var(--cortex-t-xs); }
  .btns { margin-left: auto; display: flex; flex-wrap: wrap; gap: 6px; }
  .form { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 8px 12px; margin-top: 10px; }
  .field { display: grid; gap: 4px; font-size: var(--cortex-t-xs); color: var(--cortex-text-2); }
  .field .cx-control { min-width: 14rem; }
</style>
