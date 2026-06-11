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
    /** Popover placement relative to the button. */
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

  let open = $state(false);

  function choose(body: string) {
    open = false;
    onSelect(body);
  }
</script>

<div class="relative flex-shrink-0">
  <button
    type="button"
    onclick={() => (open = !open)}
    {title}
    aria-label={title}
    aria-expanded={open}
    class="flex items-center justify-center p-1.5 rounded border border-[var(--cortex-border)] text-outline
           hover:text-primary hover:border-primary/40 bg-transparent cursor-pointer transition-colors"
  >
    <span class="material-symbols-outlined text-[18px] leading-none">menu_book</span>
  </button>
  {#if open}
    <div
      class="absolute {placement === 'up' ? 'bottom-10' : 'top-10'} right-0 z-50 rounded-lg border border-[var(--cortex-border)]
             bg-surface-container-lowest shadow-lg"
    >
      <PromptLibrary onSelect={choose} {types} {defaultSaveType} />
    </div>
  {/if}
</div>
