<script lang="ts">
  import PromptLibrary from "$lib/components/PromptLibrary.svelte";
  import type { PromptType } from "$lib/stores/prompt-store.js";

  interface Props {
    /** Called with the chosen prompt body. The popover closes itself. */
    onSelect: (body: string) => void;
    /** Restrict picker to these prompt types (e.g. ["system","persona"] next to a system-prompt field). */
    types?: PromptType[];
    /** Pre-selected type for the save form. */
    defaultSaveType?: PromptType;
    /** Preferred placement relative to the button; auto-flips if there is no room. */
    placement?: "up" | "down";
    title?: string;
  }
  let {
    onSelect,
    types = [],
    defaultSaveType = "snippet",
    placement = "up",
    title = "Prompt library",
  }: Props = $props();

  const MARGIN = 8;
  const MAX_H = 360;

  let open = $state(false);
  let btnEl = $state<HTMLButtonElement | null>(null);
  let panelEl = $state<HTMLDivElement | null>(null);
  /** Anchored to the button's edge (not a guessed panel height), so it hugs the button whatever its size. */
  let pos = $state<{ vertical: "top" | "bottom"; offset: number; left: number; maxH: number }>({ vertical: "bottom", offset: 0, left: MARGIN, maxH: MAX_H });

  function place() {
    if (!btnEl) return;
    const r = btnEl.getBoundingClientRect();
    const spaceAbove = r.top - MARGIN - 4;
    const spaceBelow = window.innerHeight - r.bottom - MARGIN - 4;
    const openUp = placement === "up" ? spaceAbove >= Math.min(MAX_H, spaceBelow) : spaceBelow < Math.min(MAX_H, spaceAbove);
    // Start at the button's left edge; `clampIntoViewport` shifts it once the panel's real width is known.
    const left = Math.max(MARGIN, r.left);
    pos = openUp
      ? { vertical: "bottom", offset: window.innerHeight - r.top + 4, left, maxH: Math.min(MAX_H, spaceAbove) }
      : { vertical: "top", offset: r.bottom + 4, left, maxH: Math.min(MAX_H, spaceBelow) };
  }

  /** Pull the panel back inside the viewport using its measured width (button may sit at either edge). */
  $effect(() => {
    if (!open || !panelEl) return;
    const w = panelEl.offsetWidth;
    const left = Math.max(MARGIN, Math.min(pos.left, window.innerWidth - w - MARGIN));
    if (left !== pos.left) pos = { ...pos, left };
  });

  function toggle() {
    open = !open;
    if (open) {
      place();
    }
  }

  function choose(body: string) {
    open = false;
    onSelect(body);
  }

  // Portal the panel to <body> so it escapes overflow/backdrop-blur clipping.
  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return {
      destroy() {
        node.remove();
      },
    };
  }

  function onWindowChange() {
    if (open) place();
  }

  function onDocPointerDown(e: PointerEvent) {
    if (!open) return;
    const target = e.target as Node;
    if (btnEl?.contains(target)) return;
    if (panelEl?.contains(target)) return;
    open = false;
  }
</script>

<svelte:window onresize={onWindowChange} onscroll={onWindowChange} />
<svelte:document onpointerdown={onDocPointerDown} />

<button
  bind:this={btnEl}
  type="button"
  onclick={toggle}
  {title}
  aria-label={title}
  aria-expanded={open}
  class="flex flex-shrink-0 items-center justify-center p-1.5 rounded border border-[var(--cortex-border)] text-outline
         hover:text-primary hover:border-primary/40 bg-transparent cursor-pointer transition-colors"
>
  <span class="material-symbols-outlined text-[18px] leading-none">menu_book</span>
</button>

{#if open}
  <div
    bind:this={panelEl}
    use:portal
    class="fixed z-[200] rounded-lg border border-[var(--cortex-border)] bg-surface-container-lowest shadow-2xl"
    style="{pos.vertical}: {pos.offset}px; left: {pos.left}px; max-height: {pos.maxH}px; max-width: calc(100vw - 16px); overflow-y: auto;"
  >
    <PromptLibrary onSelect={choose} {types} {defaultSaveType} />
  </div>
{/if}
