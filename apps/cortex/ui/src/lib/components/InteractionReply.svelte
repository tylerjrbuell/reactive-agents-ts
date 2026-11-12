<script lang="ts">
  // The reply controls for a `request_user_input` question, shaped by its kind: yes/no,
  // options, form fields, or free text (with a free-text escape beside yes/no and options).
  // Shared by the live chat card (ChatLiveInteraction) and the held-turn card
  // (ChatInteractionCards). Rules: lib/chat-interactions.ts.
  import Button from "$lib/components/kit/Button.svelte";
  import { choiceOptions, formFields, formValue, replyControl } from "$lib/chat-interactions.js";

  interface Props {
    kind: string;
    schema: unknown;
    /** Called with the answer value; the caller sends it. */
    onSend: (value: unknown) => void;
    /** Reports a required form field left blank. */
    onInvalid?: (message: string) => void;
  }
  const { kind, schema, onSend, onInvalid }: Props = $props();

  const control = $derived(replyControl({ kind, schema }));
  let text = $state("");
  let draft = $state<Record<string, string | boolean>>({});

  function sendText() {
    const t = text.trim();
    if (t === "") return;
    text = "";
    onSend(t);
  }

  function sendForm() {
    const { value, missing } = formValue(formFields(schema), draft);
    if (missing.length > 0) return onInvalid?.(`Fill in ${missing.join(", ")}`);
    draft = {};
    onSend(value);
  }
</script>

{#if control === "confirmation"}
  <div class="acts">
    <Button size="sm" variant="primary" onclick={() => onSend(true)}>Yes</Button>
    <Button size="sm" onclick={() => onSend(false)}>No</Button>
  </div>
{:else if control === "choice"}
  <div class="acts">
    {#each choiceOptions(schema) as option (option)}
      <Button size="sm" onclick={() => onSend(option)}>{option}</Button>
    {/each}
  </div>
{:else if control === "form"}
  <form class="form" onsubmit={(e) => { e.preventDefault(); sendForm(); }}>
    {#each formFields(schema) as field (field.name)}
      <label class="field">
        <span class="lbl">{field.label}{field.required ? " *" : ""}</span>
        {#if field.type === "boolean"}
          <input type="checkbox" checked={draft[field.name] === true} onchange={(e) => (draft = { ...draft, [field.name]: e.currentTarget.checked })} />
        {:else}
          <input
            type={field.type === "number" ? "number" : "text"}
            value={String(draft[field.name] ?? "")}
            oninput={(e) => (draft = { ...draft, [field.name]: e.currentTarget.value })}
            class="cx-control input"
          />
        {/if}
      </label>
    {/each}
    <div><Button type="submit" size="sm" variant="primary">Send answer</Button></div>
  </form>
{/if}
{#if control !== "form"}
  <form class="acts" onsubmit={(e) => { e.preventDefault(); sendText(); }}>
    <input
      type="text"
      bind:value={text}
      placeholder={control === "text" ? "Type your answer" : "Or type a different answer"}
      aria-label="Your answer"
      class="cx-control input"
    />
    <Button type="submit" size="sm" variant="primary" disabled={text.trim() === ""}>Send answer</Button>
  </form>
{/if}

<style>
  .acts { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  .form { display: grid; gap: 6px; }
  .field { display: flex; align-items: center; gap: 8px; font-size: var(--cortex-t-xs); color: var(--cortex-text-2); }
  .lbl { width: 8rem; flex: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .input { flex: 1; min-width: 12rem; height: 28px; }
</style>
