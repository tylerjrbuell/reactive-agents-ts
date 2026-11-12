<script lang="ts">
  /**
   * What a run produced, as cards: files its tools wrote, edits, the typed result and
   * declared deliverables. Each card previews (reports as rendered markdown, everything
   * else as bounded text), copies and downloads what Cortex knows of it from the calls
   * themselves. A file's bytes stay on disk; a card never claims more than it holds.
   */
  import { deliverableFileName, type DeliverableItem } from "@reactive-agents/ui-core";
  import { deliverableActions, deliverableIcon, deliverableMeta, deliverableMime } from "$lib/answer-deliverables.js";
  import { saveTextFile } from "$lib/chat-download.js";
  import { toast } from "$lib/stores/toast-store.js";
  import { tooltip } from "$lib/actions/tooltip.js";
  import GuardedMarkdown from "$lib/components/GuardedMarkdown.svelte";
  import BoundedText from "$lib/components/BoundedText.svelte";
  import Icon from "$lib/components/kit/Icon.svelte";
  import IconButton from "$lib/components/kit/IconButton.svelte";

  interface Props {
    items: readonly DeliverableItem[];
  }
  const { items }: Props = $props();

  let openId = $state<string | null>(null);
  const open = $derived(items.find((i) => i.id === openId));

  async function copy(d: DeliverableItem) {
    try {
      await navigator.clipboard.writeText(d.content ?? "");
      toast.success("Copied", `${d.name} copied to clipboard`);
    } catch {
      toast.error("Copy failed");
    }
  }
  const download = (d: DeliverableItem) => saveTextFile(d.content ?? "", deliverableFileName(d), deliverableMime(d));
  const isMarkdown = (d: DeliverableItem) => d.mediaType === "text/markdown";
</script>

{#if items.length > 0}
  <section class="strip" aria-label="Deliverables" data-testid="deliverables">
    <h3>Deliverables <span class="count">{items.length}</span></h3>
    <ul>
      {#each items as d (d.id)}
        {@const acts = deliverableActions(d)}
        <li class="card" class:open={openId === d.id} class:missing={d.missing} data-testid="deliverable">
          <button type="button" class="main" disabled={!acts.preview} aria-expanded={acts.preview ? openId === d.id : undefined} onclick={() => (openId = openId === d.id ? null : d.id)}>
            <span class="ico"><Icon name={deliverableIcon(d.kind)} size="sm" /></span>
            <span class="txt">
              <span class="name" use:tooltip={d.path ?? d.name}>{d.name}</span>
              <span class="meta">{deliverableMeta(d)}</span>
            </span>
          </button>
          <span class="acts">
            {#if acts.preview}<IconButton icon="eye" pressed={openId === d.id} label={openId === d.id ? `Hide ${d.name}` : `Preview ${d.name}`} onclick={() => (openId = openId === d.id ? null : d.id)} />{/if}
            {#if acts.copy}<IconButton icon="copy" label={`Copy ${d.name}`} onclick={() => void copy(d)} />{/if}
            {#if acts.download}<IconButton icon="download" label={`Download ${d.name}`} onclick={() => download(d)} />{/if}
          </span>
        </li>
      {/each}
    </ul>
    {#if open && open.content !== undefined}
      <div class="preview" data-testid="deliverable-preview">
        {#if isMarkdown(open)}
          <GuardedMarkdown markdown={open.content} showCopy={false} />
        {:else}
          <BoundedText text={open.content} class="text-[12px] text-[var(--cortex-text-2)]" maxHeight="22rem" />
        {/if}
        {#if open.truncated}<p class="cut">Preview cut at {open.content.length.toLocaleString()} of {open.contentChars?.toLocaleString()} characters. The file on disk is complete.</p>{/if}
      </div>
    {/if}
  </section>
{/if}

<style>
  .strip { display: grid; gap: 8px; }
  h3 { margin: 0; display: flex; align-items: center; gap: 8px; font: 600 var(--cortex-t-sm) var(--cortex-font-ui); color: var(--cortex-text); }
  .count { font: 500 var(--cortex-t-2xs) var(--cortex-font-data); color: var(--cortex-text-3); }
  ul { display: grid; grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr)); gap: 8px; margin: 0; padding: 0; list-style: none; }
  .card { display: flex; align-items: center; gap: 4px; min-width: 0; padding: 6px 6px 6px 4px; border: 1px solid var(--cortex-line); border-radius: var(--cortex-r-ctl); background: var(--cortex-surface-1); }
  .card.open { border-color: var(--cortex-line-strong); background: var(--cortex-surface-2); }
  .card.missing { border-style: dashed; }
  .main { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; padding: 2px 6px; border: 0; background: none; color: inherit; text-align: left; cursor: pointer; }
  .main:disabled { cursor: default; }
  .main:focus-visible { outline: 2px solid var(--cortex-focus); outline-offset: 1px; border-radius: 4px; }
  .ico { display: inline-flex; color: var(--cortex-io); }
  .txt { display: grid; min-width: 0; }
  .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: 500 var(--cortex-t-xs) var(--cortex-font-data); color: var(--cortex-text); }
  .meta { font: 400 var(--cortex-t-2xs) var(--cortex-font-ui); color: var(--cortex-text-3); }
  .acts { display: inline-flex; flex: none; }
  .preview { padding: 10px 12px; border: 1px solid var(--cortex-line); border-radius: var(--cortex-r-ctl); background: var(--cortex-surface-1); }
  .cut { margin: 8px 0 0; font-size: var(--cortex-t-xs); color: var(--cortex-text-2); }
</style>
