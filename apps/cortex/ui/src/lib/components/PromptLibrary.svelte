<script lang="ts">
  import { onMount, untrack } from "svelte";
  import {
    promptStore,
    PROMPT_TYPES,
    PROMPT_TYPE_LABEL,
    PROMPT_TYPE_TONE,
    type StoredPrompt,
    type PromptType,
  } from "$lib/stores/prompt-store.js";
  import { emptyPromptsText, pickerPrompts } from "$lib/prompt-picker.js";
  import Badge from "$lib/components/kit/Badge.svelte";
  import Button from "$lib/components/kit/Button.svelte";
  import Chip from "$lib/components/kit/Chip.svelte";
  import IconButton from "$lib/components/kit/IconButton.svelte";

  interface Props {
    onSelect: (body: string) => void;
    /** Prompt types listed first (the field's own kinds). Others stay listed after them. */
    types?: PromptType[];
    /** Pre-selected type for the save form (e.g. "system" next to a system-prompt field). */
    defaultSaveType?: PromptType;
  }
  let { onSelect, types = [], defaultSaveType = "snippet" }: Props = $props();

  let prompts = $state<StoredPrompt[]>([]);
  let search = $state("");
  let typeFilter = $state<PromptType | "all">("all");
  let saving = $state(false);
  let saveName = $state("");
  let saveBody = $state("");
  // Initial value only: the form keeps the user's pick after it opens.
  let saveType = $state<PromptType>(untrack(() => defaultSaveType));
  let showSaveForm = $state(false);

  const unsubscribe = promptStore.subscribe((p) => (prompts = p));
  onMount(() => {
    void promptStore.load();
    return unsubscribe;
  });

  // `types` only puts the field's own kinds first; every saved prompt stays listed (lib/prompt-picker.ts).
  const visibleTypes = [...PROMPT_TYPES];
  const filtered = $derived(pickerPrompts(prompts, { preferred: types, typeFilter, search }));
  const emptyText = $derived(emptyPromptsText(prompts.length, filtered.length));



  async function save() {
    if (!saveBody.trim()) return;
    saving = true;
    await promptStore.save({ name: saveName || "Untitled", body: saveBody.trim(), type: saveType });
    saving = false;
    showSaveForm = false;
    saveName = "";
    saveBody = "";
  }
</script>

<div class="pl">
  <label class="sr-only" for="pl-search">Search prompts</label>
  <input id="pl-search" type="search" class="cx-control" bind:value={search} placeholder="Search prompts" />
  {#if visibleTypes.length > 1}
    <div class="filters" role="group" aria-label="Prompt type">
      <Chip on={typeFilter === "all"} onclick={() => (typeFilter = "all")}>All</Chip>
      {#each visibleTypes as ty (ty)}
        <Chip on={typeFilter === ty} onclick={() => (typeFilter = typeFilter === ty ? "all" : ty)}>{PROMPT_TYPE_LABEL[ty]}</Chip>
      {/each}
    </div>
  {/if}
  <ul class="list">
    {#each filtered as p (p.id)}
      <li>
        <button type="button" class="pick" onclick={() => onSelect(p.body)}>
          <span class="pick-h">
            <Badge tone={PROMPT_TYPE_TONE[p.type]}>{PROMPT_TYPE_LABEL[p.type]}</Badge>
            {#if p.name}<span class="name">{p.name}</span>{/if}
          </span>
          <span class="snip">{p.body.slice(0, 80)}{p.body.length > 80 ? "…" : ""}</span>
        </button>
        <IconButton icon="trash" size="sm" label={`Delete ${p.name || "prompt"}`} onclick={() => void promptStore.delete(p.id)} />
      </li>
    {/each}
    {#if emptyText}
      <li class="none">{emptyText}</li>
    {/if}
  </ul>
  {#if showSaveForm}
    <div class="save">
      <div class="save-row">
        <input class="cx-control" aria-label="Prompt name" bind:value={saveName} placeholder="Name (optional)" />
        <select class="cx-control type" aria-label="Prompt type" bind:value={saveType}>
          {#each PROMPT_TYPES as ty (ty)}
            <option value={ty}>{PROMPT_TYPE_LABEL[ty]}</option>
          {/each}
        </select>
      </div>
      <textarea class="cx-control" aria-label="Prompt text" bind:value={saveBody} placeholder="The prompt text" rows={3}></textarea>
      <div class="save-row">
        <Button size="sm" variant="ghost" onclick={() => { showSaveForm = false; }}>Cancel</Button>
        <Button size="sm" variant="primary" disabled={saving || !saveBody.trim()} onclick={() => void save()}>{saving ? "Saving…" : "Save prompt"}</Button>
      </div>
    </div>
  {:else}
    <Button size="sm" icon="plus" onclick={() => { showSaveForm = true; saveType = defaultSaveType; }}>Save a prompt</Button>
  {/if}
</div>

<style>
  .pl { display: flex; flex-direction: column; gap: 8px; padding: 8px; min-width: 300px; }
  .pl :global(.cx-control) { height: 30px; }
  .pl textarea:global(.cx-control) { height: auto; }
  .filters { display: flex; flex-wrap: wrap; gap: 4px; }
  .list { list-style: none; margin: 0; padding: 0; max-height: 13rem; overflow-y: auto; display: grid; gap: 2px; }
  .list li { display: flex; align-items: flex-start; gap: 2px; }
  .pick {
    flex: 1;
    min-width: 0;
    display: grid;
    gap: 2px;
    padding: 6px 8px;
    border: 0;
    border-radius: var(--cortex-r-ctl);
    background: transparent;
    text-align: left;
    cursor: pointer;
    font-family: var(--cortex-font-ui);
  }
  .pick:hover { background: var(--cortex-surface-2); }
  .pick:focus-visible { outline: 2px solid var(--cortex-focus); outline-offset: -2px; }
  .pick-h { display: flex; align-items: center; gap: 6px; min-width: 0; }
  .name { font-size: var(--cortex-t-xs); font-weight: 600; color: var(--cortex-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .snip { font-size: var(--cortex-t-xs); color: var(--cortex-text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .none { padding: 8px; font-size: var(--cortex-t-xs); color: var(--cortex-text-3); justify-content: center; }
  .save { display: grid; gap: 6px; padding-top: 8px; border-top: 1px solid var(--cortex-line); }
  .save-row { display: flex; gap: 6px; justify-content: flex-end; }
  .save-row :global(.cx-control) { flex: 1; min-width: 0; }
  .save-row .type { flex: none; width: 7.5rem; }
</style>
