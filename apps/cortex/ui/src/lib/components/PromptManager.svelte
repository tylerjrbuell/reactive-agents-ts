<script lang="ts">
  import { onMount } from "svelte";
  import { tooltip } from "$lib/actions/tooltip.js";
  import {
    promptStore,
    PROMPT_TYPES,
    PROMPT_TYPE_LABEL,
    PROMPT_TYPE_TONE,
    type StoredPrompt,
    type PromptType,
  } from "$lib/stores/prompt-store.js";
  import { toast } from "$lib/stores/toast-store.js";
  import ConfirmModal from "$lib/components/ConfirmModal.svelte";
  import { formatRelativeTime } from "@reactive-agents/ui-core";
  import Badge from "$lib/components/kit/Badge.svelte";
  import Button from "$lib/components/kit/Button.svelte";
  import Chip from "$lib/components/kit/Chip.svelte";
  import EmptyState from "$lib/components/kit/EmptyState.svelte";
  import Field from "$lib/components/kit/Field.svelte";
  import IconButton from "$lib/components/kit/IconButton.svelte";
  import Input from "$lib/components/kit/Input.svelte";
  import Panel from "$lib/components/kit/Panel.svelte";
  import Textarea from "$lib/components/kit/Textarea.svelte";

  let prompts = $state<StoredPrompt[]>([]);
  let search = $state("");
  let typeFilter = $state<PromptType | "all">("all");

  // ── Editor state (null id = creating new) ─────────────────────────────
  let editorOpen = $state(false);
  let editId = $state<number | null>(null);
  let editName = $state("");
  let editBody = $state("");
  let editType = $state<PromptType>("snippet");
  let editTags = $state("");
  let saving = $state(false);

  let deleteTarget = $state<StoredPrompt | null>(null);

  const unsubscribe = promptStore.subscribe((p) => (prompts = p));
  onMount(() => {
    void promptStore.load();
    return unsubscribe;
  });

  const filtered = $derived(
    prompts
      .filter((p) => (typeFilter === "all" ? true : p.type === typeFilter))
      .filter(
        (p) =>
          !search.trim() ||
          p.name.toLowerCase().includes(search.toLowerCase()) ||
          p.body.toLowerCase().includes(search.toLowerCase()),
      ),
  );

  const countsByType = $derived(
    PROMPT_TYPES.reduce<Record<PromptType, number>>(
      (acc, ty) => ({ ...acc, [ty]: prompts.filter((p) => p.type === ty).length }),
      { system: 0, persona: 0, task: 0, snippet: 0 },
    ),
  );

  const TYPE_LABEL = PROMPT_TYPE_LABEL;
  const TYPE_TONE = PROMPT_TYPE_TONE;

  function parseTags(raw: string): string[] {
    try {
      const v: unknown = JSON.parse(raw);
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
    } catch {
      return [];
    }
  }

  function openCreate(type: PromptType = "snippet") {
    editId = null;
    editName = "";
    editBody = "";
    editType = type;
    editTags = "";
    editorOpen = true;
  }

  function openEdit(p: StoredPrompt) {
    editId = p.id;
    editName = p.name;
    editBody = p.body;
    editType = p.type;
    editTags = parseTags(p.tags).join(", ");
    editorOpen = true;
  }

  async function save() {
    if (!editBody.trim()) return;
    saving = true;
    const input = {
      name: editName || "Untitled",
      body: editBody.trim(),
      type: editType,
      tags: editTags.split(",").map((t) => t.trim()).filter(Boolean),
    };
    const ok = editId == null
      ? await promptStore.save(input)
      : await promptStore.update(editId, input);
    saving = false;
    if (ok) {
      editorOpen = false;
      toast.success(editId == null ? "Prompt saved" : "Prompt updated");
    } else {
      toast.error("Save failed");
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    await promptStore.delete(deleteTarget.id);
    deleteTarget = null;
    toast.success("Prompt deleted");
  }

  async function copyBody(p: StoredPrompt) {
    try {
      await navigator.clipboard.writeText(p.body);
      toast.success("Copied", "Prompt body copied to clipboard");
    } catch {
      toast.error("Copy failed");
    }
  }
</script>

<div class="pm">
  <div class="bar">
    <label class="sr-only" for="pm-search">Search prompts</label>
    <input id="pm-search" type="search" class="cx-control search" bind:value={search} placeholder="Search prompts" />
    <div class="filters" role="group" aria-label="Prompt type">
      <Chip on={typeFilter === "all"} onclick={() => (typeFilter = "all")}>All <span class="n">{prompts.length}</span></Chip>
      {#each PROMPT_TYPES as ty (ty)}
        <Chip on={typeFilter === ty} onclick={() => (typeFilter = typeFilter === ty ? "all" : ty)}>{TYPE_LABEL[ty]} <span class="n">{countsByType[ty]}</span></Chip>
      {/each}
    </div>
    <span class="grow"></span>
    <Button variant="primary" icon="plus" onclick={() => openCreate(typeFilter === "all" ? "snippet" : typeFilter)}>New prompt</Button>
  </div>

  {#if editorOpen}
    <Panel class="pm-editor">
      <div class="ed-grid">
        <Field id="pm-name" label="Name">
          <Input id="pm-name" bind:value={editName} placeholder="Untitled" />
        </Field>
        <Field id="pm-type" label="Type">
          <select id="pm-type" class="cx-control" bind:value={editType}>
            {#each PROMPT_TYPES as ty (ty)}
              <option value={ty}>{TYPE_LABEL[ty]}</option>
            {/each}
          </select>
        </Field>
        <Field id="pm-body" label="Prompt" hint={"{{name}} placeholders resolve where templates do."} class="wide">
          <Textarea id="pm-body" bind:value={editBody} rows={6} placeholder="The prompt text" describedBy="pm-body-hint" />
        </Field>
        <Field id="pm-tags" label="Tags" hint="Optional, comma separated." class="wide">
          <Input id="pm-tags" bind:value={editTags} placeholder="research, release" describedBy="pm-tags-hint" />
        </Field>
      </div>
      <div class="ed-actions">
        <Button variant="ghost" onclick={() => (editorOpen = false)}>Cancel</Button>
        <Button variant="primary" icon="check" onclick={() => void save()} disabled={saving || !editBody.trim()}>
          {saving ? "Saving…" : editId == null ? "Create prompt" : "Save changes"}
        </Button>
      </div>
    </Panel>
  {/if}

  <div class="list">
    {#if filtered.length === 0}
      <EmptyState
        icon="book"
        title={prompts.length === 0 ? "No prompts yet" : "No prompts match"}
        description={prompts.length === 0 ? "Save system prompts, personas, tasks and snippets to reuse them in the Builder, chat and Beacon." : "Change the search or pick another type."}
      />
    {/if}
    <ul>
      {#each filtered as p (p.id)}
        <li class="item">
          <div class="item-h">
            <Badge tone={TYPE_TONE[p.type]}>{TYPE_LABEL[p.type]}</Badge>
            <h3>{p.name || "Untitled"}</h3>
            {#each parseTags(p.tags) as tag (tag)}
              <Badge data>{tag}</Badge>
            {/each}
            <span class="grow"></span>
            <IconButton icon="copy" size="sm" label={`Copy ${p.name || "prompt"}`} onclick={() => void copyBody(p)} />
            <IconButton icon="edit" size="sm" label={`Edit ${p.name || "prompt"}`} onclick={() => openEdit(p)} />
            <IconButton icon="trash" size="sm" label={`Delete ${p.name || "prompt"}`} onclick={() => (deleteTarget = p)} />
          </div>
          <p class="body">{p.body}</p>
          <p class="when" use:tooltip={new Date(p.updatedAt).toLocaleString()}>Updated {formatRelativeTime(new Date(p.updatedAt).getTime(), Date.now())}</p>
        </li>
      {/each}
    </ul>
  </div>
</div>

{#if deleteTarget}
  <ConfirmModal
    title="Delete prompt"
    message={`Delete "${deleteTarget.name || "Untitled"}"? This cannot be undone.`}
    confirmLabel="Delete"
    onConfirm={() => void confirmDelete()}
    onCancel={() => (deleteTarget = null)}
  />
{/if}

<style>
  .pm { height: 100%; min-height: 0; display: flex; flex-direction: column; gap: 12px; }
  .bar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; flex: none; }
  .search { width: 15rem; height: 32px; }
  .filters { display: flex; flex-wrap: wrap; gap: 6px; }
  .n { font-family: var(--cortex-font-data); font-size: var(--cortex-t-2xs); color: var(--cortex-text-3); }
  .grow { flex: 1; }
  :global(.pm-editor) { flex: none; }
  .ed-grid { display: grid; grid-template-columns: 1fr 12rem; gap: 12px 16px; }
  .ed-grid :global(.wide) { grid-column: 1 / -1; }
  .ed-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
  .list { flex: 1; min-height: 0; overflow-y: auto; }
  ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; max-width: 1280px; }
  .item { padding: 12px 14px; border: 1px solid var(--cortex-line); border-radius: var(--cortex-r-panel); background: var(--cortex-surface-1); display: grid; gap: 6px; }
  .item-h { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; min-width: 0; }
  h3 { margin: 0; font-size: var(--cortex-t-sm); font-weight: 600; color: var(--cortex-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .body { margin: 0; font-size: var(--cortex-t-sm); color: var(--cortex-text-2); white-space: pre-wrap; word-break: break-word; display: -webkit-box; -webkit-line-clamp: 3; line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; max-width: 96ch; }
  .when { margin: 0; font-size: var(--cortex-t-xs); color: var(--cortex-text-3); }
</style>
