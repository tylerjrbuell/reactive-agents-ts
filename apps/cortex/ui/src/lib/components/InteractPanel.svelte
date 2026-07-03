<script lang="ts">
  // Durable HITL — `request_user_input` (Agentic UI kit). Reads the shared
  // interaction-watcher store (polls GET /api/runs/pending-interactions) and
  // renders a kind-specific control (choice/confirmation/form) for each pending
  // interaction. Responses POST to /api/runs/:runId/interaction via
  // @reactive-agents/svelte's createInteractions; the run resumes durably.
  // NOTE: @reactive-agents/svelte's createInteractions binds ONE fixed
  // endpoint and sends `runId` in the POST body — this server's route is
  // per-run (`POST /:runId/interaction`, body `{interactionId, value}`), so a
  // raw fetch (built per-item below) is the correct fit rather than forcing
  // the factory against a shape it doesn't model.
  import { onDestroy } from "svelte";
  import type { PendingInteractionWire } from "@reactive-agents/ui-core";
  import { CORTEX_SERVER_URL } from "$lib/constants.js";
  import { pendingInteractions } from "$lib/stores/interaction-watcher.js";

  interface ChoiceSchema {
    readonly options?: string[];
  }
  interface FormField {
    readonly name: string;
    readonly label?: string;
    readonly type?: "text" | "number" | "boolean";
    readonly required?: boolean;
  }
  interface FormSchema {
    readonly fields?: FormField[];
  }

  function asChoiceSchema(schema: unknown): ChoiceSchema {
    if (!schema || typeof schema !== "object") return {};
    const options = (schema as { options?: unknown }).options;
    return { options: Array.isArray(options) ? options.filter((o): o is string => typeof o === "string") : undefined };
  }
  function asFormSchema(schema: unknown): FormSchema {
    if (!schema || typeof schema !== "object") return {};
    const fields = (schema as { fields?: unknown }).fields;
    if (!Array.isArray(fields)) return {};
    return {
      fields: fields.filter(
        (f): f is FormField => !!f && typeof f === "object" && typeof (f as FormField).name === "string",
      ),
    };
  }

  let pending = $state<PendingInteractionWire[]>([]);
  let busy = $state<string | null>(null);
  let error = $state<string | null>(null);
  let drafts = $state<Record<string, Record<string, string>>>({});

  const unsubscribe = pendingInteractions.subscribe((v) => {
    pending = v;
  });
  onDestroy(unsubscribe);

  function draftFor(interactionId: string): Record<string, string> {
    return drafts[interactionId] ?? {};
  }
  function setDraftField(interactionId: string, field: string, value: string) {
    drafts = { ...drafts, [interactionId]: { ...draftFor(interactionId), [field]: value } };
  }

  async function respond(item: PendingInteractionWire, value: unknown) {
    busy = item.interactionId;
    error = null;
    try {
      const res = await fetch(`${CORTEX_SERVER_URL}/api/runs/${encodeURIComponent(item.runId)}/interaction`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interactionId: item.interactionId, value }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      pending = pending.filter((p) => p.interactionId !== item.interactionId);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = null;
    }
  }

  function submitForm(item: PendingInteractionWire) {
    void respond(item, draftFor(item.interactionId));
  }

  function promptPreview(prompt: string): string {
    return prompt.length > 160 ? `${prompt.slice(0, 160)}…` : prompt;
  }
</script>

<section class="interact-panel" aria-label="Pending interactions">
  <header class="interact-panel__head">
    <h3>Pending interactions</h3>
    <span class="interact-panel__count">{pending.length}</span>
  </header>

  {#if error}
    <p class="interact-panel__error">{error}</p>
  {/if}

  {#if pending.length === 0}
    <p class="interact-panel__empty">No runs awaiting input.</p>
  {:else}
    <ul class="interact-panel__list">
      {#each pending as item (item.runId + item.interactionId)}
        <li class="interact-card">
          <div class="interact-card__body">
            <div class="interact-card__meta">run {item.runId.slice(0, 10)} · {item.kind}</div>
            <div class="interact-card__prompt">{promptPreview(item.prompt)}</div>

            {#if item.kind === "choice"}
              {@const schema = asChoiceSchema(item.schema)}
              <div class="interact-card__actions">
                {#each schema.options ?? [] as option (option)}
                  <button
                    class="btn btn--choice"
                    disabled={busy === item.interactionId}
                    onclick={() => respond(item, option)}
                  >
                    {option}
                  </button>
                {/each}
                {#if !schema.options || schema.options.length === 0}
                  <span class="interact-card__warn">No options provided</span>
                {/if}
              </div>
            {:else if item.kind === "confirmation"}
              <div class="interact-card__actions">
                <button
                  class="btn btn--yes"
                  disabled={busy === item.interactionId}
                  onclick={() => respond(item, true)}
                >
                  Yes
                </button>
                <button
                  class="btn btn--no"
                  disabled={busy === item.interactionId}
                  onclick={() => respond(item, false)}
                >
                  No
                </button>
              </div>
            {:else if item.kind === "form"}
              {@const schema = asFormSchema(item.schema)}
              <div class="interact-card__form">
                {#each schema.fields ?? [] as field (field.name)}
                  <label class="interact-card__field">
                    <span>{field.label ?? field.name}</span>
                    {#if field.type === "boolean"}
                      <input
                        type="checkbox"
                        checked={draftFor(item.interactionId)[field.name] === "true"}
                        onchange={(e) =>
                          setDraftField(
                            item.interactionId,
                            field.name,
                            String((e.currentTarget as HTMLInputElement).checked),
                          )}
                      />
                    {:else}
                      <input
                        type={field.type === "number" ? "number" : "text"}
                        value={draftFor(item.interactionId)[field.name] ?? ""}
                        oninput={(e) =>
                          setDraftField(item.interactionId, field.name, (e.currentTarget as HTMLInputElement).value)}
                      />
                    {/if}
                  </label>
                {/each}
                <button
                  class="btn btn--submit"
                  disabled={busy === item.interactionId}
                  onclick={() => submitForm(item)}
                >
                  Submit
                </button>
              </div>
            {/if}
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .interact-panel { display: flex; flex-direction: column; gap: 0.5rem; }
  .interact-panel__head { display: flex; align-items: center; justify-content: space-between; }
  .interact-panel__head h3 { margin: 0; font-size: 0.9rem; }
  .interact-panel__count {
    font-size: 0.75rem; padding: 0.1rem 0.45rem; border-radius: 999px;
    background: var(--surface-2, #2a2a33); color: var(--text-2, #cbd5e1);
  }
  .interact-panel__empty, .interact-panel__error { font-size: 0.8rem; color: var(--text-2, #94a3b8); margin: 0; }
  .interact-panel__error { color: var(--danger, #f87171); }
  .interact-panel__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.4rem; }
  .interact-card {
    display: flex; align-items: center; justify-content: space-between; gap: 0.5rem;
    padding: 0.5rem 0.6rem; border: 1px solid var(--border, #2a2a33); border-radius: 0.5rem;
    background: var(--surface-1, #1c1c22);
  }
  .interact-card__body { display: flex; flex-direction: column; gap: 0.35rem; width: 100%; }
  .interact-card__meta { font-size: 0.7rem; color: var(--text-2, #94a3b8); }
  .interact-card__prompt { font-size: 0.85rem; font-weight: 500; }
  .interact-card__warn { font-size: 0.7rem; color: var(--danger, #f87171); }
  .interact-card__actions { display: flex; gap: 0.35rem; flex-wrap: wrap; }
  .interact-card__form { display: flex; flex-direction: column; gap: 0.35rem; }
  .interact-card__field { display: flex; flex-direction: column; gap: 0.15rem; font-size: 0.75rem; }
  .interact-card__field input { font-size: 0.8rem; padding: 0.2rem 0.35rem; border-radius: 0.35rem; border: 1px solid var(--border, #2a2a33); }
  .btn { font-size: 0.75rem; padding: 0.3rem 0.6rem; border-radius: 0.4rem; border: 1px solid transparent; cursor: pointer; }
  .btn:disabled { opacity: 0.5; cursor: default; }
  .btn--choice { background: var(--surface-2, #2a2a33); color: var(--text-1, #e2e8f0); }
  .btn--yes { background: var(--success, #16a34a); color: white; }
  .btn--no { background: transparent; color: var(--danger, #f87171); border-color: var(--danger, #f87171); }
  .btn--submit { background: var(--primary, #8b5cf6); color: white; align-self: flex-start; }
</style>
