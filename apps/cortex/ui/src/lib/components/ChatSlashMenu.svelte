<script lang="ts">
  /**
   * The chat composer's slash menu (commands, or the choices of /model, /tools, …).
   * Keyboard navigation stays in ChatPanel (it owns the textarea); this renders the
   * list, reports hover via `onHover` and runs the clicked row.
   */
  import type { MenuItem } from "$lib/chat-menu.js";

  interface Props {
    items: MenuItem[];
    selected: number;
    onHover: (index: number) => void;
  }
  const { items, selected, onHover }: Props = $props();
</script>

<ul
  role="listbox"
  aria-label="Slash commands"
  class="chat-menu-in absolute bottom-full left-0 right-0 z-20 mb-2 max-h-64 overflow-y-auto rounded-lg border border-[color:var(--cortex-border)] bg-[var(--cortex-surface-low)] p-1 font-mono shadow-xl backdrop-blur-md"
>
  {#each items as item, i (item.key)}
    <li role="option" aria-selected={i === selected}>
      <button
        type="button"
        tabindex="-1"
        onmousedown={(e) => e.preventDefault()}
        onmouseenter={() => onHover(i)}
        onclick={() => void item.run()}
        class="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11px] transition-colors
               {i === selected ? 'bg-primary/15 text-[var(--cortex-text)]' : 'text-[var(--cortex-text-muted)]'}"
      >
        <span class="material-symbols-outlined text-[15px] leading-none {i === selected || item.active ? 'text-primary' : ''}">{item.active ? "check_circle" : item.icon}</span>
        <span class="max-w-[60%] flex-shrink-0 truncate text-[var(--cortex-text)]">{item.label}</span>
        {#if item.badge}<span class="material-symbols-outlined flex-shrink-0 text-[15px] leading-none text-primary" aria-label="Thinking model">{item.badge}</span>{/if}
        {#if item.hint}<span class="flex-shrink-0 text-[10px] opacity-60">{item.hint}</span>{/if}
        {#if item.detail}<span class="min-w-0 flex-1 truncate pl-3 text-right text-[10px]">{item.detail}</span>{/if}
      </button>
    </li>
  {/each}
  <li class="px-2 pb-0.5 pt-1 text-[9px] uppercase tracking-wider text-[var(--cortex-text-muted)]/70">
    ↑↓ navigate · Tab complete · Enter run · Esc close
  </li>
</ul>
