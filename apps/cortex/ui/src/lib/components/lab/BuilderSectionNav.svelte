<script lang="ts">
  /**
   * The Lab builder's section nav (Bench `lab.html`): "Find a setting" and one
   * entry per `BUILDER_NAV` group (registry in `lib/agent-config-sections.ts`).
   * Picking an entry shows that group's sections in the form column. The
   * filter narrows the list; when the current entry is filtered out, the first
   * match is picked so the form always shows something the user searched for.
   */
  import Icon from "$lib/components/kit/Icon.svelte";
  import { builderNavCount, filterBuilderNav } from "$lib/agent-config-sections.js";

  interface Props {
    /** Selected entry id (bindable). */
    value: string;
    /** For the Tools count. */
    config: { readonly tools?: readonly string[]; readonly terminalTools?: boolean };
  }
  let { value = $bindable(), config }: Props = $props();

  let query = $state("");
  const entries = $derived(filterBuilderNav(query));

  function onSearch() {
    const first = entries[0];
    if (first && !entries.some((e) => e.id === value)) value = first.id;
  }
</script>

<nav class="secnav" aria-label="Builder sections">
  <label class="sr-only" for="lab-find-setting">Find a setting</label>
  <input
    id="lab-find-setting"
    class="cx-control"
    type="search"
    placeholder="Find a setting"
    autocomplete="off"
    bind:value={query}
    oninput={onSearch}
  />
  <ul>
    {#each entries as entry (entry.id)}
      {@const n = builderNavCount(entry.id, config)}
      <li>
        <button type="button" aria-current={entry.id === value ? "true" : undefined} onclick={() => (value = entry.id)}>
          <Icon name={entry.icon} size="sm" />
          <span class="label">{entry.label}</span>
          {#if n !== undefined}<span class="n">{n}</span>{/if}
        </button>
      </li>
    {:else}
      <li class="none" role="status">No setting matches “{query.trim()}”.</li>
    {/each}
  </ul>
</nav>

<style>
  .secnav {
    display: grid;
    align-content: start;
    gap: 12px;
    padding: 16px 12px;
    border-right: 1px solid var(--cortex-line);
    overflow-y: auto;
    min-height: 0;
  }
  .secnav :global(.cx-control) { height: 30px; background: var(--cortex-surface-1); }
  ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
  button {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 10px;
    border: 0;
    border-radius: var(--cortex-r-ctl);
    background: transparent;
    color: var(--cortex-text-2);
    font-family: var(--cortex-font-ui);
    font-size: var(--cortex-t-sm);
    text-align: left;
    cursor: pointer;
  }
  button:hover { background: var(--cortex-surface-2); color: var(--cortex-text); }
  button[aria-current="true"] { background: var(--cortex-surface-2); color: var(--cortex-text); font-weight: 500; }
  button:focus-visible { outline: 2px solid var(--cortex-focus); outline-offset: -2px; }
  .label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .n { margin-left: auto; font-family: var(--cortex-font-data); font-size: var(--cortex-t-2xs); color: var(--cortex-accent); }
  .none { padding: 6px 10px; font-size: var(--cortex-t-xs); color: var(--cortex-text-3); }
</style>
