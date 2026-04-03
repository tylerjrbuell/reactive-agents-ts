<script lang="ts">
  import { browser } from "$app/environment";
  import type { Snippet } from "svelte";
  import { onDestroy, tick } from "svelte";

  interface Props {
    /** Tooltip body; empty string hides the bubble */
    text: string;
    /** Preferred side; auto-flips when there is not enough room */
    placement?: "top" | "bottom";
    /** Extra classes on the trigger wrapper (width, flex, etc.) */
    class?: string;
    children: Snippet;
  }

  let {
    text,
    placement = "top",
    class: className = "",
    children,
  }: Props = $props();

  const body = $derived(text.trim());
  const hasBody = $derived(body.length > 0);

  const MARGIN = 10;
  const GAP = 8;

  let open = $state(false);
  /** Viewport-fixed top-left of the tooltip panel (px) */
  let tipLeft = $state(0);
  let tipTop = $state(0);
  /** Tooltip is drawn above the trigger (arrow on bottom edge toward target). */
  let tipAboveTrigger = $state(true);
  /** Arrow center X relative to the panel’s left edge (px), clamped inside the panel. */
  let tipArrowLeftPx = $state(16);

  let hideTimer: ReturnType<typeof setTimeout> | null = null;
  let triggerEl: HTMLElement | null = null;
  let panelEl: HTMLSpanElement | undefined = $state();

  function clearHideTimer() {
    if (hideTimer !== null) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
  }

  /**
   * Place the tooltip fully inside the viewport: flip above/below, clamp X,
   * prefer readable placement when both sides are tight.
   */
  function fitPanel(trigger: HTMLElement, panel: HTMLElement) {
    const r = trigger.getBoundingClientRect();
    const pr = panel.getBoundingClientRect();
    const w = pr.width;
    const h = pr.height;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const spaceAbove = r.top - MARGIN;
    const spaceBelow = vh - MARGIN - r.bottom;
    let preferTop = placement === "top";

    // Choose vertical side: prefer requested placement if it fits; else flip; else larger side
    let useAbove = preferTop;
    if (preferTop && h + GAP > spaceAbove && spaceBelow >= spaceAbove) {
      useAbove = false;
    } else if (!preferTop && h + GAP > spaceBelow && spaceAbove >= spaceBelow) {
      useAbove = true;
    } else if (preferTop && h + GAP > spaceAbove && h + GAP > spaceBelow) {
      useAbove = spaceAbove >= spaceBelow;
    } else if (!preferTop && h + GAP > spaceBelow && h + GAP > spaceAbove) {
      useAbove = spaceAbove > spaceBelow;
    }

    let top = useAbove ? r.top - GAP - h : r.bottom + GAP;
    // Final clamp so panel stays in view (scrollable panel may be shorter after max-h)
    top = Math.min(Math.max(MARGIN, top), vh - MARGIN - h);

    const cx = r.left + r.width / 2;
    let left = cx - w / 2;
    left = Math.min(Math.max(MARGIN, left), vw - MARGIN - w);

    const arrowHalf = 5;
    const arrowPad = 8;
    const arrowCenter = cx - left;
    const lo = arrowPad + arrowHalf;
    const hi = w - arrowPad - arrowHalf;
    tipArrowLeftPx = lo <= hi ? Math.min(Math.max(lo, arrowCenter), hi) : w / 2;
    tipAboveTrigger = useAbove;

    tipLeft = left;
    tipTop = top;
  }

  async function openAndFit(el: HTMLElement) {
    triggerEl = el;
    clearHideTimer();
    open = true;
    await tick();
    await tick();
    if (!triggerEl || !panelEl) return;
    requestAnimationFrame(() => {
      if (!triggerEl || !panelEl) return;
      fitPanel(triggerEl, panelEl);
      requestAnimationFrame(() => {
        if (triggerEl && panelEl) fitPanel(triggerEl, panelEl);
      });
    });
  }

  function showFrom(target: EventTarget | null) {
    if (!hasBody || !(target instanceof HTMLElement)) return;
    void openAndFit(target);
  }

  function scheduleHide() {
    clearHideTimer();
    hideTimer = setTimeout(() => {
      open = false;
      triggerEl = null;
      hideTimer = null;
    }, 120);
  }

  onDestroy(() => clearHideTimer());

  $effect(() => {
    if (!browser || !open) return;
    const refit = () => {
      if (triggerEl && panelEl) fitPanel(triggerEl, panelEl);
    };
    window.addEventListener("resize", refit);
    return () => window.removeEventListener("resize", refit);
  });
</script>

<!-- Trigger: tooltip panel is a sibling with position:fixed (viewport), high z-index -->
<span
  role="group"
  data-cortex-tip-root
  class="relative inline-flex max-w-full align-middle {className}"
  class:cursor-help={hasBody}
  onpointerenter={(e) => showFrom(e.currentTarget)}
  onpointerleave={scheduleHide}
  onfocusin={(e) => showFrom(e.currentTarget)}
  onfocusout={scheduleHide}
>
  {@render children()}
</span>

{#if open && hasBody}
  <span
    bind:this={panelEl}
    role="tooltip"
    class="cortex-tooltip-panel pointer-events-none fixed z-[99999] flex max-h-[min(40vh,18rem)] max-w-[min(100vw-1.5rem,22rem)] flex-col overflow-visible rounded-md border border-outline-variant/35 bg-surface-container-low text-left shadow-[0_10px_40px_-10px_rgba(0,0,0,0.55)] ring-1 ring-primary/[0.12] dark:shadow-[0_12px_40px_-8px_rgba(0,0,0,0.75)]"
    style:left="{tipLeft}px"
    style:top="{tipTop}px"
  >
    {#if !tipAboveTrigger}
      <span
        class="pointer-events-none absolute z-[1] box-border h-2 w-2 border-l border-t border-outline-variant/35 bg-surface-container-low"
        style:left="{tipArrowLeftPx}px"
        style:top="-5px"
        style:transform="translateX(-50%) translateY(-50%) rotate(45deg)"
        aria-hidden="true"
      ></span>
    {/if}
    <span
      class="min-h-0 max-h-full overflow-y-auto whitespace-pre-wrap break-words px-2.5 py-2 font-mono text-[10px] font-normal normal-case leading-relaxed tracking-normal text-on-surface/90"
    >
      {body}
    </span>
    {#if tipAboveTrigger}
      <span
        class="pointer-events-none absolute z-[1] box-border h-2 w-2 border-b border-r border-outline-variant/35 bg-surface-container-low"
        style:left="{tipArrowLeftPx}px"
        style:bottom="-5px"
        style:transform="translateX(-50%) translateY(50%) rotate(45deg)"
        aria-hidden="true"
      ></span>
    {/if}
  </span>
{/if}
