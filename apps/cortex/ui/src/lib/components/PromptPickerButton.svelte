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

  const PANEL_W = 288; // matches PromptLibrary min-w-[280px] + padding
  const MARGIN = 8;

  let open = $state(false);
  let btnEl = $state<HTMLButtonElement | null>(null);
  let panelEl = $state<HTMLDivElement | null>(null);
  let coords = $state<{ top: number; left: number }>({ top: 0, left: 0 });

  function place() {
    if (!btnEl) return;
    const r = btnEl.getBoundingClientRect();
    // Right-align panel to the button, then clamp into the viewport.
    let left = r.right - PANEL_W;
    left = Math.max(MARGIN, Math.min(left, window.innerWidth - PANEL_W - MARGIN));
    // Flip up/down based on available space below.
    const spaceBelow = window.innerHeight - r.bottom;
    const openUp = placement === "up" ? spaceBelow < 280 || r.top > 320 : spaceBelow < 280;
    const top = openUp ? Math.max(MARGIN, r.top - 4 - 320) : r.bottom + 4;
    coords = { top, left };
  }

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
    style="top: {coords.top}px; left: {coords.left}px; max-height: 320px; overflow-y: auto;"
  >
    <PromptLibrary onSelect={choose} {types} {defaultSaveType} />
  </div>
{/if}
