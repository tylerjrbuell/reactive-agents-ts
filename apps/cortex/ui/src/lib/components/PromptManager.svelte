<script lang="ts">
  import { onMount } from "svelte";
  import {
    promptStore,
    PROMPT_TYPES,
    type StoredPrompt,
    type PromptType,
  } from "$lib/stores/prompt-store.js";
  import { toast } from "$lib/stores/toast-store.js";
  import ConfirmModal from "$lib/components/ConfirmModal.svelte";

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

  const typeBadgeClass: Record<PromptType, string> = {
    system: "bg-primary/15 text-primary",
    persona: "bg-tertiary/15 text-tertiary",
    task: "bg-secondary/15 text-secondary",
    snippet: "bg-surface-container text-outline",
  };

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

<div class="flex h-full min-h-0 flex-col gap-3">
  <!-- Toolbar -->
  <div class="flex flex-shrink-0 flex-wrap items-center gap-2">
    <input
      type="text"
      bind:value={search}
      placeholder="Search prompts…"
      class="w-56 rounded-lg border border-[var(--cortex-border)] bg-surface px-3 py-1.5 font-mono text-[11px] focus:outline-none focus:ring-1 focus:ring-primary"
    />
    <div class="flex gap-1 flex-wrap">
      <button
        type="button"
        class="rounded-full px-2.5 py-1 text-[9px] font-mono border transition-colors
               {typeFilter === 'all' ? 'border-primary/50 text-primary bg-primary/10' : 'border-[var(--cortex-border)] text-outline hover:border-primary/30'}"
        onclick={() => (typeFilter = "all")}
      >
        all · {prompts.length}
      </button>
      {#each PROMPT_TYPES as ty (ty)}
        <button
          type="button"
          class="rounded-full px-2.5 py-1 text-[9px] font-mono border transition-colors
                 {typeFilter === ty ? 'border-primary/50 text-primary bg-primary/10' : 'border-[var(--cortex-border)] text-outline hover:border-primary/30'}"
          onclick={() => (typeFilter = typeFilter === ty ? "all" : ty)}
        >
          {ty} · {countsByType[ty]}
        </button>
      {/each}
    </div>
    <div class="flex-1"></div>
    <button
      type="button"
      onclick={() => openCreate(typeFilter === "all" ? "snippet" : typeFilter)}
      class="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-on-primary hover:bg-primary/90 transition-colors"
    >
      <span class="material-symbols-outlined text-[15px] leading-none">add</span> New prompt
    </button>
  </div>

  <!-- Editor -->
  {#if editorOpen}
    <div class="flex-shrink-0 rounded-xl border border-primary/25 bg-primary/[0.04] p-3 space-y-2">
      <div class="flex gap-2">
        <input
          bind:value={editName}
          placeholder="Name"
          class="flex-1 min-w-0 rounded border border-[var(--cortex-border)] bg-surface px-2 py-1.5 font-mono text-[11px] focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <select
          bind:value={editType}
          class="rounded border border-[var(--cortex-border)] bg-surface px-2 py-1.5 font-mono text-[11px] focus:outline-none"
        >
          {#each PROMPT_TYPES as ty (ty)}
            <option value={ty}>{ty}</option>
          {/each}
        </select>
      </div>
      <textarea
        bind:value={editBody}
        placeholder={"Prompt body… ({{var}} placeholders supported where templates resolve)"}
        rows={6}
        class="w-full rounded border border-[var(--cortex-border)] bg-surface px-2 py-1.5 font-mono text-[11px] focus:outline-none focus:ring-1 focus:ring-primary resize-y"
      ></textarea>
      <input
        bind:value={editTags}
        placeholder="Tags (comma-separated)"
        class="w-full rounded border border-[var(--cortex-border)] bg-surface px-2 py-1.5 font-mono text-[10px] focus:outline-none focus:ring-1 focus:ring-primary"
      />
      <div class="flex gap-2 justify-end">
        <button
          type="button"
          onclick={() => (editorOpen = false)}
          class="rounded border border-[var(--cortex-border)] px-3 py-1 font-mono text-[10px] hover:border-primary transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          onclick={() => void save()}
          disabled={saving || !editBody.trim()}
          class="rounded bg-primary px-4 py-1 font-mono text-[10px] text-on-primary hover:bg-primary/90 disabled:opacity-40 transition-colors"
        >
          {saving ? "Saving…" : editId == null ? "Create" : "Update"}
        </button>
      </div>
    </div>
  {/if}

  <!-- List -->
  <div class="min-h-0 flex-1 overflow-y-auto space-y-2">
    {#if filtered.length === 0}
      <div class="flex h-40 flex-col items-center justify-center gap-2 text-center">
        <span class="material-symbols-outlined text-3xl text-outline/30">menu_book</span>
        <p class="font-mono text-[11px] text-outline">
          {prompts.length === 0 ? "No prompts yet — create reusable system prompts, personas, tasks, and snippets." : "No prompts match the current filter."}
        </p>
      </div>
    {/if}
    {#each filtered as p (p.id)}
      <div class="group rounded-xl border border-[var(--cortex-border)] bg-surface-container-lowest/60 p-3 hover:border-primary/30 transition-colors">
        <div class="flex items-start justify-between gap-2">
          <div class="flex items-center gap-2 min-w-0">
            <span class="rounded-sm px-1.5 py-0.5 text-[8px] font-mono uppercase flex-shrink-0 {typeBadgeClass[p.type]}">{p.type}</span>
            <h3 class="font-mono text-[12px] font-semibold text-on-surface truncate m-0">{p.name || "Untitled"}</h3>
            {#each parseTags(p.tags) as tag (tag)}
              <span class="rounded bg-surface-container px-1.5 py-0.5 font-mono text-[8px] text-outline flex-shrink-0">{tag}</span>
            {/each}
          </div>
          <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
            <button
              type="button"
              onclick={() => void copyBody(p)}
              class="p-1 rounded text-outline hover:text-primary transition-colors"
              title="Copy body"
              aria-label="Copy prompt body"
            >
              <span class="material-symbols-outlined text-[15px]">content_copy</span>
            </button>
            <button
              type="button"
              onclick={() => openEdit(p)}
              class="p-1 rounded text-outline hover:text-primary transition-colors"
              title="Edit"
              aria-label="Edit prompt"
            >
              <span class="material-symbols-outlined text-[15px]">edit</span>
            </button>
            <button
              type="button"
              onclick={() => (deleteTarget = p)}
              class="p-1 rounded text-outline hover:text-error transition-colors"
              title="Delete"
              aria-label="Delete prompt"
            >
              <span class="material-symbols-outlined text-[15px]">delete</span>
            </button>
          </div>
        </div>
        <p class="mt-1.5 font-mono text-[10px] text-on-surface/60 leading-relaxed whitespace-pre-wrap break-words line-clamp-3 m-0">
          {p.body}
        </p>
        <div class="mt-1.5 font-mono text-[8px] text-outline/50">
          updated {new Date(p.updatedAt).toLocaleString()}
        </div>
      </div>
    {/each}
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
