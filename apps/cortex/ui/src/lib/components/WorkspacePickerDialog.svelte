<script lang="ts">
  /**
   * The chat quick bar's workspace dialog: the builder panel's WorkspaceField
   * (path input + suggestions + folder browser) in a modal. A chosen or cleared
   * path goes to `onPick`; Escape or the backdrop closes without a change.
   */
  import { portal } from "$lib/actions/portal.js";
  import WorkspaceField from "$lib/components/WorkspaceField.svelte";

  interface Props {
    current: string;
    onPick: (path: string) => void;
    onClose: () => void;
  }
  const { current, onPick, onClose }: Props = $props();
  const body = typeof document === "undefined" ? undefined : document.body;
</script>

<svelte:window onkeydown={(e) => e.key === "Escape" && (e.preventDefault(), onClose())} />

<div use:portal={body} class="fixed inset-0 z-[200] flex items-center justify-center bg-background/70 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="ws-dialog-title">
  <button type="button" class="absolute inset-0 h-full w-full cursor-default border-0 bg-transparent" onclick={onClose} aria-label="Close dialog"></button>
  <div class="relative z-10 mx-4 w-full max-w-lg rounded-xl border border-[color:var(--cortex-border)] bg-[var(--cortex-surface)] p-4 shadow-xl">
    <h3 id="ws-dialog-title" class="mb-1 text-sm font-semibold text-[var(--cortex-text)]">Workspace for this chat</h3>
    <p class="mb-3 font-mono text-[10px] text-[var(--cortex-text-muted)]">File tools stay inside this folder and the shell runs in it. Applies to your next message.</p>
    <WorkspaceField id="chat-workspace" value={current} browseOpen onChange={onPick} onCancel={onClose} />
  </div>
</div>
