<script lang="ts">
  /**
   * Chat quick bar: skills queued for the next message, the model chip, one chip per
   * setting changed from its default (`composerBar`, `chat-composer-bar.ts`), and a
   * Config button. Config opens the composer's one command surface (the same list that
   * typing `/` opens, `config-menu-nav.ts`) through `onPick("/")`; clicking it again
   * closes it. The surface itself is `ChatSlashMenu`, anchored to the composer.
   */
  import Chip from "$lib/components/kit/Chip.svelte";
  import { tooltip } from "$lib/actions/tooltip.js";
  import Icon from "$lib/components/kit/Icon.svelte";
  import type { QuickBarChip } from "$lib/chat-quickbar-chips.js";

  interface Props {
    queuedSkills: string[];
    chips: readonly QuickBarChip[];
    /** Changed settings that did not fit on the bar (they are in the command list). */
    hidden?: number;
    /** Show the Config button (a provider is chosen, so there is something to configure). */
    config?: boolean;
    /** The command surface is showing. */
    open?: boolean;
    onRemoveSkill: (name: string) => void;
    onPick: (cmd: string) => void;
  }
  let { queuedSkills, chips, hidden = 0, config = false, open = false, onRemoveSkill, onPick }: Props = $props();
</script>

<!-- data-slash-menu-keep: a chip click switches pickers itself, so the slash menu's click-outside ignores the bar. -->
<div data-slash-menu-keep class="quick" role="toolbar" aria-label="Chat settings">
  {#each queuedSkills as name (name)}
    <button type="button" class="skill" use:tooltip={"Active for your next message only. Click to remove."} aria-label="Remove {name} from the next message" onclick={() => onRemoveSkill(name)}>
      <Icon name="bolt" size="sm" />{name}<Icon name="x" size="sm" />
    </button>
  {/each}
  {#each chips as chip (chip.cmd)}
    <Chip icon={chip.icon} on={chip.on === true} title={chip.title ?? chip.text} class="quick-chip" onclick={() => onPick(chip.cmd)}><span class="txt">{chip.text}</span></Chip>
  {/each}
  {#if config}
    <button type="button" class="config" class:open aria-haspopup="listbox" aria-expanded={open} onclick={() => onPick("/")} use:tooltip={"Every chat setting and command: the same list as typing /"}>
      <Icon name="settings" size="sm" />Config{#if hidden > 0}<span class="more">+{hidden}</span>{/if}
    </button>
  {/if}
</div>

<style>
  .quick { position: relative; display: flex; flex-wrap: wrap; align-items: center; gap: 4px; padding: 8px 8px 0; min-width: 0; }
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
  .config {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 24px;
    padding: 0 8px;
    margin-left: auto;
    border: 1px solid var(--cortex-line);
    border-radius: var(--cortex-r-chip);
    background: transparent;
    color: var(--cortex-text-2);
    font: inherit;
    font-size: var(--cortex-t-xs);
    cursor: pointer;
  }
  .config:hover, .config.open { background: var(--cortex-surface-2); color: var(--cortex-text); }
  .config:focus-visible { outline: 2px solid var(--cortex-focus); outline-offset: 2px; }
  .more { font-family: var(--cortex-font-data); color: var(--cortex-accent); }
</style>
