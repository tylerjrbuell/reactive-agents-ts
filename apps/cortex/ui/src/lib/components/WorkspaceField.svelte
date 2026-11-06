<script lang="ts">
  /**
   * Workspace directory control (builder panel and the chat quick bar's
   * /workspace dialog): free text with suggestions, plus a folder browser so no
   * one has to type an absolute path. A typed path is checked by the server when
   * committed; a path that fails is kept in the field (so it can be fixed) but
   * not written to the config.
   */
  import { onMount, untrack } from "svelte";
  import { checkWorkspace, workspaceCandidates } from "$lib/workspace-api.js";
  import WorkspaceBrowser from "$lib/components/WorkspaceBrowser.svelte";

  interface Props {
    id: string;
    value: string;
    onChange: (path: string) => void;
    /** Show the folder browser from the start (the quick-bar dialog). */
    browseOpen?: boolean;
    /** Close handler for the browser's Cancel button (the dialog closes itself). */
    onCancel?: () => void;
  }
  let { id, value, onChange, browseOpen = false, onCancel }: Props = $props();

  let draft = $state(value);
  let error = $state<string | null>(null);
  let suggested = $state<string[]>([]);
  // Initial value only: the dialog opens with the browser shown, the panel with it folded.
  let browsing = $state(untrack(() => browseOpen));
  $effect(() => {
    draft = value;
  });
  onMount(() => {
    void workspaceCandidates().then((r) => (suggested = r.candidates.map((c) => c.path)));
  });

  async function commit() {
    const p = draft.trim();
    if (p === value) return;
    if (p === "") {
      error = null;
      onChange("");
      return;
    }
    const r = await checkWorkspace(p);
    if (r.ok) {
      error = null;
      draft = r.path;
      onChange(r.path);
    } else {
      error = r.error;
    }
  }

  function use(path: string) {
    draft = path;
    error = null;
    if (!browseOpen) browsing = false;
    void commit();
  }
</script>

<div class="space-y-1">
  <div class="flex items-center gap-1.5">
    <input
      {id}
      type="text"
      class="ws-input min-w-0 flex-1"
      placeholder="/absolute/path/to/project (empty = none)"
      list={`${id}-suggested`}
      bind:value={draft}
      onchange={() => void commit()}
      onkeydown={(e) => e.key === "Enter" && (e.preventDefault(), void commit())}
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? `${id}-error` : undefined}
    />
    {#if !browseOpen}
      <button
        type="button"
        class="flex flex-shrink-0 cursor-pointer items-center gap-1 rounded-md border border-[color:var(--cortex-border)] px-2 py-1 font-mono text-[10px] text-[var(--cortex-text-muted)] transition-colors hover:border-primary/40 hover:text-primary"
        aria-expanded={browsing}
        aria-controls={`${id}-browser`}
        onclick={() => (browsing = !browsing)}
      ><span class="material-symbols-outlined text-[14px] leading-none">{browsing ? "expand_less" : "folder_open"}</span>{browsing ? "Close" : "Browse"}</button>
    {/if}
  </div>
  <datalist id={`${id}-suggested`}>{#each suggested as r (r)}<option value={r}></option>{/each}</datalist>
  {#if error}
    <p id={`${id}-error`} class="font-mono text-[10px] text-error">{error}</p>
  {/if}
  {#if browsing}
    <div id={`${id}-browser`} class="pt-1">
      <WorkspaceBrowser current={value} onUse={use} onCancel={browseOpen ? onCancel : () => (browsing = false)} />
    </div>
  {/if}
</div>

<style>
  /* Same look as the builder panel's .ci-frame/.ci-text, scoped here because those
     rules ship with AgentConfigPanel and this field also renders in the chat dialog. */
  .ws-input {
    box-sizing: border-box;
    padding: 6px 10px;
    font-family: "JetBrains Mono", ui-monospace, monospace;
    font-size: 11px;
    line-height: 1.5;
    color: var(--cortex-text);
    outline: none;
    background: color-mix(in srgb, var(--cortex-surface-mid) 55%, var(--cortex-surface) 45%);
    border: 1px solid var(--cortex-border);
    border-radius: var(--acp-radius, 6px);
    transition: border-color 0.15s ease, box-shadow 0.2s ease;
  }
  .ws-input:focus {
    border-color: color-mix(in srgb, var(--ra-violet) 55%, var(--cortex-border));
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--ra-violet) 18%, transparent);
  }
  .ws-input::placeholder {
    color: color-mix(in srgb, var(--cortex-text-muted) 55%, transparent);
  }
  :global(html.dark) .ws-input {
    background: color-mix(in srgb, var(--cortex-surface-mid) 72%, var(--cortex-surface-low) 28%);
    border-color: color-mix(in srgb, white 14%, var(--cortex-border));
  }
</style>
