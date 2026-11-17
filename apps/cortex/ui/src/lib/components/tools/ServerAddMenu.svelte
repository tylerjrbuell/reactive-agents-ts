<script lang="ts">
  /**
   * The Add server menu: Quick line, Form, Import JSON. Each entry opens its own add flow (the
   * page decides what to show); Import JSON is one of the ways to add, not a mode switch.
   * Entries: `lib/mcp-servers-view.ts` (`ADD_MODES`).
   */
  import Button from "$lib/components/kit/Button.svelte";
  import { clickOutside } from "$lib/actions/click-outside.js";
  import { ADD_MODES, type AddMode } from "$lib/mcp-servers-view.js";

  interface Props {
    onPick: (mode: AddMode) => void;
  }
  const { onPick }: Props = $props();

  let open = $state(false);
  let trigger = $state<HTMLElement | null>(null);

  function pick(mode: AddMode) {
    open = false;
    onPick(mode);
  }
</script>

<div class="am" use:clickOutside={{ onclose: () => (open = false), ignore: [trigger] }}>
  <span bind:this={trigger} class="am-trigger">
    <Button variant="primary" size="field" icon="plus" aria-haspopup="menu" aria-expanded={open} onclick={() => (open = !open)}>Add server</Button>
  </span>
  {#if open}
    <ul class="am-menu" role="menu" aria-label="Add a server">
      {#each ADD_MODES as m (m.id)}
        <li role="none">
          <button type="button" role="menuitem" class="am-item" onclick={() => pick(m.id)}>
            <span class="am-label">{m.label}</span>
            <span class="am-hint">{m.hint}</span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .am { position: relative; display: inline-block; }
  .am-trigger { display: inline-flex; }
  .am-menu {
    position: absolute; right: 0; top: calc(100% + 4px); z-index: 30; min-width: 240px; margin: 0; padding: 4px; list-style: none;
    border: 1px solid var(--cortex-line-strong); border-radius: var(--cortex-r-panel); background: var(--cortex-surface-1); box-shadow: var(--cortex-shadow-pop, 0 8px 24px rgb(0 0 0 / 0.25));
  }
  .am-item { display: grid; gap: 2px; width: 100%; padding: 8px 10px; border: 0; border-radius: var(--cortex-r-ctl); background: none; text-align: left; cursor: pointer; font-family: var(--cortex-font-ui); }
  .am-item:hover, .am-item:focus-visible { background: var(--cortex-surface-2); outline: none; }
  .am-label { font-size: var(--cortex-t-sm); color: var(--cortex-text); }
  .am-hint { font-size: var(--cortex-t-xs); color: var(--cortex-text-3); }
</style>
