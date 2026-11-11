<script lang="ts">
  // A chat turn paused on `request_user_input`: the user's message, the agent's question,
  // and a reply box shaped by the question's kind (yes/no, options, form fields, or free
  // text). Sending resumes the run on the server; the question, the answer and the reply
  // then land in the thread as ordinary exchanges and this card goes away.
  import { chatStore } from "$lib/stores/chat-store.js";
  import { toast } from "$lib/stores/toast-store.js";
  import Button from "$lib/components/kit/Button.svelte";
  import Status from "$lib/components/kit/Status.svelte";
  import {
    choiceOptions,
    formFields,
    formValue,
    replyControl,
    replyToChatInteraction,
    type ChatPendingInteractionWire,
  } from "$lib/chat-interactions.js";

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
  /** Free-text answers, keyed by runId. */
  let texts = $state<Record<string, string>>({});
  /** Form drafts, keyed by runId then field name. */
  let drafts = $state<Record<string, Record<string, string | boolean>>>({});

  const setField = (runId: string, name: string, v: string | boolean) => {
    drafts = { ...drafts, [runId]: { ...(drafts[runId] ?? {}), [name]: v } };
  };

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
    // A follow-up question keeps the same runId: start it from a clean box.
    texts = { ...texts, [p.runId]: "" };
    drafts = { ...drafts, [p.runId]: {} };
    if (out.status === "awaiting-interaction") toast.info("The agent has another question");
    else if (out.status === "awaiting-approval") toast.info("The run paused again", "It needs your approval to continue.");
    await chatStore.refreshActive();
  }

  function sendText(p: ChatPendingInteractionWire) {
    const text = (texts[p.runId] ?? "").trim();
    if (text !== "") void send(p, { value: text });
  }

  function sendForm(p: ChatPendingInteractionWire) {
    const { value, missing } = formValue(formFields(p.schema), drafts[p.runId] ?? {});
    if (missing.length > 0) {
      errors = { ...errors, [p.runId]: `Fill in ${missing.join(", ")}` };
      return;
    }
    void send(p, { value });
  }

</script>

{#each pending as p (p.runId)}
  {@const inFlight = busy[p.runId]}
  {@const control = replyControl(p)}
  <div class="pause" data-testid="chat-interaction" data-run-id={p.runId}>
    <div class="ask-user"><div class="bubble">{p.userMessage}</div></div>
    <div class="card rail rail-attention">
      <p class="h"><Status tone="attention" label="The agent asks you" /></p>
      <p class="prompt">{p.prompt}</p>
      {#if errors[p.runId]}<p class="err" role="alert">{errors[p.runId]}</p>{/if}
      {#if inFlight}
        <p class="busy" aria-live="polite"><Status tone="running" label={inFlight === "reply" ? "Sending your answer…" : "Dismissing…"} /></p>
      {:else}
        {#if control === "confirmation"}
          <div class="acts">
            <Button size="sm" variant="primary" onclick={() => void send(p, { value: true })}>Yes</Button>
            <Button size="sm" onclick={() => void send(p, { value: false })}>No</Button>
          </div>
        {:else if control === "choice"}
          <div class="acts">
            {#each choiceOptions(p.schema) as option (option)}
              <Button size="sm" onclick={() => void send(p, { value: option })}>{option}</Button>
            {/each}
          </div>
        {:else if control === "form"}
          <form class="form" onsubmit={(e) => { e.preventDefault(); sendForm(p); }}>
            {#each formFields(p.schema) as field (field.name)}
              <label class="field">
                <span class="lbl">{field.label}{field.required ? " *" : ""}</span>
                {#if field.type === "boolean"}
                  <input type="checkbox" checked={drafts[p.runId]?.[field.name] === true} onchange={(e) => setField(p.runId, field.name, e.currentTarget.checked)} />
                {:else}
                  <input
                    type={field.type === "number" ? "number" : "text"}
                    value={String(drafts[p.runId]?.[field.name] ?? "")}
                    oninput={(e) => setField(p.runId, field.name, e.currentTarget.value)}
                    class="cx-control input"
                  />
                {/if}
              </label>
            {/each}
            <div><Button type="submit" size="sm" variant="primary">Send answer</Button></div>
          </form>
        {/if}
        {#if control !== "form"}
          <form class="acts" onsubmit={(e) => { e.preventDefault(); sendText(p); }}>
            <input
              type="text"
              bind:value={texts[p.runId]}
              placeholder={control === "text" ? "Type your answer" : "Or type a different answer"}
              aria-label="Your answer"
              class="cx-control input"
            />
            <Button type="submit" size="sm" variant="primary" disabled={(texts[p.runId] ?? "").trim() === ""}>Send answer</Button>
          </form>
        {/if}
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
  .form { display: grid; gap: 6px; }
  .field { display: flex; align-items: center; gap: 8px; font-size: var(--cortex-t-xs); color: var(--cortex-text-2); }
  .lbl { width: 8rem; flex: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .input { flex: 1; min-width: 12rem; height: 28px; }
  .note { font-size: var(--cortex-t-xs); color: var(--cortex-text-3); }
</style>
