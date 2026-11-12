<script lang="ts">
  /**
   * Chat quick bar: skills queued for the next message, the model chip, one chip per
   * setting changed from its default (`composerBar`, `chat-composer-bar.ts`), and a
   * Config button. Config opens a popover anchored to the button (`placePopover`:
   * flips and shifts to stay on screen). It opens on a menu of the setting groups
   * (Model, Reasoning, Tools, Workspace, Limits); a group drills into its rows, with a
   * header row holding Back and the group's name. A row hands its slash command to the
   * composer via `onPick` and the popover steps aside while that picker shows; when the
   * picker closes the user is back on the group (`config-menu-nav.ts`). Escape goes up
   * one level before it closes; a click outside closes. It sits at the top of the
   * composer panel (spec section 8).
   */
  import { tick } from "svelte";
  import Chip from "$lib/components/kit/Chip.svelte";
  import { tooltip } from "$lib/actions/tooltip.js";
  import Icon from "$lib/components/kit/Icon.svelte";
  import type { QuickBarChip } from "$lib/chat-quickbar-chips.js";
  import type { ConfigGroup } from "$lib/chat-composer-bar.js";
  import { CLOSED_NAV, configNavReduce, groupOf, groupSummary, type ConfigNav, type ConfigNavEvent } from "$lib/config-menu-nav.js";
  import { placePopover, type PopPlacement } from "$lib/popover-placement.js";
  import type { IconName } from "$lib/icons.js";

  interface Props {
    queuedSkills: string[];
    chips: readonly QuickBarChip[];
    /** Changed settings that did not fit on the bar (they are in the popover). */
    hidden?: number;
    groups?: readonly ConfigGroup[];
    /** Tool disclosure in words, for the Tools group. */
    disclosure?: { readonly text: string; readonly explain: string };
    /** Where the user is in the Config popover; the host reads it to label the picker a row opened. */
    nav?: ConfigNav;
    /** A picker (the slash menu or a dialog) is showing; when it closes the popover returns to its group. */
    pickerOpen?: boolean;
    onRemoveSkill: (name: string) => void;
    onPick: (cmd: string) => void;
  }
  let { queuedSkills, chips, hidden = 0, groups = [], disclosure, nav = $bindable(CLOSED_NAV), pickerOpen = false, onRemoveSkill, onPick }: Props = $props();

  let explaining = $state(false);
  let root = $state<HTMLDivElement | null>(null);
  let trigger = $state<HTMLButtonElement | null>(null);
  let pop = $state<HTMLDivElement | null>(null);
  let placed = $state<PopPlacement | null>(null);

  const GROUP_ICON: Record<string, IconName> = { Model: "model", Reasoning: "strategy", Tools: "tool", Workspace: "folder", Limits: "steps" };
  const group = $derived(groupOf(groups, nav));
  // A group that vanished (a setting removed it) falls back to the menu.
  const view = $derived(nav.open && nav.level === "group" && group ? "group" : "menu");

  const go = (e: ConfigNavEvent) => (nav = configNavReduce(nav, e));
  const pick = (cmd: string) => {
    go({ type: "pick", cmd });
    onPick(cmd);
  };
  /** Back and Escape: one level up. Closing from the menu hands focus back to the Config button. */
  const up = (e: "back" | "escape") => {
    const closing = view === "menu";
    go({ type: e });
    if (closing) trigger?.focus();
  };
  const onWindowPointer = (e: PointerEvent) => {
    if (!nav.open && nav.level !== "item") return;
    if (!(e.target instanceof Element)) return;
    // The picker a row opened belongs to this popover (`data-config-keep`).
    if (root?.contains(e.target) || e.target.closest("[data-config-keep]")) return;
    go({ type: "outside" });
  };
  const onKeydown = (e: KeyboardEvent) => {
    // A handled Escape (the composer closing the picker this popover opened) is not a second step back.
    if (!nav.open || e.key !== "Escape" || e.defaultPrevented) return;
    e.preventDefault();
    e.stopPropagation();
    up("escape");
  };
  /** Arrow keys move through the popover's buttons. */
  const onPopKeydown = (e: KeyboardEvent) => {
    const items = Array.from(pop?.querySelectorAll<HTMLElement>("[data-nav-item]") ?? []);
    const at = items.indexOf(document.activeElement as HTMLElement);
    const move = (to: number) => {
      e.preventDefault();
      items[(to + items.length) % items.length]?.focus();
    };
    if (e.key === "ArrowDown") move(at + 1);
    else if (e.key === "ArrowUp") move(at < 0 ? -1 : at - 1);
    else if (e.key === "Home") move(0);
    else if (e.key === "End") move(-1);
    else if (e.key === "ArrowLeft" && view === "group") {
      e.preventDefault();
      go({ type: "back" });
    }
  };

  // The picker closed (a pick, Escape, Back): land on the group again.
  $effect(() => {
    if (nav.level === "item" && !pickerOpen) go({ type: "picker-closed" });
  });

  // Anchor to the Config button: measure the natural size, place, and re-place on resize.
  const place = () => {
    if (!trigger || !pop) return;
    pop.style.maxHeight = "none";
    const size = { width: pop.offsetWidth, height: pop.offsetHeight };
    placed = placePopover({ trigger: trigger.getBoundingClientRect(), size, viewport: { width: innerWidth, height: innerHeight }, side: "top", align: "end" });
  };
  $effect(() => {
    if (!nav.open) {
      placed = null;
      return;
    }
    void view;
    void explaining;
    void groups;
    void tick().then(() => {
      place();
      // Land on the first control of the level that just opened (keyboard users start there).
      if (!pop?.contains(document.activeElement)) pop?.querySelector<HTMLElement>("[data-nav-item]")?.focus();
    });
  });
</script>

<svelte:window onpointerdown={onWindowPointer} onkeydown={onKeydown} onresize={() => nav.open && place()} />

<!-- data-slash-menu-keep: a chip click switches pickers itself, so the slash menu's click-outside ignores the bar. -->
<div data-slash-menu-keep class="quick" role="toolbar" aria-label="Chat settings" bind:this={root}>
  {#each queuedSkills as name (name)}
    <button type="button" class="skill" use:tooltip={"Active for your next message only. Click to remove."} aria-label="Remove {name} from the next message" onclick={() => onRemoveSkill(name)}>
      <Icon name="bolt" size="sm" />{name}<Icon name="x" size="sm" />
    </button>
  {/each}
  {#each chips as chip (chip.cmd)}
    <Chip icon={chip.icon} on={chip.on === true} title={chip.title ?? chip.text} class="quick-chip" onclick={() => { go({ type: "outside" }); onPick(chip.cmd); }}><span class="txt">{chip.text}</span></Chip>
  {/each}
  {#if groups.length > 0}
    <button type="button" class="config" class:open={nav.open} bind:this={trigger} aria-haspopup="dialog" aria-expanded={nav.open} onclick={() => go({ type: "toggle" })} use:tooltip={"Every chat setting: model, reasoning, tools, workspace, limits"}>
      <Icon name="settings" size="sm" />Config{#if hidden > 0}<span class="more">+{hidden}</span>{/if}
    </button>
  {/if}

  {#if nav.open}
    <!-- Fixed to the Config button's rect (placePopover); hidden until measured so it never flashes elsewhere. -->
    <div
      class="pop"
      role="dialog"
      aria-label={view === "group" && group ? `Chat configuration: ${group.title}` : "Chat configuration"}
      tabindex="-1"
      bind:this={pop}
      onkeydown={onPopKeydown}
      style:left="{placed?.left ?? 0}px"
      style:top="{placed?.top ?? 0}px"
      style:max-height={placed ? `${placed.maxHeight}px` : undefined}
      style:visibility={placed ? "visible" : "hidden"}
    >
      {#if view === "group" && group}
        <div class="head">
          <button type="button" class="back" data-nav-item aria-label="Back to all settings" onclick={() => up("back")}><Icon name="back" size="sm" />Back</button>
          <h3 class="gtitle">{group.title}</h3>
        </div>
        {#each group.rows as r (r.cmd)}
          <button type="button" class="row" class:on={r.on} data-nav-item onclick={() => pick(r.cmd)}>
            <Icon name={r.icon} size="sm" />
            <span class="lab">{r.label}</span>
            <span class="val">{r.value}</span>
          </button>
        {/each}
        {#if group.title === "Tools" && disclosure}
          <p class="note">
            <button type="button" class="why" data-nav-item aria-expanded={explaining} onclick={() => (explaining = !explaining)}>What is tool disclosure?</button>
          </p>
          {#if explaining}<p class="note explain">{disclosure.explain}</p>{/if}
        {/if}
      {:else}
        <h3 class="mtitle">Chat settings</h3>
        {#each groups as g (g.title)}
          <button type="button" class="grp" data-nav-item onclick={() => go({ type: "enter-group", group: g.title })}>
            <Icon name={GROUP_ICON[g.title] ?? "settings"} size="sm" />
            <span class="gname">{g.title}</span>
            <span class="gsum">{groupSummary(g)}</span>
            <Icon name="chevron" size="sm" />
          </button>
        {/each}
      {/if}
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
  /* Fixed to the Config button (placePopover sets left, top and max-height); never wider than the viewport. */
  .pop {
    position: fixed;
    width: min(360px, calc(100vw - 16px));
    overflow-y: auto;
    padding: 6px;
    border: 1px solid var(--cortex-line-strong);
    border-radius: var(--cortex-r-panel);
    background: var(--cortex-surface-1);
    box-shadow: var(--cortex-shadow-pop);
    z-index: var(--cortex-z-drawer);
    display: grid;
    gap: 2px;
    outline: none;
  }
  .mtitle { margin: 0; padding: 4px 8px 6px; font-size: var(--cortex-t-xs); font-weight: 600; color: var(--cortex-text-3); }
  .head { display: flex; align-items: center; gap: 8px; padding-bottom: 4px; margin-bottom: 2px; border-bottom: 1px solid var(--cortex-line); }
  .gtitle { margin: 0; font-size: var(--cortex-t-sm); font-weight: 600; color: var(--cortex-text); }
  .back, .grp {
    display: flex;
    align-items: center;
    gap: 8px;
    border: 0;
    border-radius: var(--cortex-r-ctl);
    background: transparent;
    color: var(--cortex-text-2);
    font: inherit;
    font-size: var(--cortex-t-sm);
    text-align: left;
    cursor: pointer;
  }
  .back { padding: 4px 8px 4px 6px; }
  .grp { width: 100%; padding: 8px; }
  .back:hover, .grp:hover { background: var(--cortex-surface-2); color: var(--cortex-text); }
  .back:focus-visible, .grp:focus-visible { outline: 2px solid var(--cortex-focus); outline-offset: -2px; }
  .gname { color: var(--cortex-text); font-weight: 500; }
  .gsum { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: right; font-family: var(--cortex-font-data); font-size: var(--cortex-t-xs); color: var(--cortex-text-3); }
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
