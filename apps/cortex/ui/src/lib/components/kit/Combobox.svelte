<script lang="ts">
  /**
   * Searchable pick list: type to filter, arrows move (wrapping), Enter picks,
   * Esc closes. Replaces a native select where the list can run to hundreds of
   * rows (agents): at most `cap` rows are in the DOM, ranked and grouped by
   * `filterComboItems` (`lib/combobox.ts`), with a line saying how many more
   * match. The input keeps focus; the list is a listbox the input controls
   * (`aria-activedescendant`), the same pattern as the command palette.
   */
  import Icon from "./Icon.svelte";
  import { COMBO_CAP, comboSelectedLabel, filterComboItems, stepIndex, type ComboItem } from "../../combobox.js";

  interface Props {
    id: string;
    /** The chosen item's `value` (`""` = none). Bindable. */
    value?: string;
    items: readonly ComboItem[];
    /** Shown in the closed input when nothing is chosen. */
    placeholder?: string;
    /** Accessible name of the input and the list. */
    label: string;
    /** Shown when no row matches. */
    emptyText?: string;
    cap?: number;
    onpick?: (value: string) => void;
  }
  let { id, value = $bindable(""), items, placeholder = "Search", label, emptyText = "Nothing matches", cap = COMBO_CAP, onpick }: Props = $props();

  const uid = $props.id();
  const listId = `${uid}-list`;
  const optionId = (i: number) => `${uid}-opt-${i}`;

  let open = $state(false);
  let query = $state("");
  let active = $state(0);
  let inputEl = $state<HTMLInputElement>();

  const view = $derived(filterComboItems(items, query, cap));
  const closedText = $derived(comboSelectedLabel(items, value));
  const indexOf = (item: ComboItem): number => view.flat.indexOf(item);

  function openList() {
    if (open) return;
    open = true;
    query = "";
    active = Math.max(0, view.flat.findIndex((i) => i.value === value));
  }

  function closeList() {
    open = false;
    query = "";
  }

  function pick(item: ComboItem | undefined) {
    if (!item) return;
    value = item.value;
    closeList();
    onpick?.(item.value);
  }

  function onKeydown(e: KeyboardEvent) {
    switch (e.key) {
      case "ArrowDown":
      case "ArrowUp":
        e.preventDefault();
        if (!open) return openList();
        active = stepIndex(active, e.key === "ArrowDown" ? 1 : -1, view.flat.length);
        return;
      case "Enter":
        if (e.isComposing || !open) return;
        e.preventDefault();
        pick(view.flat[active]);
        return;
      case "Escape":
        if (!open) return;
        e.preventDefault();
        e.stopPropagation();
        closeList();
        return;
      case "Tab":
        closeList();
        return;
    }
  }

  // A new query starts at the best match.
  $effect(() => {
    void query;
    active = 0;
  });

  // Keep the active row visible.
  $effect(() => {
    if (!open || view.flat.length === 0) return;
    document.getElementById(optionId(active))?.scrollIntoView({ block: "nearest" });
  });
</script>

<div class="cb">
  <span class="cb-ico" aria-hidden="true"><Icon name="search" size="sm" /></span>
  <input
    {id}
    bind:this={inputEl}
    class="cx-control cb-input"
    type="text"
    role="combobox"
    aria-label={label}
    aria-autocomplete="list"
    aria-expanded={open}
    aria-controls={listId}
    aria-activedescendant={open && view.flat.length > 0 ? optionId(active) : undefined}
    placeholder={open ? "Type to filter" : value === "" ? placeholder : closedText}
    value={open ? query : value === "" ? "" : closedText}
    onfocus={openList}
    onclick={openList}
    oninput={(e) => {
      if (!open) open = true;
      query = e.currentTarget.value;
    }}
    onblur={closeList}
    onkeydown={onKeydown}
    autocomplete="off"
    spellcheck={false}
  />
  {#if open}
    <div class="cb-list" id={listId} role="listbox" aria-label={label}>
      {#each view.sections as section (section.group)}
        <div role="group" aria-label={section.group || undefined}>
          {#if section.group}<div class="cb-group">{section.group}</div>{/if}
          {#each section.items as item (item.value)}
            {@const i = indexOf(item)}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <div
              id={optionId(i)}
              class="cb-row"
              class:sel={i === active}
              class:chosen={item.value === value}
              role="option"
              tabindex="-1"
              aria-selected={item.value === value}
              onmousemove={() => (active = i)}
              onmousedown={(e) => e.preventDefault()}
              onclick={() => pick(item)}
            >
              <span class="cb-label">{item.label}</span>
              {#if item.hint}<span class="cb-hint">{item.hint}</span>{/if}
            </div>
          {/each}
        </div>
      {/each}
      {#if view.total === 0}
        <p class="cb-note" role="status">{emptyText}</p>
      {:else if view.hidden > 0}
        <p class="cb-note" role="status">{view.hidden} more match. Keep typing to narrow the list.</p>
      {/if}
    </div>
  {/if}
</div>

<style>
  .cb { position: relative; min-width: 16rem; }
  .cb-ico { position: absolute; left: 10px; top: 50%; translate: 0 -50%; color: var(--cortex-text-3); pointer-events: none; display: inline-flex; }
  .cb-input { width: 100%; padding-left: 32px; }
  .cb-list {
    position: absolute; z-index: var(--cortex-z-drawer); left: 0; right: 0; top: calc(100% + 4px);
    max-height: 320px; overflow-y: auto; padding: 4px;
    border: 1px solid var(--cortex-line-strong); border-radius: var(--cortex-r-ctl);
    background: var(--cortex-surface-2); box-shadow: 0 8px 24px rgb(0 0 0 / 0.18);
  }
  .cb-group { padding: 6px 8px 2px; font-size: var(--cortex-t-xs); color: var(--cortex-text-3); }
  .cb-row { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; padding: 6px 8px; border-radius: 6px; cursor: pointer; }
  .cb-row.sel { background: var(--cortex-surface-3); }
  .cb-row.chosen .cb-label { color: var(--cortex-accent); }
  .cb-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--cortex-t-sm); color: var(--cortex-text); }
  .cb-hint { flex: none; font-family: var(--cortex-font-data); font-size: var(--cortex-t-xs); color: var(--cortex-text-3); }
  .cb-note { margin: 0; padding: 8px; font-size: var(--cortex-t-xs); color: var(--cortex-text-3); }
</style>
