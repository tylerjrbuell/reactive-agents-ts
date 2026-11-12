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
    /** Set when the Config popover opened this menu: a Back row naming the group the user came from. */
    header?: { readonly title: string; readonly onBack: () => void };
  }
  const { items, selected, onHover, onDismiss, header }: Props = $props();

  let listEl = $state<HTMLUListElement | undefined>();
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
>
  {#if header}
    <li class="head" role="presentation">
      <!-- tabindex -1 and no focus steal, like the rows: the composer keeps the keyboard (Esc does the same as Back). -->
      <button type="button" tabindex="-1" class="back" aria-label="Back to {header.title}" onmousedown={(e) => e.preventDefault()} onclick={header.onBack}><Icon name="back" size="sm" />Back</button>
      <span class="gtitle">{header.title}</span>
    </li>
  {/if}
  {#each items as item, i (item.key)}
    <li role="option" aria-selected={item.multi ? item.active === true : i === selected}>
      <button
        type="button"
        tabindex="-1"
        class="row"
        class:sel={i === selected}
        class:active={item.active}
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
  <li class="foot" aria-hidden="true">
    {#if multi}
      Click or Tab toggles. Enter toggles and closes. Esc or a click away when done.
    {:else if header}
      ↑↓ to move, Enter to choose, Esc to go back to {header.title}
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
    width: min(808px, calc(100% - 48px));
    max-height: 18rem;
    overflow-y: auto;
    margin: 0 auto 6px;
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
  .row.sel { background: var(--cortex-surface-2); color: var(--cortex-text); }
  .ico { display: inline-flex; color: var(--cortex-text-3); }
  .row.sel .ico, .row.active .ico, .badge { color: var(--cortex-accent); }
  .badge { display: inline-flex; }
  .label { flex-shrink: 0; max-width: 60%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--cortex-text); font-family: var(--cortex-font-data); font-size: var(--cortex-t-xs); }
  .hint { flex-shrink: 0; font-size: var(--cortex-t-xs); color: var(--cortex-text-3); }
  .detail { min-width: 0; flex: 1; padding-left: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: right; font-size: var(--cortex-t-xs); color: var(--cortex-text-3); }
  .foot { padding: 6px 8px 2px; font-size: var(--cortex-t-2xs); color: var(--cortex-text-3); }
</style>
