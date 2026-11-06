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

  interface Props {
    items: MenuItem[];
    selected: number;
    onHover: (index: number) => void;
    onDismiss: () => void;
  }
  const { items, selected, onHover, onDismiss }: Props = $props();

  let listEl = $state<HTMLUListElement | undefined>();
  const multi = $derived(items.some((i) => i.multi));

  $effect(() => {
    const onPointer = (e: PointerEvent) => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      if (listEl?.contains(t) || t.closest("[data-slash-menu-keep]")) return;
      onDismiss();
    };
    document.addEventListener("pointerdown", onPointer, true);
    return () => document.removeEventListener("pointerdown", onPointer, true);
  });

  const icon = (item: MenuItem) =>
    item.multi ? (item.active ? "check_box" : "check_box_outline_blank") : item.active ? "check_circle" : item.icon;
</script>

<ul
  bind:this={listEl}
  role="listbox"
  aria-label="Slash commands"
  aria-multiselectable={multi ? true : undefined}
  data-testid="chat-slash-menu"
  class="chat-menu-in absolute bottom-full left-3 right-3 z-20 mb-1 max-h-64 overflow-y-auto rounded-lg border border-[color:var(--cortex-border)] bg-[var(--cortex-surface-low)] p-1 font-mono shadow-xl backdrop-blur-md"
>
  {#each items as item, i (item.key)}
    <li role="option" aria-selected={item.multi ? item.active === true : i === selected}>
      <button
        type="button"
        tabindex="-1"
        onmousedown={(e) => e.preventDefault()}
        onmouseenter={() => onHover(i)}
        onclick={() => void item.run()}
        class="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11px] transition-colors
               {i === selected ? 'bg-primary/15 text-[var(--cortex-text)]' : 'text-[var(--cortex-text-muted)]'}"
      >
        <span class="material-symbols-outlined text-[15px] leading-none {i === selected || item.active ? 'text-primary' : ''}">{icon(item)}</span>
        <span class="max-w-[60%] flex-shrink-0 truncate text-[var(--cortex-text)]">{item.label}</span>
        {#if item.badge}<span class="material-symbols-outlined flex-shrink-0 text-[15px] leading-none text-primary" aria-label="Thinking model">{item.badge}</span>{/if}
        {#if item.hint}<span class="flex-shrink-0 text-[10px] opacity-60">{item.hint}</span>{/if}
        {#if item.detail}<span class="min-w-0 flex-1 truncate pl-3 text-right text-[10px]">{item.detail}</span>{/if}
      </button>
    </li>
  {/each}
  <li class="px-2 pb-0.5 pt-1 text-[9px] uppercase tracking-wider text-[var(--cortex-text-muted)]/70">
    {#if multi}
      Click or Tab toggles · Enter toggle and close · Esc or click away when done
    {:else}
      ↑↓ navigate · Tab complete · Enter run · Esc close
    {/if}
  </li>
</ul>
