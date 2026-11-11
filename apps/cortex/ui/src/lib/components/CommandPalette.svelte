<script lang="ts">
  /**
   * The Ctrl/Cmd+K command palette (Bench). A top-anchored dialog on the
   * overlay layer: a search combobox over a grouped listbox (sections from
   * `COMMAND_GROUPS`), matched text marked, shortcut hints, an empty state.
   * The input keeps focus; arrows move the active option (wrapping), Enter
   * runs it, Esc or a scrim press closes, and focus returns to whatever had it
   * when the palette opened. The Ctrl/Cmd+K toggle lives in `+layout.svelte`
   * only (a second listener here toggled it shut again). Matching, grouping
   * and highlight rules: `lib/stores/command-palette.ts`; commands:
   * `lib/palette-commands.ts`.
   */
  import { onMount, tick } from "svelte";
  import { goto } from "$app/navigation";
  import { CORTEX_SERVER_URL } from "$lib/constants.js";
  import Icon from "$lib/components/kit/Icon.svelte";
  import { paletteCommands } from "$lib/palette-commands.js";
  import {
    commandPalette,
    commandPaletteOpen,
    commandPaletteQuery,
    commandPaletteView,
    highlightSegments,
    wrapIndex,
  } from "$lib/stores/command-palette.js";

  const uid = $props.id();
  const listId = `${uid}-list`;
  const optionId = (i: number) => `${uid}-opt-${i}`;
  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

  let selected = $state(0);
  let inputEl = $state<HTMLInputElement>();

  const view = $derived($commandPaletteView);
  const count = $derived(view.flat.length);
  const query = $derived($commandPaletteQuery);

  // A new query starts at the best match.
  $effect(() => {
    void $commandPaletteQuery;
    selected = 0;
  });

  // Open: focus the input; close: give focus back to the opener if it is still on the page.
  $effect(() => {
    if (!$commandPaletteOpen) return;
    const returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    selected = 0;
    void tick().then(() => inputEl?.focus());
    return () => {
      if (returnTo?.isConnected) returnTo.focus();
    };
  });

  // Keep the active option visible.
  $effect(() => {
    if (!$commandPaletteOpen || count === 0) return;
    document.getElementById(optionId(selected))?.scrollIntoView({ block: "nearest" });
  });

  function run(index: number) {
    const command = view.flat[index];
    if (!command) return;
    commandPalette.close();
    void Promise.resolve(command.action()).catch(() => {});
  }

  function onKeydown(e: KeyboardEvent) {
    switch (e.key) {
      case "Escape":
        e.preventDefault();
        e.stopPropagation();
        commandPalette.close();
        return;
      case "ArrowDown":
      case "ArrowUp":
        e.preventDefault();
        selected = wrapIndex(selected, e.key === "ArrowDown" ? 1 : -1, count);
        return;
      case "Enter":
        if (e.isComposing) return;
        e.preventDefault();
        run(selected);
        return;
      case "Tab":
        // The input is the dialog's only stop: Tab stays on it.
        e.preventDefault();
        inputEl?.focus();
        return;
    }
  }

  onMount(() =>
    commandPalette.register(
      paletteCommands({
        goto: (path) => goto(path),
        dispatch: (name, detail) => window.dispatchEvent(new CustomEvent(name, { detail })),
        serverUrl: CORTEX_SERVER_URL,
        copy: async (text) => {
          try {
            await navigator.clipboard.writeText(text);
          } catch {
            /* clipboard refused (insecure origin or no permission): nothing to undo */
          }
        },
        latestRunId: async () => {
          const res = await fetch(`${CORTEX_SERVER_URL}/api/runs?limit=1`);
          if (!res.ok) return null;
          const runs = (await res.json()) as Array<{ runId?: string }>;
          return runs[0]?.runId ?? null;
        },
      }),
    ),
  );
</script>

{#if $commandPaletteOpen}
  <div class="cp" data-testid="command-palette">
    <button type="button" class="cp-scrim" tabindex="-1" aria-label="Close command palette" onclick={() => commandPalette.close()}></button>
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div class="cp-panel" role="dialog" aria-modal="true" aria-labelledby="{uid}-title" tabindex="-1" onkeydown={onKeydown}>
      <h2 id="{uid}-title" class="sr-only">Command palette</h2>
      <div class="cp-search">
        <span class="cp-search-ico" aria-hidden="true"><Icon name="search" /></span>
        <input
          bind:this={inputEl}
          class="cx-control cp-input"
          type="text"
          role="combobox"
          aria-label="Search commands"
          aria-autocomplete="list"
          aria-expanded={count > 0}
          aria-controls={listId}
          aria-activedescendant={count > 0 ? optionId(selected) : undefined}
          placeholder="Search pages and actions"
          value={query}
          oninput={(e) => commandPaletteQuery.set(e.currentTarget.value)}
          autocomplete="off"
          spellcheck={false}
        />
      </div>

      <div class="cp-list" id={listId} role="listbox" aria-label="Commands" hidden={count === 0}>
        {#each view.sections as section (section.group)}
          <div class="cp-group" role="group" aria-labelledby="{uid}-g-{section.group}">
            <div class="cp-group-h" id="{uid}-g-{section.group}">{section.group}</div>
            {#each section.items as item (item.command.id)}
              {@const c = item.command}
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <div
                id={optionId(item.index)}
                class="cp-row"
                class:sel={item.index === selected}
                role="option"
                tabindex="-1"
                aria-selected={item.index === selected}
                onmousemove={() => (selected = item.index)}
                onmousedown={(e) => e.preventDefault()}
                onclick={() => run(item.index)}
              >
                <span class="cp-ico" aria-hidden="true"><Icon name={c.icon ?? "chevron"} size="sm" /></span>
                <span class="cp-text">
                  <span class="cp-label">
                    {#each highlightSegments(c.label, query) as seg, si (si)}{#if seg.match}<mark>{seg.text}</mark>{:else}{seg.text}{/if}{/each}
                  </span>
                  {#if c.description}<span class="cp-desc">{c.description}</span>{/if}
                </span>
                {#if c.shortcut}<kbd class="cp-key" aria-label="Shortcut {c.shortcut}">{c.shortcut}</kbd>{/if}
                <span class="cp-go" aria-hidden="true"><Icon name="chevron" size="sm" /></span>
              </div>
            {/each}
          </div>
        {/each}
      </div>

      {#if count === 0}
        <div class="cp-empty" role="status">
          <Icon name="search" size="lg" />
          <p class="cp-empty-t">No command matches <span class="cp-q">{query.trim()}</span></p>
          <p class="cp-empty-h">Try a page, a Lab tab, or an action such as “copy” or “theme”.</p>
        </div>
      {/if}

      <footer class="cp-foot" aria-hidden="true">
        <span><kbd>↑</kbd><kbd>↓</kbd> move</span>
        <span><kbd>↵</kbd> run</span>
        <span><kbd>Esc</kbd> close</span>
        <span class="cp-foot-end"><kbd>{isMac ? "⌘K" : "Ctrl K"}</kbd> toggle</span>
      </footer>
    </div>
  </div>
{/if}

<style>
  .cp {
    position: fixed;
    inset: 0;
    z-index: var(--cortex-z-modal);
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding: 12vh 16px 16px;
  }
  .cp-scrim {
    position: absolute;
    inset: 0;
    border: 0;
    padding: 0;
    background: rgb(var(--cortex-canvas-rgb) / 0.7);
    backdrop-filter: blur(2px);
    cursor: default;
  }
  .cp-panel {
    position: relative;
    display: flex;
    flex-direction: column;
    width: min(600px, 100%);
    max-height: min(560px, 100%);
    border-radius: var(--cortex-r-panel);
    background: var(--cortex-surface-1);
    color: var(--cortex-text);
    box-shadow: var(--cortex-shadow-pop);
    outline: none;
    overflow: hidden;
    animation: cp-in var(--cortex-d-fast) var(--cortex-ease-out);
  }
  @keyframes cp-in {
    from { opacity: 0; transform: translateY(-4px); }
    to { opacity: 1; transform: none; }
  }

  .cp-search { position: relative; padding: 12px; border-bottom: 1px solid var(--cortex-line); }
  .cp-search-ico {
    position: absolute;
    left: 24px;
    top: 50%;
    transform: translateY(-50%);
    display: inline-flex;
    color: var(--cortex-text-3);
    pointer-events: none;
  }
  .cp-input { height: 40px; padding-left: 36px; font-size: var(--cortex-t-md); }

  .cp-list { flex: 1; min-height: 0; overflow-y: auto; padding: 4px 8px 8px; }
  .cp-list[hidden] { display: none; }
  .cp-group-h {
    padding: 10px 8px 4px;
    font-size: var(--cortex-t-2xs);
    font-weight: 500;
    color: var(--cortex-text-3);
  }
  .cp-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 8px;
    border-radius: var(--cortex-r-ctl);
    color: var(--cortex-text-2);
    cursor: pointer;
  }
  .cp-row.sel { background: var(--cortex-surface-2); color: var(--cortex-text); }
  .cp-ico {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: var(--cortex-r-chip);
    background: var(--cortex-surface-2);
    color: var(--cortex-text-2);
  }
  .cp-row.sel .cp-ico { background: var(--cortex-accent-tint); color: var(--cortex-accent); }
  .cp-text { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .cp-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--cortex-t-sm);
    font-weight: 500;
    color: var(--cortex-text);
  }
  .cp-label mark { background: none; color: var(--cortex-accent); font-weight: 600; }
  .cp-desc {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--cortex-t-xs);
    color: var(--cortex-text-2);
  }
  .cp-go { display: inline-flex; color: var(--cortex-text-3); visibility: hidden; }
  .cp-row.sel .cp-go { visibility: visible; }

  kbd {
    display: inline-block;
    min-width: 20px;
    padding: 1px 5px;
    border-radius: var(--cortex-r-chip);
    border: 1px solid var(--cortex-line-strong);
    background: var(--cortex-canvas);
    color: var(--cortex-text-2);
    font-family: var(--cortex-font-data);
    font-size: var(--cortex-t-2xs);
    line-height: 16px;
    text-align: center;
  }
  .cp-key { flex-shrink: 0; }

  .cp-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 32px 16px;
    text-align: center;
    color: var(--cortex-text-3);
  }
  .cp-empty-t { margin: 0; font-size: var(--cortex-t-sm); color: var(--cortex-text); }
  .cp-q { font-family: var(--cortex-font-data); font-size: var(--cortex-t-xs); color: var(--cortex-text); }
  .cp-empty-h { margin: 0; font-size: var(--cortex-t-xs); color: var(--cortex-text-2); }

  .cp-foot {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 14px;
    padding: 8px 12px;
    border-top: 1px solid var(--cortex-line);
    font-size: var(--cortex-t-2xs);
    color: var(--cortex-text-2);
  }
  .cp-foot span { display: inline-flex; align-items: center; gap: 4px; }
  .cp-foot-end { margin-left: auto; }

  @media (max-width: 640px) {
    .cp { padding: 8px; }
    .cp-panel { max-height: 100%; }
    .cp-foot .cp-foot-end { display: none; }
  }
  @media (prefers-reduced-motion: reduce) {
    .cp-panel { animation: none; }
  }
  :global(html[data-motion="reduce"]) .cp-panel { animation: none; }
</style>
