<script lang="ts">
  /**
   * Chat quick bar: skills queued for the next message, the model chip, one chip per
   * setting changed from its default (`composerBar`, `chat-composer-bar.ts`), and a
   * Config button. Config opens a popover that groups every setting (Model, Reasoning,
   * Tools, Workspace, Limits) with its current value; a row hands its slash command to
   * the composer via `onPick`, so it opens the same picker a chip always did. It sits at
   * the top of the composer panel (spec section 8).
   */
  import Chip from "$lib/components/kit/Chip.svelte";
  import { tooltip } from "$lib/actions/tooltip.js";
  import Icon from "$lib/components/kit/Icon.svelte";
  import type { QuickBarChip } from "$lib/chat-quickbar-chips.js";
  import type { ConfigGroup } from "$lib/chat-composer-bar.js";

  interface Props {
    queuedSkills: string[];
    chips: readonly QuickBarChip[];
    /** Changed settings that did not fit on the bar (they are in the popover). */
    hidden?: number;
    groups?: readonly ConfigGroup[];
    /** Tool disclosure in words, for the Tools group. */
    disclosure?: { readonly text: string; readonly explain: string };
    onRemoveSkill: (name: string) => void;
    onPick: (cmd: string) => void;
  }
  const { queuedSkills, chips, hidden = 0, groups = [], disclosure, onRemoveSkill, onPick }: Props = $props();

  let open = $state(false);
  let explaining = $state(false);
  let root = $state<HTMLDivElement | null>(null);
  const pick = (cmd: string) => {
    open = false;
    onPick(cmd);
  };
  const onWindowPointer = (e: PointerEvent) => {
    if (open && root && !root.contains(e.target as Node)) open = false;
  };
  const onKeydown = (e: KeyboardEvent) => {
    if (open && e.key === "Escape") {
      e.stopPropagation();
      open = false;
    }
  };
</script>

<svelte:window onpointerdown={onWindowPointer} onkeydown={onKeydown} />

<!-- data-slash-menu-keep: a chip click switches pickers itself, so the slash menu's click-outside ignores the bar. -->
<div data-slash-menu-keep class="quick" role="toolbar" aria-label="Chat settings" bind:this={root}>
  {#each queuedSkills as name (name)}
    <button type="button" class="skill" use:tooltip={"Active for your next message only. Click to remove."} aria-label="Remove {name} from the next message" onclick={() => onRemoveSkill(name)}>
      <Icon name="bolt" size="sm" />{name}<Icon name="x" size="sm" />
    </button>
  {/each}
  {#each chips as chip (chip.cmd)}
    <Chip icon={chip.icon} on={chip.on === true} title={chip.title ?? chip.text} class="quick-chip" onclick={() => pick(chip.cmd)}><span class="txt">{chip.text}</span></Chip>
  {/each}
  {#if groups.length > 0}
    <button type="button" class="config" class:open aria-haspopup="dialog" aria-expanded={open} onclick={() => (open = !open)} use:tooltip={"Every chat setting: model, reasoning, tools, workspace, limits"}>
      <Icon name="settings" size="sm" />Config{#if hidden > 0}<span class="more">+{hidden}</span>{/if}
    </button>
  {/if}

  {#if open}
    <div class="pop" role="dialog" aria-label="Chat configuration">
      {#each groups as g (g.title)}
        <section class="grp">
          <h3>{g.title}</h3>
          {#each g.rows as r (r.cmd)}
            <button type="button" class="row" class:on={r.on} onclick={() => pick(r.cmd)}>
              <Icon name={r.icon} size="sm" />
              <span class="lab">{r.label}</span>
              <span class="val">{r.value}</span>
            </button>
          {/each}
          {#if g.title === "Tools" && disclosure}
            <p class="note">
              <button type="button" class="why" aria-expanded={explaining} onclick={() => (explaining = !explaining)}>What is tool disclosure?</button>
            </p>
            {#if explaining}<p class="note explain">{disclosure.explain}</p>{/if}
          {/if}
        </section>
      {/each}
    </div>
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
  .config:focus-visible, .row:focus-visible, .why:focus-visible { outline: 2px solid var(--cortex-focus); outline-offset: 2px; }
  .more { font-family: var(--cortex-font-data); color: var(--cortex-accent); }
  /* Opens upward: the bar sits at the bottom of the screen. Width follows the composer, so it never overflows a narrow window. */
  .pop {
    position: absolute;
    left: 8px;
    right: 8px;
    bottom: calc(100% + 6px);
    max-width: 440px;
    max-height: min(70vh, 520px);
    overflow-y: auto;
    padding: 8px;
    border: 1px solid var(--cortex-line-strong);
    border-radius: var(--cortex-r-panel);
    background: var(--cortex-surface-1);
    box-shadow: var(--cortex-shadow-pop);
    z-index: var(--cortex-z-drawer);
    display: grid;
    gap: 8px;
  }
  .grp { display: grid; gap: 2px; }
  h3 { margin: 0; padding: 2px 8px; font-size: var(--cortex-t-xs); font-weight: 600; color: var(--cortex-text-3); }
  .row {
    display: grid;
    grid-template-columns: auto minmax(84px, auto) minmax(0, 1fr);
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border: 0;
    border-radius: var(--cortex-r-ctl);
    background: transparent;
    color: var(--cortex-text-2);
    font: inherit;
    font-size: var(--cortex-t-sm);
    text-align: left;
    cursor: pointer;
  }
  .row:hover { background: var(--cortex-surface-2); }
  .row.on .val { color: var(--cortex-accent); }
  .lab { color: var(--cortex-text); }
  .val { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: right; font-family: var(--cortex-font-data); font-size: var(--cortex-t-xs); color: var(--cortex-text-3); }
  .note { margin: 0; padding: 2px 8px; font-size: var(--cortex-t-xs); color: var(--cortex-text-3); line-height: var(--cortex-lh-ui); }
  .why { border: 0; background: transparent; padding: 0; margin-left: 4px; font: inherit; color: var(--cortex-accent); text-decoration: underline; cursor: pointer; }
  .explain { color: var(--cortex-text-2); }
</style>
