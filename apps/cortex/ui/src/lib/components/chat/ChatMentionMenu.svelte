<script lang="ts">
  /**
   * The `@` file picker: a popover above the composer listing the chat workspace's files,
   * fuzzy-matched to what was typed after the `@`. Arrow keys move, Enter or Tab tags the
   * file, Escape closes. While open it takes those keys before the composer sees them, so
   * Enter never sends the message. The server lists only inside the workspace root.
   */
  import { formatBytes } from "@reactive-agents/ui-core";
  import { searchSessionFiles, type WorkspaceFileHit, type WorkspaceFileSearch } from "$lib/chat-files.js";
  import { CORTEX_SERVER_URL } from "$lib/constants.js";
  import type { MentionTrigger } from "$lib/mention-trigger.js";
  import Icon from "$lib/components/kit/Icon.svelte";

  interface Props {
    trigger: MentionTrigger;
    sessionId: string;
    onPick: (file: WorkspaceFileHit) => void;
    onClose: () => void;
  }
  const { trigger, sessionId, onPick, onClose }: Props = $props();

  let result = $state<WorkspaceFileSearch | null>(null);
  let selected = $state(0);
  let listEl = $state<HTMLUListElement | null>(null);

  // Debounced search; a newer query cancels the older one.
  $effect(() => {
    const q = trigger.query;
    const id = sessionId;
    const ctl = new AbortController();
    const t = setTimeout(() => {
      void searchSessionFiles(CORTEX_SERVER_URL, id, q, ctl.signal).then((r) => {
        if (ctl.signal.aborted) return;
        result = r;
        selected = 0;
      });
    }, 90);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  });

  $effect(() => {
    const onKey = (e: KeyboardEvent) => {
      const files = result?.files ?? [];
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        if (files.length === 0) return;
        e.preventDefault();
        e.stopPropagation();
        selected = (selected + (e.key === "ArrowDown" ? 1 : files.length - 1)) % files.length;
      } else if ((e.key === "Enter" || e.key === "Tab") && !e.shiftKey && !e.isComposing) {
        const hit = files[selected];
        if (!hit) return;
        e.preventDefault();
        e.stopPropagation();
        onPick(hit);
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  });

  $effect(() => {
    void selected;
    listEl?.querySelector<HTMLElement>("[data-sel='true']")?.scrollIntoView({ block: "nearest" });
  });

  /** The path with the matched characters marked. */
  function pieces(hit: WorkspaceFileHit): { text: string; mark: boolean }[] {
    const marks = new Set(hit.indices);
    const out: { text: string; mark: boolean }[] = [];
    for (let i = 0; i < hit.path.length; i++) {
      const mark = marks.has(i);
      const last = out[out.length - 1];
      if (last && last.mark === mark) last.text += hit.path[i];
      else out.push({ text: hit.path[i]!, mark });
    }
    return out;
  }
  const split = (hit: WorkspaceFileHit) => {
    const at = hit.path.lastIndexOf("/");
    return { dir: at < 0 ? "" : hit.path.slice(0, at + 1), base: hit.path.slice(at + 1) };
  };
</script>

<div class="menu chat-menu-in" data-testid="mention-menu" data-slash-menu-keep>
  {#if result === null}
    <p class="note">Looking through the workspace…</p>
  {:else if result.workspace === null}
    <p class="note">This chat has no workspace. Set one (Config, Workspace) to tag its files.</p>
  {:else if result.files.length === 0}
    <p class="note">No file in the workspace matches "{trigger.query}".</p>
  {:else}
    <ul role="listbox" aria-label="Workspace files" bind:this={listEl}>
      {#each result.files as hit, i (hit.path)}
        <li role="option" aria-selected={i === selected} data-sel={i === selected}>
          <button type="button" class="row" class:sel={i === selected} tabindex="-1" onmousedown={(e) => e.preventDefault()} onmouseenter={() => (selected = i)} onclick={() => onPick(hit)}>
            <Icon name="file" size="sm" />
            <span class="path">{#each pieces(hit) as p, k (k)}{#if p.mark}<mark>{p.text}</mark>{:else}{p.text}{/if}{/each}</span>
            <span class="size">{formatBytes(hit.bytes)}</span>
          </button>
        </li>
      {/each}
    </ul>
    {#if result.truncated}<p class="note foot">Large workspace: only the first files were searched.</p>{/if}
  {/if}
</div>

<style>
  .menu { position: absolute; left: 0; right: 0; bottom: calc(100% + 6px); z-index: var(--cortex-z-drawer, 30); max-height: 18rem; overflow: auto; padding: 4px; border: 1px solid var(--cortex-line-strong); border-radius: var(--cortex-r-panel); background: var(--cortex-surface-1); box-shadow: 0 8px 28px rgb(0 0 0 / 0.18); }
  ul { margin: 0; padding: 0; list-style: none; }
  .note { margin: 0; padding: 8px 10px; font-size: var(--cortex-t-xs); color: var(--cortex-text-2); }
  .foot { color: var(--cortex-text-3); }
  .row { display: flex; align-items: center; gap: 8px; width: 100%; padding: 6px 8px; border: 0; border-radius: var(--cortex-r-ctl); background: none; color: var(--cortex-text-2); font: 400 var(--cortex-t-xs) var(--cortex-font-data); text-align: left; cursor: pointer; }
  .row.sel { background: var(--cortex-surface-2); color: var(--cortex-text); }
  .path { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; direction: rtl; text-align: left; }
  .path :global(*) { direction: ltr; unicode-bidi: plaintext; }
  mark { background: none; color: var(--cortex-accent); font-weight: 600; }
  .size { flex: none; font-size: var(--cortex-t-2xs); color: var(--cortex-text-3); }
</style>
