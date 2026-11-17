<script lang="ts">
  /**
   * The Options tab of a server: the read-only option and the annotation trust switch, saved
   * through the server's own PATCH (the rest of the config rides along unchanged; masked
   * credential values are restored server-side).
   */
  import { untrack } from "svelte";
  import Button from "$lib/components/kit/Button.svelte";
  import ServerOptionsFields from "$lib/components/tools/ServerOptionsFields.svelte";
  import { mcpDraftFromRow, type McpDraft, type McpListRow } from "$lib/tool-workshop.js";

  interface Props {
    row: McpListRow;
    saving: boolean;
    onSave: (draft: McpDraft) => void | Promise<void>;
  }
  const { row, saving, onSave }: Props = $props();

  // The pane remounts per server (`{#key}` in ServerDetail), so the draft starts from the row once.
  let draft = $state<McpDraft>(untrack(() => mcpDraftFromRow(row)));
</script>

<div class="op" data-testid="server-options">
  <ServerOptionsFields bind:draft idBase="op" />
  <div class="op-actions">
    <Button variant="primary" icon="check" disabled={saving} onclick={() => onSave(draft)}>{saving ? "Saving…" : "Save options"}</Button>
  </div>
</div>

<style>
  .op { display: grid; gap: 14px; max-width: 560px; }
  .op-actions { display: flex; justify-content: flex-end; }
</style>
