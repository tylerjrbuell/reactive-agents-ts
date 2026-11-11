<script lang="ts">
  /**
   * Chat quick bar: skills queued for the next message, then one chip per commonly
   * changed setting (provider, model, strategy, tools, shell, workspace, step cap…).
   * A chip hands its slash command to the composer via `onPick` (the panel switches
   * pickers in one click, and the same chip again closes its picker). It sits at the
   * top of the composer panel (spec section 8).
   */
  import Chip from "$lib/components/kit/Chip.svelte";
  import Icon from "$lib/components/kit/Icon.svelte";
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
<div data-slash-menu-keep class="quick" role="toolbar" aria-label="Chat settings">
  {#each queuedSkills as name (name)}
    <button type="button" class="skill" title="Active for your next message only. Click to remove." aria-label="Remove {name} from the next message" onclick={() => onRemoveSkill(name)}>
      <Icon name="bolt" size="sm" />{name}<Icon name="x" size="sm" />
    </button>
  {/each}
  {#each chips as chip (chip.cmd)}
    <Chip icon={chip.icon} on={chip.on === true} title={chip.title ?? chip.text} class="quick-chip" onclick={() => onPick(chip.cmd)}><span class="txt">{chip.text}</span></Chip>
  {/each}
</div>

<style>
  .quick { display: flex; flex-wrap: wrap; gap: 4px; padding: 8px 8px 0; min-width: 0; }
  .quick :global(.quick-chip) { max-width: 100%; min-width: 0; }
  .txt { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .skill {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 24px;
    padding: 0 8px;
    border: 0;
    border-radius: var(--cortex-r-chip);
    background: var(--cortex-accent-tint);
    color: var(--cortex-accent);
    font: inherit;
    font-size: var(--cortex-t-xs);
    cursor: pointer;
  }
</style>
