<script lang="ts">
  import type { Snippet } from "svelte";

  /**
   * Shared “Beacon desk” chrome: soft violet/cyan ambient fields behind page content.
   * Use on every full-height route so light/dark and depth match the home desk.
   */
  interface Props {
    children: Snippet;
    /** Extra classes on the outer shell (e.g. flex direction tweaks). */
    class?: string;
  }

  let { children, class: className = "" }: Props = $props();
</script>

<div class="relative h-full min-h-0 flex flex-col overflow-hidden {className}">
  <div
    class="pointer-events-none absolute top-1/4 left-1/3 h-[min(600px,60vh)] w-[min(600px,90vw)] rounded-full bg-primary/[0.06] blur-[100px] dark:bg-primary/[0.09]"
    aria-hidden="true"
  ></div>
  <div
    class="pointer-events-none absolute bottom-1/4 right-1/4 h-[min(400px,45vh)] w-[min(400px,70vw)] rounded-full bg-secondary/[0.05] blur-[85px] dark:bg-secondary/[0.08]"
    aria-hidden="true"
  ></div>
  {@render children()}
</div>
