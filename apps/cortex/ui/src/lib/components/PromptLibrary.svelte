<script lang="ts">
  import { onMount } from "svelte";
  import {
    promptStore,
    PROMPT_TYPES,
    type StoredPrompt,
    type PromptType,
  } from "$lib/stores/prompt-store.js";

  interface Props {
    onSelect: (body: string) => void;
    /** Restrict the picker to these prompt types. Empty/omitted = all types. */
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
  let saveType = $state<PromptType>(defaultSaveType);
  let showSaveForm = $state(false);

  const unsubscribe = promptStore.subscribe((p) => (prompts = p));
  onMount(() => {
    void promptStore.load();
    return unsubscribe;
  });

  const visibleTypes = $derived(types.length > 0 ? types : [...PROMPT_TYPES]);

  const filtered = $derived(
    prompts
      .filter((p) => (types.length === 0 ? true : types.includes(p.type)))
      .filter((p) => (typeFilter === "all" ? true : p.type === typeFilter))
      .filter(
        (p) =>
          !search.trim() ||
          p.name.toLowerCase().includes(search.toLowerCase()) ||
          p.body.toLowerCase().includes(search.toLowerCase()),
      ),
  );

  const typeBadgeClass: Record<PromptType, string> = {
    system: "bg-primary/15 text-primary",
    persona: "bg-tertiary/15 text-tertiary",
    task: "bg-secondary/15 text-secondary",
    snippet: "bg-surface-container text-outline",
  };

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

<div class="flex flex-col gap-2 p-2 min-w-[280px]">
  <input
    type="text"
    bind:value={search}
    placeholder="Search prompts…"
    class="w-full rounded border border-[var(--cortex-border)] bg-surface px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary"
  />
  {#if visibleTypes.length > 1}
    <div class="flex gap-1 flex-wrap">
      <button
        type="button"
        class="rounded-full px-2 py-0.5 text-[9px] font-mono border transition-colors
               {typeFilter === 'all' ? 'border-primary/50 text-primary bg-primary/10' : 'border-[var(--cortex-border)] text-outline hover:border-primary/30'}"
        onclick={() => (typeFilter = "all")}
      >
        all
      </button>
      {#each visibleTypes as ty (ty)}
        <button
          type="button"
          class="rounded-full px-2 py-0.5 text-[9px] font-mono border transition-colors
                 {typeFilter === ty ? 'border-primary/50 text-primary bg-primary/10' : 'border-[var(--cortex-border)] text-outline hover:border-primary/30'}"
          onclick={() => (typeFilter = typeFilter === ty ? "all" : ty)}
        >
          {ty}
        </button>
      {/each}
    </div>
  {/if}
  <div class="max-h-52 overflow-y-auto flex flex-col gap-1">
    {#each filtered as p (p.id)}
      <div
        class="group flex items-start justify-between gap-1 rounded px-2 py-1.5 hover:bg-primary/5 cursor-pointer"
        role="button"
        tabindex="0"
        onclick={() => onSelect(p.body)}
        onkeydown={(e) => e.key === "Enter" && onSelect(p.body)}
      >
        <div class="min-w-0">
          <div class="flex items-center gap-1.5 min-w-0">
            <span class="rounded-sm px-1 py-px text-[8px] font-mono uppercase flex-shrink-0 {typeBadgeClass[p.type]}">{p.type}</span>
            {#if p.name}
              <div class="font-mono text-[10px] font-semibold text-slate-700 dark:text-on-surface truncate">
                {p.name}
              </div>
            {/if}
          </div>
          <div class="font-mono text-[9px] text-outline truncate">
            {p.body.slice(0, 60)}{p.body.length > 60 ? "…" : ""}
          </div>
        </div>
        <button
          type="button"
          class="opacity-0 group-hover:opacity-60 text-error hover:opacity-100 transition-opacity flex-shrink-0"
          onclick={(e) => {
            e.stopPropagation();
            void promptStore.delete(p.id);
          }}
          title="Delete"
          aria-label="Delete prompt"
        >
          <span class="material-symbols-outlined text-[14px]">delete</span>
        </button>
      </div>
    {/each}
    {#if filtered.length === 0}
      <div class="font-mono text-[10px] text-outline text-center py-2">No prompts saved</div>
    {/if}
  </div>
  {#if showSaveForm}
    <div class="flex flex-col gap-1 border-t border-[var(--cortex-border)] pt-2">
      <div class="flex gap-1">
        <input
          bind:value={saveName}
          placeholder="Name (optional)"
          class="flex-1 min-w-0 rounded border border-[var(--cortex-border)] px-2 py-1 text-xs font-mono bg-surface focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <select
          bind:value={saveType}
          class="rounded border border-[var(--cortex-border)] px-1 py-1 text-[10px] font-mono bg-surface focus:outline-none"
        >
          {#each PROMPT_TYPES as ty (ty)}
            <option value={ty}>{ty}</option>
          {/each}
        </select>
      </div>
      <textarea
        bind:value={saveBody}
        placeholder="Prompt body…"
        rows={3}
        class="rounded border border-[var(--cortex-border)] px-2 py-1 text-xs font-mono bg-surface focus:outline-none focus:ring-1 focus:ring-primary resize-none"
      ></textarea>
      <div class="flex gap-1">
        <button
          onclick={() => void save()}
          disabled={saving || !saveBody.trim()}
          class="flex-1 rounded bg-primary text-on-primary text-[10px] font-mono py-1 hover:bg-primary/90 disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          onclick={() => {
            showSaveForm = false;
          }}
          class="flex-1 rounded border border-[var(--cortex-border)] text-[10px] font-mono py-1 hover:border-primary"
        >
          Cancel
        </button>
      </div>
    </div>
  {:else}
    <button
      onclick={() => {
        showSaveForm = true;
        saveType = defaultSaveType;
      }}
      class="rounded border border-[var(--cortex-border)] text-[10px] font-mono py-1 hover:border-primary hover:text-primary transition-colors"
    >
      + Save prompt
    </button>
  {/if}
</div>
