<script lang="ts">
  /**
   * Chat quick bar: skills queued for the next message, then one chip per commonly
   * changed setting (provider, model, strategy, tools, shell, workspace, step cap…).
   * A chip hands its slash command to the composer via `onPick` (the panel switches
   * pickers in one click, and the same chip again closes its picker).
   */
  import Tooltip from "$lib/components/Tooltip.svelte";
  import type { QuickBarChip } from "$lib/chat-quickbar-chips.js";

  interface Props {
    queuedSkills: string[];
    chips: QuickBarChip[];
    onRemoveSkill: (name: string) => void;
    onPick: (cmd: string) => void;
  }
  const { queuedSkills, chips, onRemoveSkill, onPick }: Props = $props();
</script>

<!-- data-slash-menu-keep: a chip click switches pickers itself, so the slash menu's click-outside ignores the bar. -->
<div data-slash-menu-keep class="flex flex-shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-[color:var(--cortex-border)] px-3 pt-2 text-[11px] text-[var(--cortex-text-muted)]">
  {#each queuedSkills as name (name)}
    <Tooltip text="Active for your next message only. Click to remove."><button
      type="button"
      onclick={() => onRemoveSkill(name)}
      class="flex cursor-pointer items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-primary transition-colors hover:bg-primary/20"
    >
      <span class="material-symbols-outlined text-[13px] leading-none">bolt</span>{name}
      <span class="material-symbols-outlined text-[13px] leading-none opacity-70">close</span>
    </button></Tooltip>
  {/each}
  {#each chips as chip (chip.cmd)}
    <Tooltip text={chip.title ?? ""} class="min-w-0 max-w-full"><button
      type="button"
      onclick={() => onPick(chip.cmd)}
      class="flex min-w-0 max-w-full cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 transition-colors hover:bg-[var(--cortex-surface-low)] hover:text-[var(--cortex-text)]"
    >
      <span class="material-symbols-outlined text-[14px] leading-none">{chip.icon}</span><span class="truncate">{chip.text}</span>
    </button></Tooltip>
  {/each}
</div>
