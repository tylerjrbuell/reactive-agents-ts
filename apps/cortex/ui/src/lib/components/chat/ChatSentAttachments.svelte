<script lang="ts">
  /**
   * What a sent message carried: a thumbnail for each picture sent in this page session
   * (the server keeps names and sizes, not bytes), a chip for everything else.
   */
  import type { AttachmentMeta } from "@reactive-agents/ui-core";
  import { attachmentIcon, attachmentLabel, attachmentTitle } from "$lib/chat-attachment-view.js";
  import { thumbOf } from "$lib/stores/composer-attachments.js";
  import { tooltip } from "$lib/actions/tooltip.js";
  import Icon from "$lib/components/kit/Icon.svelte";

  interface Props {
    attachments: readonly AttachmentMeta[];
  }
  const { attachments }: Props = $props();
</script>

<ul class="sent" aria-label="Attachments" data-testid="sent-attachments">
  {#each attachments as a, i (i)}
    {@const thumb = a.kind === "image" ? thumbOf(a.name, a.bytes) : undefined}
    <li class="item" class:pic={thumb !== undefined} use:tooltip={attachmentTitle(a)}>
      {#if thumb}
        <img src={thumb} alt={a.name} />
      {:else}
        <Icon name={attachmentIcon(a.kind)} size="sm" /><span class="label">{a.kind === "workspace-file" ? (a.path ?? a.name) : attachmentLabel(a)}</span>
      {/if}
    </li>
  {/each}
</ul>

<style>
  .sent { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; margin: 0; padding: 0; list-style: none; }
  .item { display: inline-flex; align-items: center; gap: 6px; min-height: 26px; padding: 0 8px; border: 1px solid var(--cortex-line); border-radius: var(--cortex-r-chip); background: var(--cortex-surface-1); color: var(--cortex-text-2); font: 400 var(--cortex-t-xs) var(--cortex-font-ui); }
  .item.pic { padding: 0; border: 0; background: none; }
  img { display: block; max-width: 220px; max-height: 160px; border-radius: var(--cortex-r-ctl); border: 1px solid var(--cortex-line); object-fit: cover; }
  .label { max-width: 32ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
