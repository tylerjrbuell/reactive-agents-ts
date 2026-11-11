<script lang="ts">
  /**
   * One session in the chats rail: a select button (name, model, relative time) and a
   * sibling "More actions" button with Edit settings, Rename and Delete. The two are
   * siblings, never nested (spec A9). The current chat carries `aria-current`.
   */
  import type { RailRow } from "$lib/chat-session-rail.js";
  import Icon from "$lib/components/kit/Icon.svelte";
  import IconButton from "$lib/components/kit/IconButton.svelte";
  import Status from "$lib/components/kit/Status.svelte";

  interface Props {
    row: RailRow;
    active: boolean;
    /** A reply is streaming in this chat. */
    running: boolean;
    onSelect: () => void;
    onEdit: (e: MouseEvent) => void;
    onRename: (e: MouseEvent) => void;
    onDelete: (e: MouseEvent) => void;
  }
  const { row, active, running, onSelect, onEdit, onRename, onDelete }: Props = $props();

  let menuOpen = $state(false);
  let root = $state<HTMLDivElement | null>(null);

  function onDocPointer(e: PointerEvent) {
    if (menuOpen && root && e.target instanceof Node && !root.contains(e.target)) menuOpen = false;
  }
  function onMenuKey(e: KeyboardEvent) {
    if (e.key === "Escape") {
      menuOpen = false;
      root?.querySelector<HTMLButtonElement>(".more")?.focus();
    }
  }
  const pick = (fn: (e: MouseEvent) => void) => (e: MouseEvent) => {
    menuOpen = false;
    fn(e);
  };
</script>

<svelte:document onpointerdown={onDocPointer} />

<div class="session" class:active bind:this={root} data-testid="chat-session-row">
  <button type="button" class="select" aria-current={active ? "page" : undefined} onclick={onSelect}>
    <span class="name">{row.name}</span>
    <span class="meta">
      {#if row.model}<span class="model">{row.model}</span>{/if}
      <time title={row.whenTitle}>{row.when}</time>
    </span>
  </button>
  {#if running}<span class="live"><Status tone="running" label="Running" dotOnly /></span>{/if}
  <IconButton icon="dots" size="sm" label="More actions for {row.name}" class="more" aria-haspopup="menu" aria-expanded={menuOpen} onclick={() => (menuOpen = !menuOpen)} />
  {#if menuOpen}
    <!-- svelte-ignore a11y_interactive_supports_focus -->
    <div class="menu chat-menu-in" role="menu" tabindex="-1" onkeydown={onMenuKey}>
      <button type="button" role="menuitem" onclick={pick(onEdit)}><Icon name="settings" size="sm" />Edit settings</button>
      <button type="button" role="menuitem" onclick={pick(onRename)}><Icon name="edit" size="sm" />Rename</button>
      <button type="button" role="menuitem" class="danger" onclick={pick(onDelete)}><Icon name="trash" size="sm" />Delete</button>
    </div>
  {/if}
</div>

<style>
  .session {
    position: relative;
    display: flex;
    align-items: center;
    gap: 4px;
    margin: 0 8px;
    padding-right: 4px;
    border-radius: var(--cortex-r-ctl);
  }
  .session:hover, .session.active { background: var(--cortex-surface-2); }
  .session.active { box-shadow: inset 2px 0 0 var(--cortex-accent); }
  .select {
    display: grid;
    gap: 2px;
    flex: 1;
    min-width: 0;
    padding: 8px 4px 8px 10px;
    border: 0;
    background: none;
    color: var(--cortex-text);
    font: inherit;
    text-align: left;
    cursor: pointer;
    border-radius: var(--cortex-r-ctl);
  }
  .name { font-size: var(--cortex-t-sm); font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .meta { display: flex; gap: 8px; min-width: 0; font-size: var(--cortex-t-xs); color: var(--cortex-text-3); }
  .model { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--cortex-font-data); font-size: var(--cortex-t-2xs); }
  time { flex: none; white-space: nowrap; }
  .live { display: inline-flex; flex: none; }
  .session :global(.more) { width: 24px; height: 24px; flex: none; opacity: 0; }
  .session:hover :global(.more),
  .session:focus-within :global(.more),
  .session.active :global(.more) { opacity: 1; }
  .menu {
    position: absolute;
    top: calc(100% - 4px);
    right: 4px;
    z-index: var(--cortex-z-drawer);
    display: grid;
    min-width: 11rem;
    padding: 4px;
    border-radius: var(--cortex-r-ctl);
    background: var(--cortex-surface-1);
    box-shadow: var(--cortex-shadow-pop);
    transform-origin: top right;
  }
  .menu button {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border: 0;
    border-radius: 6px;
    background: none;
    color: var(--cortex-text);
    font: inherit;
    font-size: var(--cortex-t-sm);
    text-align: left;
    cursor: pointer;
  }
  .menu button:hover, .menu button:focus-visible { background: var(--cortex-surface-2); }
  .menu .danger { color: var(--cortex-bad); }
  @media (hover: none) { .session :global(.more) { opacity: 1; } }
</style>
