<script module lang="ts">
  import type { IconName } from "$lib/icons.js";

  /** One menu row. */
  export interface RunMenuItem {
    readonly label: string;
    readonly icon?: IconName;
    readonly danger?: boolean;
    readonly disabled?: boolean;
    /** Runs on pick; a returned value or promise is ignored. */
    readonly onSelect: () => unknown;
  }
</script>

<script lang="ts">
  /**
   * A button that opens a short action menu (the run header's Export and More
   * menus). Same pattern as the chat Export menu: closes on an outside press,
   * on Escape (focus returns to the trigger) and after a pick.
   */
  import Button from "$lib/components/kit/Button.svelte";
  import IconButton from "$lib/components/kit/IconButton.svelte";
  import Icon from "$lib/components/kit/Icon.svelte";

  interface Props {
    /** Text trigger label; omit for an icon-only trigger (then `icon` and `title` are required). */
    label?: string;
    icon?: IconName;
    /** Accessible name of an icon-only trigger. */
    title?: string;
    variant?: "default" | "ghost";
    items: readonly RunMenuItem[];
  }
  const { label, icon, title, variant = "default", items }: Props = $props();

  let open = $state(false);
  let root = $state<HTMLDivElement | null>(null);

  function onDocPointer(e: PointerEvent) {
    if (open && root && e.target instanceof Node && !root.contains(e.target)) open = false;
  }
  function onKey(e: KeyboardEvent) {
    if (!open || e.key !== "Escape") return;
    open = false;
    root?.querySelector<HTMLElement>("[aria-haspopup]")?.focus();
  }
  function pick(item: RunMenuItem) {
    open = false;
    void item.onSelect();
  }
</script>

<svelte:document onpointerdown={onDocPointer} onkeydown={onKey} />

<div class="wrap" bind:this={root}>
  {#if label}
    <Button {variant} {icon} aria-haspopup="menu" aria-expanded={open} onclick={() => (open = !open)}>{label}</Button>
  {:else}
    <IconButton icon={icon ?? "dots"} label={title ?? "More actions"} aria-haspopup="menu" aria-expanded={open} onclick={() => (open = !open)} />
  {/if}
  {#if open}
    <div role="menu" class="menu">
      {#each items as item (item.label)}
        <button type="button" role="menuitem" class:danger={item.danger} disabled={item.disabled} onclick={() => pick(item)}>
          {#if item.icon}<Icon name={item.icon} size="sm" />{/if}
          {item.label}
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .wrap { position: relative; }
  .menu {
    position: absolute;
    right: 0;
    top: calc(100% + 4px);
    z-index: var(--cortex-z-drawer);
    min-width: 13rem;
    padding: 4px;
    border: 1px solid var(--cortex-line);
    border-radius: var(--cortex-r-ctl);
    background: var(--cortex-surface-1);
    box-shadow: var(--cortex-shadow-pop);
  }
  .menu button {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 7px 8px;
    border: 0;
    border-radius: 6px;
    background: none;
    color: var(--cortex-text);
    font: inherit;
    font-size: var(--cortex-t-sm);
    text-align: left;
    white-space: nowrap;
    cursor: pointer;
  }
  .menu button:hover:not(:disabled),
  .menu button:focus-visible { background: var(--cortex-surface-2); outline: none; }
  .menu button:disabled { opacity: 0.45; cursor: not-allowed; }
  .menu button.danger { color: var(--cortex-bad); }
</style>
