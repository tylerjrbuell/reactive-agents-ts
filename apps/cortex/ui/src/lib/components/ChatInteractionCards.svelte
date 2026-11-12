<script lang="ts">
  // A chat turn paused on `request_user_input` (a DURABLE pause held off-thread): the user's
  // message, the agent's question, and a reply box shaped by the question's kind (yes/no,
  // options, form fields, or free text; InteractionReply). Sending resumes the run on the
  // server; the question, the answer and the reply then land in the thread as ordinary
  // exchanges and this card goes away. A question asked LIVE (no durable runs) is
  // ChatLiveInteraction, inside the streaming turn.
  import { chatStore } from "$lib/stores/chat-store.js";
  import { toast } from "$lib/stores/toast-store.js";
  import Button from "$lib/components/kit/Button.svelte";
  import Status from "$lib/components/kit/Status.svelte";
  import InteractionReply from "$lib/components/InteractionReply.svelte";
  import { replyToChatInteraction, type ChatPendingInteractionWire } from "$lib/chat-interactions.js";

  interface Props {
    sessionId: string;
  }
  const { sessionId: sessionIdProp }: Props = $props();
  const sessionId = $derived(sessionIdProp);

  const pending = $derived<readonly ChatPendingInteractionWire[]>(
    $chatStore.activeSessionId === sessionId ? $chatStore.activePendingInteractions : [],
  );

  /** runId -> what is in flight ("reply" | "dismiss"). */
  let busy = $state<Record<string, "reply" | "dismiss">>({});
  let errors = $state<Record<string, string>>({});

  async function send(p: ChatPendingInteractionWire, reply: { value: unknown } | "dismiss") {
    busy = { ...busy, [p.runId]: reply === "dismiss" ? "dismiss" : "reply" };
    const { [p.runId]: _cleared, ...rest } = errors;
    errors = rest;
    const out = await replyToChatInteraction(sessionId, p.runId, reply);
    const { [p.runId]: _done, ...stillBusy } = busy;
    busy = stillBusy;
    if (!out.ok) {
      errors = { ...errors, [p.runId]: out.error };
      return;
    }
    if (out.status === "awaiting-interaction") toast.info("The agent has another question");
    else if (out.status === "awaiting-approval") toast.info("The run paused again", "It needs your approval to continue.");
    await chatStore.refreshActive();
  }
</script>

{#each pending as p (p.runId)}
  {@const inFlight = busy[p.runId]}
  <div class="pause" data-testid="chat-interaction" data-run-id={p.runId}>
    <div class="ask-user"><div class="bubble">{p.userMessage}</div></div>
    <div class="card rail rail-attention">
      <p class="h"><Status tone="attention" label="The agent asks you" /></p>
      <p class="prompt">{p.prompt}</p>
      {#if errors[p.runId]}<p class="err" role="alert">{errors[p.runId]}</p>{/if}
      {#if inFlight}
        <p class="busy" aria-live="polite"><Status tone="running" label={inFlight === "reply" ? "Sending your answer…" : "Dismissing…"} /></p>
      {:else}
        <!-- A follow-up question keeps the same runId: keyed on the interaction so it starts from a clean box. -->
        {#key p.interactionId}
          <InteractionReply
            kind={p.kind}
            schema={p.schema}
            questions={p.questions}
            onSend={(value) => void send(p, { value })}
            onInvalid={(message) => (errors = { ...errors, [p.runId]: message })}
          />
        {/key}
        <div class="acts">
          <Button size="sm" variant="ghost" onclick={() => void send(p, "dismiss")}>Dismiss</Button>
          <span class="note">The run continues once you answer. New messages wait until then.</span>
        </div>
      {/if}
    </div>
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
  .h, .prompt, .busy, .err { margin: 0; }
  .prompt { font-size: var(--cortex-t-md); line-height: var(--cortex-lh-read); white-space: pre-wrap; overflow-wrap: anywhere; }
  .err { color: var(--cortex-bad); overflow-wrap: anywhere; }
  .acts { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  .note { font-size: var(--cortex-t-xs); color: var(--cortex-text-3); }
</style>
