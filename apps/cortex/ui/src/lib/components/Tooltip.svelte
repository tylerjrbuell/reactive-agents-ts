<script lang="ts">
  /**
   * Wraps content in an inline span that carries the Cortex tooltip
   * (`use:tooltip`, `lib/actions/tooltip.ts`). Prefer the action directly on
   * the control; use this wrapper when the target is a component that does
   * not take a tooltip prop.
   */
  import type { Snippet } from "svelte";
  import { tooltip } from "$lib/actions/tooltip.js";

  interface Props {
    /** Tooltip body; empty string hides the bubble. */
    text: string;
    /** Preferred side; flips when there is not enough room. */
    placement?: "top" | "bottom";
    /** Extra classes on the trigger wrapper (width, flex, etc.). */
    class?: string;
    /** When true, never open. */
    disabled?: boolean;
    children: Snippet;
  }

  let { text, placement = "top", class: className = "", disabled = false, children }: Props = $props();
</script>

<span class="relative inline-flex max-w-full align-middle {className}" use:tooltip={{ text, placement, disabled }}>
  {@render children()}
</span>
