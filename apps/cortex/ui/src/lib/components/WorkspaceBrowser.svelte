<script lang="ts">
  /**
   * Pick a workspace without typing a path: suggestions first (the project Cortex
   * was started in, recent workspaces), then a folder browser (breadcrumb + the
   * current folder's subdirectories). Only directory names are listed; the server
   * refuses relative or missing paths. "Use this folder" hands the path to `onUse`.
   */
  import { onMount } from "svelte";
  import {
    browseWorkspace,
    pathCrumbs,
    workspaceCandidates,
    workspaceLabel,
    workspaceSourceLabel,
    workspaceSuggestions,
    type DirListing,
    type WorkspaceCandidate,
  } from "$lib/workspace-api.js";

  interface Props {
    /** Workspace currently set ("" = none); the browser opens there when set. */
    current: string;
    onUse: (path: string) => void;
    onCancel?: () => void;
  }
  const { current, onUse, onCancel }: Props = $props();

  let candidates = $state<WorkspaceCandidate[]>([]);
  let listing = $state<DirListing | null>(null);
  let hidden = $state(false);
  let loading = $state(false);
  const suggestions = $derived(workspaceSuggestions(current, candidates));

  let browseError = $state<string | null>(null);

  async function open(path: string | undefined) {
    loading = true;
    const next = await browseWorkspace(path, hidden);
    loading = false;
    if (next.ok) {
      listing = next;
      browseError = null;
    } else if (listing?.ok) {
      // A refused folder (permissions, deleted) keeps the current listing; the error shows below it.
      browseError = next.error;
    } else {
      listing = next;
    }
  }

  onMount(() => {
    void workspaceCandidates().then((r) => {
      candidates = r.candidates;
      // Start where the user is most likely headed: the current workspace, else the launch project, else home.
      void open(current.trim() || r.candidates[0]?.path || r.home || undefined);
    });
  });
</script>

<div class="space-y-2 font-mono text-[11px]" data-testid="workspace-browser">
  {#if suggestions.length > 0}
    <ul class="space-y-0.5" aria-label="Suggested workspaces">
      {#each suggestions as s (s.path)}
        <li class="flex items-center gap-1">
          <button
            type="button"
            class="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-left transition-colors hover:bg-primary/10 {s.current ? 'text-primary' : 'text-[var(--cortex-text)]'}"
            onclick={() => onUse(s.path)}
            title={`Use ${s.path}`}
          >
            <span class="material-symbols-outlined text-[15px] leading-none {s.current ? 'text-primary' : 'text-[var(--cortex-text-muted)]'}">{s.current ? "check_circle" : "folder_special"}</span>
            <span class="flex-shrink-0">{workspaceLabel(s.path)}</span>
            <span class="min-w-0 flex-1 truncate text-[10px] text-[var(--cortex-text-muted)]">{s.current ? "current" : s.source ? workspaceSourceLabel[s.source] : ""} · {s.path}</span>
          </button>
          <button
            type="button"
            class="flex-shrink-0 cursor-pointer rounded-md p-1 text-[var(--cortex-text-muted)] transition-colors hover:bg-[var(--cortex-surface-low)] hover:text-[var(--cortex-text)]"
            onclick={() => void open(s.path)}
            aria-label={`Browse inside ${s.path}`}
            title="Browse inside"
          ><span class="material-symbols-outlined text-[15px] leading-none">chevron_right</span></button>
        </li>
      {/each}
    </ul>
  {/if}

  <div class="rounded-md border border-[color:var(--cortex-border)] bg-[var(--cortex-surface-low)]">
    {#if listing?.ok}
      <nav class="flex flex-wrap items-center gap-0.5 border-b border-[color:var(--cortex-border)] px-2 py-1.5" aria-label="Folder path">
        {#each pathCrumbs(listing.path) as c, i (c.path)}
          {#if i > 1}<span class="text-[var(--cortex-text-muted)]/60">/</span>{/if}
          <button
            type="button"
            class="cursor-pointer rounded px-1 transition-colors hover:bg-primary/10 {c.path === listing.path ? 'text-[var(--cortex-text)]' : 'text-[var(--cortex-text-muted)]'}"
            onclick={() => void open(c.path)}
          >{c.label}</button>
        {/each}
        {#if listing.isGitRepo}<span class="ml-1 rounded-full border border-secondary/40 px-1.5 text-[9px] text-secondary">git</span>{/if}
      </nav>
      <ul class="max-h-48 overflow-y-auto p-1" aria-label="Subfolders" aria-busy={loading}>
        {#if listing.parent}
          <li><button type="button" class="flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1 text-left text-[var(--cortex-text-muted)] hover:bg-primary/10" onclick={() => listing?.ok && listing.parent && void open(listing.parent)}>
            <span class="material-symbols-outlined text-[15px] leading-none">arrow_upward</span>..
          </button></li>
        {/if}
        {#each listing.entries as e (e.path)}
          <li><button type="button" class="flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1 text-left text-[var(--cortex-text)] hover:bg-primary/10" onclick={() => void open(e.path)}>
            <span class="material-symbols-outlined text-[15px] leading-none text-[var(--cortex-text-muted)]">folder</span>
            <span class="min-w-0 flex-1 truncate">{e.name}</span>
            {#if e.isGitRepo}<span class="rounded-full border border-secondary/40 px-1.5 text-[9px] text-secondary">git</span>{/if}
          </button></li>
        {:else}
          <li class="px-2 py-1 text-[10px] text-[var(--cortex-text-muted)]">No subfolders here.</li>
        {/each}
        {#if listing.truncated}<li class="px-2 py-1 text-[10px] text-[var(--cortex-text-muted)]">Showing the first {listing.entries.length} folders.</li>{/if}
      </ul>
    {:else if listing && !listing.ok}
      <p class="px-2 py-2 text-[10px] text-error">{listing.error}</p>
    {:else}
      <p class="px-2 py-2 text-[10px] text-[var(--cortex-text-muted)]">Loading folders…</p>
    {/if}
  </div>
  {#if browseError}<p class="text-[10px] text-error">{browseError}</p>{/if}

  <div class="flex flex-wrap items-center justify-between gap-2">
    <label class="flex cursor-pointer items-center gap-1.5 text-[10px] text-[var(--cortex-text-muted)]">
      <input type="checkbox" bind:checked={hidden} onchange={() => listing?.ok && void open(listing.path)} />
      Show hidden folders
    </label>
    <div class="flex items-center gap-2">
      {#if onCancel}
        <button type="button" class="cursor-pointer rounded border border-[color:var(--cortex-border)] px-3 py-1 text-[10px] text-[var(--cortex-text-muted)] hover:text-[var(--cortex-text)]" onclick={onCancel}>Cancel</button>
      {/if}
      <button
        type="button"
        class="cursor-pointer rounded border border-primary/40 bg-primary/10 px-3 py-1 text-[10px] text-primary transition-colors hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-40"
        disabled={!listing?.ok}
        onclick={() => listing?.ok && onUse(listing.path)}
        title={listing?.ok ? listing.path : undefined}
      >Use this folder{listing?.ok ? `: ${workspaceLabel(listing.path)}` : ""}</button>
    </div>
  </div>
</div>
