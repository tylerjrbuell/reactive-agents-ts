<script lang="ts">
  /**
   * The chat composer's slash menu (commands, or the choices of /model, /tools, …).
   * Keyboard navigation stays in ChatPanel (it owns the textarea); this renders the
   * list, reports hover via `onHover`, runs the clicked row and calls `onDismiss` on a
   * pointer press outside it (elements marked `data-slash-menu-keep`, such as the
   * composer and the quick bar, do not count as outside). Multi-select rows show a
   * checkbox and stay open when clicked.
   */
  import type { MenuItem } from "$lib/chat-menu.js";
  import type { IconName } from "$lib/icons.js";
  import Icon from "$lib/components/kit/Icon.svelte";

  interface Props {
    items: MenuItem[];
    selected: number;
    onHover: (index: number) => void;
    onDismiss: () => void;
    /** Set inside a command's panel: a Back row to the command list, naming the panel and its slash alias. */
    header?: { readonly title: string; readonly alias: string; readonly onBack: () => void };
  }
  const { items, selected, onHover, onDismiss, header }: Props = $props();

  let listEl = $state<HTMLUListElement | undefined>();
  /** More rows below the fold: a fade at the bottom edge says "scroll" (a thin scrollbar is easy to miss). */
  let moreBelow = $state(false);
  const measure = () => {
    if (listEl) moreBelow = listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight > 2;
  };
  $effect(() => {
    void items.length;
    queueMicrotask(measure);
  });
  const multi = $derived(items.some((i) => i.multi));

  $effect(() => {
    const onPointer = (e: PointerEvent) => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      if (listEl?.contains(t) || t.closest("[data-slash-menu-keep]") || t.closest("[data-config-keep]")) return;
      onDismiss();
    };
    document.addEventListener("pointerdown", onPointer, true);
    return () => document.removeEventListener("pointerdown", onPointer, true);
  });

  const icon = (item: MenuItem): IconName =>
    item.multi ? (item.active ? "check-square" : "square") : item.active ? "check-circle" : item.icon;
</script>

<ul
  bind:this={listEl}
  role="listbox"
  aria-label="Slash commands"
  aria-multiselectable={multi ? true : undefined}
  data-testid="chat-slash-menu"
  class="chat-menu-in menu"
  data-config-keep
  onscroll={measure}
>
  {#if header}
    <li class="head" role="presentation">
      <!-- tabindex -1 and no focus steal, like the rows: the composer keeps the keyboard (Esc does the same as Back). -->
      <button type="button" tabindex="-1" class="back" aria-label="Back to all commands" onmousedown={(e) => e.preventDefault()} onclick={header.onBack}><Icon name="back" size="sm" />Back</button>
      <span class="gtitle">{header.title}</span>
      <span class="galias">{header.alias}</span>
    </li>
  {/if}
  {#each items as item, i (item.key)}
    {#if item.group && item.group !== items[i - 1]?.group}
      <li class="grp" role="presentation">{item.group}</li>
    {/if}
    <li role="option" aria-selected={item.multi ? item.active === true : i === selected}>
      <button
        type="button"
        tabindex="-1"
        class="row"
        class:sel={i === selected}
        class:active={item.active}
        class:off={item.disabled !== undefined}
        aria-disabled={item.disabled !== undefined}
        onmousedown={(e) => e.preventDefault()}
        onmouseenter={() => onHover(i)}
        onclick={() => void item.run()}
      >
        <span class="ico"><Icon name={icon(item)} size="sm" /></span>
        <span class="label">{item.label}</span>
        {#if item.badge}<span class="badge" role="img" aria-label="Thinking model"><Icon name={item.badge} size="sm" /></span>{/if}
        {#if item.hint}<span class="hint">{item.hint}</span>{/if}
        {#if item.detail}<span class="detail">{item.detail}</span>{/if}
      </button>
    </li>
  {/each}
  <li class="foot" class:fade={moreBelow} aria-hidden="true">
    {#if multi}
      Click or Tab toggles. Enter toggles and closes. Esc or a click away when done.
    {:else if header}
      ↑↓ to move, Enter to choose, Esc to go back
    {:else}
      ↑↓ to move, Tab to complete, Enter to run, Esc to close
    {/if}
  </li>
</ul>

<style>
  .menu {
    position: absolute;
    bottom: 100%;
    left: 0;
    right: 0;
    z-index: var(--cortex-z-drawer);
    /* The composer's own column and edges for both entry points (typing "/" and the Config button), never wider than the panel. */
    box-sizing: border-box;
    width: min(var(--cortex-chat-col), 100%);
    max-height: min(22rem, 55dvh);
    overflow-x: hidden;
    overflow-y: auto;
    overscroll-behavior: contain;
    scrollbar-width: thin;
    scrollbar-color: var(--cortex-line-strong) transparent;
    margin: 0 auto 6px;
    border: 1px solid var(--cortex-line-strong);
    padding: 4px;
    list-style: none;
    border-radius: var(--cortex-r-panel);
    background: var(--cortex-surface-1);
    box-shadow: var(--cortex-shadow-pop);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 8px;
    border: 0;
    border-radius: var(--cortex-r-ctl);
    background: none;
    color: var(--cortex-text-2);
    font: inherit;
    font-size: var(--cortex-t-sm);
    text-align: left;
    cursor: pointer;
  }
  .head { display: flex; align-items: center; gap: 8px; padding: 0 0 4px; margin-bottom: 2px; border-bottom: 1px solid var(--cortex-line); }
  .back { display: inline-flex; align-items: center; gap: 6px; padding: 4px 8px 4px 6px; border: 0; border-radius: var(--cortex-r-ctl); background: none; color: var(--cortex-text-2); font: inherit; font-size: var(--cortex-t-sm); cursor: pointer; }
  .back:hover { background: var(--cortex-surface-2); color: var(--cortex-text); }
  .gtitle { font-size: var(--cortex-t-sm); font-weight: 600; color: var(--cortex-text); }
  .galias { font-family: var(--cortex-font-data); font-size: var(--cortex-t-xs); color: var(--cortex-text-3); }
  .row.sel { background: var(--cortex-surface-2); color: var(--cortex-text); }
  .row.off, .row.off .label { cursor: not-allowed; color: var(--cortex-text-3); }
  .ico { display: inline-flex; color: var(--cortex-text-3); }
  .row.sel .ico, .row.active .ico, .badge { color: var(--cortex-accent); }
  .badge { display: inline-flex; }
  .label { flex-shrink: 0; max-width: 60%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--cortex-text); font-family: var(--cortex-font-data); font-size: var(--cortex-t-xs); }
  .hint { flex: 0 1 auto; min-width: 0; max-width: 40%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--cortex-t-xs); color: var(--cortex-text-3); }
  .detail { min-width: 0; flex: 1; padding-left: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: right; font-size: var(--cortex-t-xs); color: var(--cortex-text-3); }
  /* Sticks to the bottom edge; while rows are hidden below it fades the last visible one out. */
  .grp { padding: 6px 8px 2px; font-size: var(--cortex-t-xs); font-weight: 600; color: var(--cortex-text-2); }
  .foot { position: sticky; bottom: -4px; padding: 6px 8px 4px; margin: 0 -4px -4px; background: var(--cortex-surface-1); font-size: var(--cortex-t-2xs); color: var(--cortex-text-3); }
  .foot.fade { box-shadow: 0 -10px 10px -4px var(--cortex-surface-1); }
</style>
