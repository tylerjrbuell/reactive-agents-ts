<script lang="ts">
  /**
   * Workspace directory input for the builder panel: free text with the
   * workspaces other chats/agents used as suggestions, checked by the server
   * when the field is committed. A path that fails the check is kept in the
   * field (so it can be fixed) but not written to the config.
   */
  import { onMount } from "svelte";
  import { checkWorkspace, recentWorkspaces } from "$lib/workspace-api.js";

  interface Props {
    id: string;
    value: string;
    onChange: (path: string) => void;
  }
  let { id, value, onChange }: Props = $props();

  let draft = $state(value);
  let error = $state<string | null>(null);
  let recent = $state<string[]>([]);
  $effect(() => {
    draft = value;
  });
  onMount(() => {
    void recentWorkspaces().then((r) => (recent = r));
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
</script>

<div class="space-y-1">
  <input
    {id}
    type="text"
    class="ci-frame ci-text"
    placeholder="/absolute/path/to/project (empty = none)"
    list={`${id}-recent`}
    bind:value={draft}
    onchange={() => void commit()}
    onkeydown={(e) => e.key === "Enter" && (e.preventDefault(), void commit())}
    aria-invalid={error ? true : undefined}
    aria-describedby={error ? `${id}-error` : undefined}
  />
  <datalist id={`${id}-recent`}>{#each recent as r (r)}<option value={r}></option>{/each}</datalist>
  {#if error}
    <p id={`${id}-error`} class="font-mono text-[10px] text-error">{error}</p>
  {/if}
</div>
