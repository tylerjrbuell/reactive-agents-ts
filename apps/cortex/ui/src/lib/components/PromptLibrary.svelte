<script lang="ts">
  import { onMount } from "svelte";
  import { promptStore, type StoredPrompt } from "$lib/stores/prompt-store.js";

  interface Props {
    onSelect: (body: string) => void;
  }
  let { onSelect }: Props = $props();

  let prompts = $state<StoredPrompt[]>([]);
  let search = $state("");
  let saving = $state(false);
  let saveName = $state("");
  let saveBody = $state("");
  let showSaveForm = $state(false);

  const unsubscribe = promptStore.subscribe((p) => (prompts = p));
  onMount(() => {
    void promptStore.load();
    return unsubscribe;
  });

  const filtered = $derived(
    !search.trim()
      ? prompts
      : prompts.filter(
          (p) =>
            p.name.toLowerCase().includes(search.toLowerCase()) ||
            p.body.toLowerCase().includes(search.toLowerCase()),
        ),
  );

  async function save() {
    if (!saveBody.trim()) return;
    saving = true;
    await promptStore.save(saveName || "Untitled", saveBody.trim());
    saving = false;
    showSaveForm = false;
    saveName = "";
    saveBody = "";
  }
</script>

<div class="flex flex-col gap-2 p-2 min-w-[260px]">
  <input
    type="text"
    bind:value={search}
    placeholder="Search prompts…"
    class="w-full rounded border border-[var(--cortex-border)] bg-surface px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary"
  />
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
          {#if p.name}
            <div class="font-mono text-[10px] font-semibold text-slate-700 dark:text-on-surface truncate">
              {p.name}
            </div>
          {/if}
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
      <input
        bind:value={saveName}
        placeholder="Name (optional)"
        class="rounded border border-[var(--cortex-border)] px-2 py-1 text-xs font-mono bg-surface focus:outline-none focus:ring-1 focus:ring-primary"
      />
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
      }}
      class="rounded border border-[var(--cortex-border)] text-[10px] font-mono py-1 hover:border-primary hover:text-primary transition-colors"
    >
      + Save prompt
    </button>
  {/if}
</div>
