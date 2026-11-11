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
  import Button from "$lib/components/kit/Button.svelte";

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

  // Seeded once here; the effect below keeps it in step with `value`.
  let draft = $state(untrack(() => value));
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

<div class="ws">
  <div class="ws-row">
    <input
      {id}
      type="text"
      class="cx-control cx-mono ws-input"
      placeholder="/absolute/path/to/project (empty = none)"
      list={`${id}-suggested`}
      bind:value={draft}
      onchange={() => void commit()}
      onkeydown={(e) => e.key === "Enter" && (e.preventDefault(), void commit())}
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? `${id}-error` : undefined}
    />
    {#if !browseOpen}
      <Button
        size="sm"
        icon={browsing ? "x" : "folder"}
        aria-expanded={browsing}
        aria-controls={`${id}-browser`}
        onclick={() => (browsing = !browsing)}
      >{browsing ? "Close" : "Browse"}</Button>
    {/if}
  </div>
  <datalist id={`${id}-suggested`}>{#each suggested as r (r)}<option value={r}></option>{/each}</datalist>
  {#if error}
    <p id={`${id}-error`} class="ws-error" role="alert">{error}</p>
  {/if}
  {#if browsing}
    <div id={`${id}-browser`} class="ws-browser">
      <WorkspaceBrowser current={value} onUse={use} onCancel={browseOpen ? onCancel : () => (browsing = false)} />
    </div>
  {/if}
</div>

<style>
  /* Kit control look (`.cx-control`, global in app.css), so the field reads the
     same in the Lab builder and in the chat workspace dialog. */
  .ws { display: grid; gap: 6px; }
  .ws-row { display: flex; align-items: center; gap: 6px; }
  .ws-input { min-width: 0; flex: 1; }
  .ws-error { margin: 0; font-size: var(--cortex-t-xs); color: var(--cortex-bad); }
  .ws-browser { padding-top: 4px; }
</style>
