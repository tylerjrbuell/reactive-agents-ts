<script lang="ts">
  /**
   * The one overlay: a centred `modal` or a right-side `drawer`, on the layer
   * scale (`z-modal` 40, `z-drawer` 30) with one scrim. `role="dialog"`,
   * `aria-modal`, labelled by its title. Esc and a scrim press close it, Tab
   * stays inside (`lib/overlay-focus.ts`), and focus returns to the element
   * that had it when the overlay opened. Replaces the six hand-built modals
   * (spec A10) as pages move to the kit.
   */
  import type { Snippet } from "svelte";
  import { FOCUSABLE_SELECTOR, overlayKeyAction, trapFocusIndex } from "../../overlay-focus.js";
  import IconButton from "./IconButton.svelte";

  interface Props {
    open: boolean;
    title: string;
    kind?: "modal" | "drawer";
    onclose: () => void;
    /** Footer actions (right-aligned). */
    actions?: Snippet;
    /** Panel width in px (modal 480, drawer 420 by default). */
    width?: number;
    class?: string;
    children: Snippet;
  }

  let { open, title, kind = "modal", onclose, actions, width, class: className = "", children }: Props = $props();

  const uid = $props.id();
  let panel: HTMLDivElement | undefined = $state();

  $effect(() => {
    if (!open || !panel) return;
    const returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first = panel.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    (first ?? panel).focus();
    return () => returnTo?.focus();
  });

  function onKeydown(e: KeyboardEvent) {
    const action = overlayKeyAction(e.key);
    if (action === "close") {
      e.preventDefault();
      onclose();
      return;
    }
    if (action !== "trap" || !panel) return;
    const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    const current = items.indexOf(document.activeElement as HTMLElement);
    const next = trapFocusIndex(current, items.length, e.shiftKey);
    if (next === null) return;
    e.preventDefault();
    items[next]?.focus();
  }
</script>

{#if open}
  <div class="cx-overlay cx-overlay-{kind}" data-kind={kind}>
    <button type="button" class="cx-scrim" aria-label="Close {title}" tabindex="-1" onclick={onclose}></button>
    <div
      bind:this={panel}
      class="cx-overlay-panel {className}"
      role="dialog"
      aria-modal="true"
      aria-labelledby="{uid}-title"
      tabindex="-1"
      style:width={width ? `${width}px` : undefined}
      onkeydown={onKeydown}
    >
      <header class="cx-overlay-h">
        <h2 id="{uid}-title">{title}</h2>
        <IconButton icon="x" label="Close" size="sm" onclick={onclose} />
      </header>
      <div class="cx-overlay-b">{@render children()}</div>
      {#if actions}<footer class="cx-overlay-f">{@render actions()}</footer>{/if}
    </div>
  </div>
{/if}

<style>
  .cx-overlay { position: fixed; inset: 0; display: flex; }
  .cx-overlay-modal { z-index: var(--cortex-z-modal); align-items: center; justify-content: center; padding: 24px; }
  .cx-overlay-drawer { z-index: var(--cortex-z-drawer); justify-content: flex-end; }
  .cx-scrim {
    position: absolute;
    inset: 0;
    border: 0;
    padding: 0;
    background: rgb(var(--cortex-canvas-rgb) / 0.7);
    backdrop-filter: blur(2px);
    cursor: default;
  }
  .cx-overlay-panel {
    position: relative;
    display: flex;
    flex-direction: column;
    max-height: 100%;
    background: var(--cortex-surface-1);
    color: var(--cortex-text);
    box-shadow: var(--cortex-shadow-pop);
    outline: none;
  }
  .cx-overlay-modal .cx-overlay-panel { width: min(480px, 100%); border-radius: var(--cortex-r-panel); }
  .cx-overlay-drawer .cx-overlay-panel { width: min(420px, 100vw); height: 100%; border-left: 1px solid var(--cortex-line); }
  .cx-overlay-h { display: flex; align-items: center; gap: 8px; padding: 12px 12px 12px 16px; border-bottom: 1px solid var(--cortex-line); }
  .cx-overlay-h h2 { margin: 0; flex: 1; min-width: 0; font-size: var(--cortex-t-md); font-weight: 600; }
  .cx-overlay-b { padding: 16px; overflow: auto; }
  .cx-overlay-f { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--cortex-line); }
</style>
