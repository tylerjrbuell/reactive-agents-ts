<script lang="ts">
  // A chat turn paused on `request_user_input`: the user's message, the agent's question,
  // and a reply box shaped by the question's kind (yes/no, options, form fields, or free
  // text). Sending resumes the run on the server; the question, the answer and the reply
  // then land in the thread as ordinary exchanges and this card goes away.
  import { chatStore } from "$lib/stores/chat-store.js";
  import { toast } from "$lib/stores/toast-store.js";
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

  const btn = "cursor-pointer rounded border px-2 py-0.5 text-[10px] uppercase tracking-wider transition-colors disabled:cursor-not-allowed disabled:opacity-40";
  const input = "min-w-0 rounded border border-[color:var(--cortex-border)] bg-[var(--cortex-surface-mid)] px-2 py-0.5 text-[11px] text-[var(--cortex-text)] outline-none focus-visible:border-secondary/60";
</script>

{#each pending as p (p.runId)}
  {@const inFlight = busy[p.runId]}
  {@const control = replyControl(p)}
  <div class="flex flex-col gap-2" data-testid="chat-interaction" data-run-id={p.runId}>
    <div class="flex justify-end">
      <div class="max-w-[80%] rounded-lg border border-primary/25 bg-primary/10 px-3 py-2 text-[var(--cortex-text)]">
        <div class="mb-1 text-[9px] uppercase tracking-widest text-primary/80">user</div>
        <div class="whitespace-pre-wrap break-words text-[13px]">{p.userMessage}</div>
      </div>
    </div>
    <div class="flex justify-start">
      <div class="max-w-[80%] min-w-[16rem] rounded-lg border border-secondary/40 bg-[var(--cortex-surface-low)] px-3 py-2 font-mono text-[11px] text-[var(--cortex-text)]">
        <div class="flex items-start gap-2">
          <span class="material-symbols-outlined mt-px flex-shrink-0 text-[15px] leading-none text-secondary">help</span>
          <div class="min-w-0 flex-1">
            <div class="mb-1 text-[9px] uppercase tracking-widest text-secondary/80">the agent asks</div>
            <div class="whitespace-pre-wrap break-words text-[12px] text-[var(--cortex-text)]">{p.prompt}</div>
            {#if errors[p.runId]}
              <div class="mt-1.5 break-words text-[10px] text-error" role="alert">{errors[p.runId]}</div>
            {/if}
            {#if inFlight}
              <div class="mt-2 flex items-center gap-1.5 text-[10px] text-[var(--cortex-text-muted)]" aria-live="polite">
                <span class="material-symbols-outlined animate-spin text-[13px] leading-none">progress_activity</span>{inFlight === "reply" ? "Sending your answer…" : "Dismissing…"}
              </div>
            {:else}
              {#if control === "confirmation"}
                <div class="mt-2 flex flex-wrap items-center gap-2">
                  <button type="button" onclick={() => void send(p, { value: true })} class="{btn} border-primary/50 bg-primary/10 text-primary hover:bg-primary/20">Yes</button>
                  <button type="button" onclick={() => void send(p, { value: false })} class="{btn} border-error/40 text-error hover:bg-error/10">No</button>
                </div>
              {:else if control === "choice"}
                <div class="mt-2 flex flex-wrap items-center gap-2">
                  {#each choiceOptions(p.schema) as option (option)}
                    <button type="button" onclick={() => void send(p, { value: option })} class="{btn} normal-case tracking-normal border-secondary/40 text-[var(--cortex-text)] hover:bg-secondary/10">{option}</button>
                  {/each}
                </div>
              {:else if control === "form"}
                <form class="mt-2 flex flex-col gap-1.5" onsubmit={(e) => { e.preventDefault(); sendForm(p); }}>
                  {#each formFields(p.schema) as field (field.name)}
                    <label class="flex items-center gap-2 text-[10px] text-[var(--cortex-text-muted)]">
                      <span class="w-28 flex-shrink-0 truncate">{field.label}{field.required ? " *" : ""}</span>
                      {#if field.type === "boolean"}
                        <input type="checkbox" checked={drafts[p.runId]?.[field.name] === true} onchange={(e) => setField(p.runId, field.name, e.currentTarget.checked)} />
                      {:else}
                        <input
                          type={field.type === "number" ? "number" : "text"}
                          value={String(drafts[p.runId]?.[field.name] ?? "")}
                          oninput={(e) => setField(p.runId, field.name, e.currentTarget.value)}
                          class="{input} flex-1"
                        />
                      {/if}
                    </label>
                  {/each}
                  <div><button type="submit" class="{btn} border-primary/50 bg-primary/10 text-primary hover:bg-primary/20">Send answer</button></div>
                </form>
              {/if}
              {#if control !== "form"}
                <form class="mt-2 flex flex-wrap items-center gap-2" onsubmit={(e) => { e.preventDefault(); sendText(p); }}>
                  <input
                    type="text"
                    bind:value={texts[p.runId]}
                    placeholder={control === "text" ? "Type your answer" : "Or type a different answer"}
                    aria-label="Your answer"
                    class="{input} flex-1"
                  />
                  <button type="submit" disabled={(texts[p.runId] ?? "").trim() === ""} class="{btn} border-primary/50 bg-primary/10 text-primary hover:bg-primary/20">Send answer</button>
                </form>
              {/if}
              <div class="mt-2 flex flex-wrap items-center gap-2">
                <button type="button" onclick={() => void send(p, "dismiss")} class="{btn} border-[color:var(--cortex-border)] text-[var(--cortex-text-muted)] hover:bg-[var(--cortex-surface-mid)] hover:text-[var(--cortex-text)]">Dismiss</button>
                <span class="text-[9px] text-[var(--cortex-text-muted)]">The run continues once you answer. New messages wait until then.</span>
              </div>
            {/if}
          </div>
        </div>
      </div>
    </div>
  </div>
{/each}
