<script lang="ts">
  /**
   * The chips above the composer text: pictures (with a thumbnail), audio, text files and
   * tagged workspace files, each removable. A tagged or text file opens a preview of what
   * will be placed in the prompt ("N KB of M KB" when it is cut) before the message is sent.
   */
  import { formatBytes } from "@reactive-agents/ui-core";
  import type { DraftAttachment } from "$lib/composer-attachments.js";
  import { attachmentIcon, attachmentLabel } from "$lib/chat-attachment-view.js";
  import { previewSessionFile, type WorkspaceFilePreview } from "$lib/chat-files.js";
  import { CORTEX_SERVER_URL } from "$lib/constants.js";
  import { tooltip } from "$lib/actions/tooltip.js";
  import Icon from "$lib/components/kit/Icon.svelte";

  interface Props {
    items: readonly DraftAttachment[];
    sessionId: string;
    onRemove: (id: string) => void;
  }
  const { items, sessionId, onRemove }: Props = $props();

  let openId = $state<string | null>(null);
  let preview = $state<{ readonly id: string; readonly state: "loading" } | { readonly id: string; readonly state: "ok"; readonly data: WorkspaceFilePreview } | { readonly id: string; readonly state: "error"; readonly message: string } | null>(null);

  async function toggle(item: DraftAttachment) {
    if (item.kind === "image" || item.kind === "audio") return;
    if (openId === item.id) {
      openId = null;
      return;
    }
    openId = item.id;
    if (item.kind === "text") {
      // An uploaded text file is read from its own bytes, cut at the same cap the server uses.
      const text = new TextDecoder().decode(Uint8Array.from(atob(item.dataBase64 ?? ""), (c) => c.charCodeAt(0)));
      const shown = Math.min(item.bytes, 64 * 1024);
      preview = { id: item.id, state: "ok", data: { path: item.name, text: text.slice(0, 64 * 1024), totalBytes: item.bytes, shownBytes: shown, truncated: item.bytes > shown } };
      return;
    }
    preview = { id: item.id, state: "loading" };
    const r = await previewSessionFile(CORTEX_SERVER_URL, sessionId, item.path ?? "");
    if (openId !== item.id) return;
    preview = r.ok ? { id: item.id, state: "ok", data: r.preview } : { id: item.id, state: "error", message: r.error };
  }

  const head = (text: string) => text.split("\n").slice(0, 14).join("\n");
</script>

{#if items.length > 0}
  <div class="bar" role="list" aria-label="Attachments" data-testid="attachment-bar">
    {#each items as item (item.id)}
      <div class="chip" class:img={item.kind === "image"} role="listitem" data-testid="attachment-chip">
        {#if item.kind === "image" && item.thumb}
          <img src={item.thumb} alt={item.name} class="thumb" />
        {:else}
          <Icon name={attachmentIcon(item.kind)} size="sm" />
        {/if}
        <button
          type="button"
          class="name"
          class:static={item.kind === "image" || item.kind === "audio"}
          aria-expanded={item.kind === "image" || item.kind === "audio" ? undefined : openId === item.id}
          use:tooltip={item.kind === "workspace-file" ? `${item.path ?? item.name}. Click to preview what is sent.` : item.kind === "text" ? "Click to preview what is sent." : item.name}
          onclick={() => void toggle(item)}
        >{item.kind === "workspace-file" ? item.path ?? item.name : attachmentLabel(item)}</button>
        {#if item.kind === "workspace-file"}<span class="size">{formatBytes(item.bytes)}</span>{/if}
        <button type="button" class="rm" aria-label="Remove {item.name}" use:tooltip={"Remove"} onclick={() => onRemove(item.id)}><Icon name="x" size="sm" /></button>
      </div>
    {/each}
  </div>
  {#if preview && openId === preview.id}
    <div class="preview" data-testid="attachment-preview">
      {#if preview.state === "loading"}
        <p class="note">Reading the file…</p>
      {:else if preview.state === "error"}
        <p class="note bad">{preview.message}</p>
      {:else}
        <p class="note">
          {#if preview.data.shownBytes < preview.data.totalBytes}
            {formatBytes(preview.data.shownBytes)} of {formatBytes(preview.data.totalBytes)} will be sent; the rest is cut.
          {:else}
            All {formatBytes(preview.data.totalBytes)} will be sent.
          {/if}
        </p>
        <pre>{head(preview.data.text)}</pre>
      {/if}
    </div>
  {/if}
{/if}

<style>
  .bar { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px 10px 0; }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    max-width: 100%;
    min-height: 26px;
    padding: 0 4px 0 8px;
    border: 1px solid var(--cortex-line);
    border-radius: var(--cortex-r-chip);
    background: var(--cortex-surface-2);
    color: var(--cortex-text-2);
    font: 400 var(--cortex-t-xs) var(--cortex-font-ui);
  }
  .chip.img { padding-left: 3px; }
  .thumb { width: 22px; height: 22px; border-radius: 4px; object-fit: cover; }
  .name { border: 0; background: none; padding: 0; color: var(--cortex-text); font: inherit; cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 28ch; text-align: left; }
  .name.static { cursor: default; }
  .name:focus-visible, .rm:focus-visible { outline: 2px solid var(--cortex-focus); outline-offset: 1px; border-radius: 3px; }
  .size { font-family: var(--cortex-font-data); font-size: var(--cortex-t-2xs); color: var(--cortex-text-3); }
  .rm { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border: 0; border-radius: 4px; background: none; color: var(--cortex-text-3); cursor: pointer; }
  .rm:hover { color: var(--cortex-text); background: var(--cortex-surface-3); }
  .preview { margin: 6px 10px 0; padding: 8px 10px; border: 1px solid var(--cortex-line); border-radius: var(--cortex-r-ctl); background: var(--cortex-surface-1); }
  .note { margin: 0 0 6px; font-size: var(--cortex-t-xs); color: var(--cortex-text-2); }
  .note.bad { color: var(--cortex-bad); margin: 0; }
  pre { margin: 0; max-height: 9rem; overflow: auto; font: 400 var(--cortex-t-2xs) / 1.5 var(--cortex-font-data); color: var(--cortex-text-2); white-space: pre; }
</style>
