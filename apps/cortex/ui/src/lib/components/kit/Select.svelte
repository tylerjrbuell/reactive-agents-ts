<script lang="ts">
  /**
   * Styled pick list that replaces the native select (a guard test keeps
   * native selects out of `ui/src`). A button opens a listbox anchored under it
   * (flips above near the bottom of the viewport, never leaves it, at least as
   * wide as the button). Nine or more options add a search box. Keys: Up and
   * Down move (wrapping, skipping disabled), Home and End jump, Enter or Space
   * picks, Esc closes (and only closes this layer), letters type ahead. The
   * list is portaled to the body so no scroll container clips it. Rules live in
   * `lib/select.ts`.
   *
   * `value` is bindable; `onchange` gets the new value after `value` is set.
   * With `name` a hidden input carries the value for a surrounding form.
   */
  import type { HTMLButtonAttributes } from "svelte/elements";
  import { tick } from "svelte";
  import Icon from "./Icon.svelte";
  import { portal } from "../../actions/portal.js";
  import { clickOutside } from "../../actions/click-outside.js";
  import {
    displayOrder,
    edgeActive,
    filterSelectOptions,
    groupSelectOptions,
    initialActive,
    placeListbox,
    selectedLabel,
    showSearch,
    stepActive,
    typeahead,
    type ListPlacement,
    type SelectOption,
  } from "../../select.js";

  interface Props extends Omit<HTMLButtonAttributes, "class" | "value" | "children" | "onchange" | "type" | "name"> {
    id: string;
    value?: string;
    options: readonly SelectOption[];
    /** Shown when `value` matches no option. */
    placeholder?: string;
    /** Called with the picked value, after `value` is set. */
    onchange?: (value: string) => void;
    /** Force the search box on or off (default: on from nine options). */
    searchable?: boolean;
    /** Form field name; adds a hidden input carrying the value. */
    name?: string;
    invalid?: boolean;
    describedBy?: string;
    class?: string;
  }

  let {
    id,
    value = $bindable(""),
    options,
    placeholder = "Select",
    onchange,
    searchable,
    name,
    invalid = false,
    describedBy,
    class: className = "",
    disabled = false,
    ...rest
  }: Props = $props();

  const uid = $props.id();
  const listId = `${uid}-list`;
  const optionId = (i: number) => `${uid}-o${i}`;

  let open = $state(false);
  let query = $state("");
  let active = $state(-1);
  let place = $state<ListPlacement>();
  let trigger = $state<HTMLButtonElement>();
  let listEl = $state<HTMLDivElement>();
  let searchEl = $state<HTMLInputElement>();
  let buffer = "";
  let lastKey = 0;

  const searchOn = $derived(showSearch(options.length, searchable));
  const shown = $derived(displayOrder(filterSelectOptions(options, query)));
  const sections = $derived(groupSelectOptions(shown));
  const label = $derived(selectedLabel(options, value, placeholder));
  const chosen = $derived(value !== "" || options.some((o) => o.value === ""));

  function reposition(): void {
    if (!trigger) return;
    const r = trigger.getBoundingClientRect();
    const contentHeight = listEl ? listEl.scrollHeight : shown.length * 34 + 16;
    place = placeListbox({
      trigger: { left: r.left, top: r.top, width: r.width, height: r.height },
      contentHeight,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      minWidth: 160,
    });
  }

  /** The list's accessible name: `aria-label`, else the field's `<label for>` text (the trigger's own text is the current value). */
  let listName = $state("");

  async function openList(): Promise<void> {
    if (open || disabled) return;
    listName =
      rest["aria-label"] ??
      document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent?.trim() ??
      placeholder;
    query = "";
    active = initialActive(displayOrder(options), value);
    reposition();
    open = true;
    await tick();
    reposition();
    if (searchOn) searchEl?.focus();
    scrollActive();
  }

  function closeList(refocus = false): void {
    if (!open) return;
    open = false;
    query = "";
    if (refocus) trigger?.focus();
  }

  function pick(o: SelectOption | undefined): void {
    if (!o || o.disabled) return;
    value = o.value;
    closeList(true);
    onchange?.(o.value);
  }

  function scrollActive(): void {
    if (active >= 0) document.getElementById(optionId(active))?.scrollIntoView({ block: "nearest" });
  }

  function move(next: number): void {
    if (next < 0) return;
    active = next;
    scrollActive();
  }

  function onKeydown(e: KeyboardEvent): void {
    const fromSearch = e.currentTarget === searchEl;
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        void openList();
      }
      return;
    }
    switch (e.key) {
      case "ArrowDown":
      case "ArrowUp":
        e.preventDefault();
        return move(stepActive(shown, active, e.key === "ArrowDown" ? 1 : -1));
      case "Home":
      case "End":
        if (fromSearch) return;
        e.preventDefault();
        return move(edgeActive(shown, e.key === "Home" ? "first" : "last"));
      case "Enter":
        if (e.isComposing) return;
        e.preventDefault();
        return pick(shown[active]);
      case " ":
        if (fromSearch && query !== "") return;
        e.preventDefault();
        return pick(shown[active]);
      case "Escape":
        e.preventDefault();
        e.stopPropagation();
        return closeList(true);
      case "Tab":
        return closeList();
    }
    if (!fromSearch && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const now = Date.now();
      const next = typeahead(shown, active, buffer, e.key, now - lastKey);
      buffer = next.buffer;
      lastKey = now;
      move(next.index);
    }
  }

  // A new query starts at the best match.
  $effect(() => {
    void query;
    if (open) active = stepActive(shown, -1, 1);
  });

  // Follow the page while open: scrolling an ancestor or resizing moves the anchor.
  $effect(() => {
    if (!open) return;
    const onMove = (e: Event): void => {
      if (e.target instanceof Node && listEl?.contains(e.target)) return;
      reposition();
    };
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  });

  // The list can change height (search results): keep the placement honest.
  $effect(() => {
    void shown.length;
    if (open) void tick().then(reposition);
  });
</script>

<button
  {id}
  bind:this={trigger}
  type="button"
  class="cx-control sel-trigger {className}"
  role="combobox"
  aria-haspopup="listbox"
  aria-expanded={open}
  aria-controls={open ? listId : undefined}
  aria-activedescendant={open && !searchOn && active >= 0 ? optionId(active) : undefined}
  aria-invalid={invalid || undefined}
  aria-describedby={describedBy}
  {disabled}
  onclick={() => (open ? closeList() : void openList())}
  onkeydown={onKeydown}
  {...rest}
>
  <span class="sel-label" class:sel-placeholder={!chosen}>{label}</span>
  <Icon name="down" size="sm" class="sel-chev" />
</button>
{#if name}<input type="hidden" {name} {value} />{/if}

{#if open && place}
  <div
    class="sel-pop"
    data-cx-popover=""
    use:portal={document.body}
    use:clickOutside={{ onclose: () => closeList(), ignore: [trigger], escape: false }}
    style:left="{place.left}px"
    style:width="{place.width}px"
    style:top={place.top === undefined ? undefined : `${place.top}px`}
    style:bottom={place.bottom === undefined ? undefined : `${place.bottom}px`}
    style:max-height="{place.maxHeight}px"
  >
    {#if searchOn}
      <div class="sel-search">
        <Icon name="search" size="sm" />
        <input
          bind:this={searchEl}
          bind:value={query}
          type="text"
          role="combobox"
          aria-label="Search options"
          aria-autocomplete="list"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={active >= 0 ? optionId(active) : undefined}
          placeholder="Search"
          autocomplete="off"
          spellcheck={false}
          onkeydown={onKeydown}
        />
      </div>
    {/if}
    <div bind:this={listEl} class="sel-list" id={listId} role="listbox" aria-label={listName}>
      {#each sections as section (section.group)}
        <div role="group" aria-label={section.group || undefined}>
          {#if section.group}<div class="sel-group">{section.group}</div>{/if}
          {#each section.options as o (o.value)}
            {@const i = shown.indexOf(o)}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <div
              id={optionId(i)}
              class="sel-row"
              class:sel-active={i === active}
              class:sel-chosen={o.value === value}
              role="option"
              tabindex="-1"
              aria-selected={o.value === value}
              aria-disabled={o.disabled || undefined}
              onmousemove={() => !o.disabled && (active = i)}
              onmousedown={(e) => e.preventDefault()}
              onclick={() => pick(o)}
            >
              <span class="sel-text">
                <span class="sel-name">{o.label}</span>
                {#if o.description}<span class="sel-desc">{o.description}</span>{/if}
              </span>
              {#if o.value === value}<Icon name="check" size="sm" class="sel-check" />{/if}
            </div>
          {/each}
        </div>
      {/each}
      {#if shown.length === 0}<p class="sel-empty" role="status">Nothing matches</p>{/if}
    </div>
  </div>
{/if}

<style>
  .sel-trigger {
    display: inline-flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-width: 0;
    text-align: left;
    cursor: pointer;
  }
  .sel-trigger:disabled { cursor: not-allowed; }
  .sel-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sel-placeholder { color: var(--cortex-text-3); }
  .sel-trigger :global(.sel-chev) { color: var(--cortex-text-3); transition: rotate 120ms ease; }
  .sel-trigger[aria-expanded="true"] :global(.sel-chev) { rotate: 180deg; }
  @media (prefers-reduced-motion: reduce) { .sel-trigger :global(.sel-chev) { transition: none; } }
  :global(html[data-motion="reduce"]) .sel-trigger :global(.sel-chev) { transition: none; }

  .sel-pop {
    position: fixed;
    z-index: var(--cortex-z-tooltip);
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    border: 1px solid var(--cortex-line-strong);
    border-radius: var(--cortex-r-ctl);
    background: var(--cortex-surface-1);
    box-shadow: var(--cortex-shadow-pop);
    overflow: hidden;
  }
  .sel-search { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-bottom: 1px solid var(--cortex-line); color: var(--cortex-text-3); }
  .sel-search input { flex: 1; min-width: 0; border: 0; background: transparent; color: var(--cortex-text); font: 400 var(--cortex-t-sm) var(--cortex-font-ui); padding: 4px 0; outline: none; }
  .sel-search input::placeholder { color: var(--cortex-text-3); }
  .sel-list { overflow-y: auto; padding: 4px; min-height: 0; }
  .sel-group { padding: 6px 8px 2px; font-size: var(--cortex-t-xs); color: var(--cortex-text-3); }
  .sel-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 6px 8px; border-radius: 6px; cursor: pointer; }
  .sel-row.sel-active { background: var(--cortex-surface-3); }
  .sel-row[aria-disabled="true"] { opacity: 0.5; cursor: not-allowed; }
  .sel-text { display: flex; flex-direction: column; min-width: 0; }
  .sel-name { font-size: var(--cortex-t-sm); color: var(--cortex-text); overflow-wrap: anywhere; }
  .sel-chosen .sel-name { color: var(--cortex-accent); }
  .sel-desc { font-size: var(--cortex-t-xs); color: var(--cortex-text-3); overflow-wrap: anywhere; }
  .sel-row :global(.sel-check) { color: var(--cortex-accent); }
  .sel-empty { margin: 0; padding: 8px; font-size: var(--cortex-t-xs); color: var(--cortex-text-3); }
</style>
