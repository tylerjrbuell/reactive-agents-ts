<script lang="ts">
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { CORTEX_SERVER_URL } from "$lib/constants.js";
  import {
    commandPalette,
    commandPaletteOpen,
    commandPaletteQuery,
    commandPaletteFiltered,
    type Command,
  } from "$lib/stores/command-palette.js";

  let selectedIndex = $state(0);
  let inputEl: HTMLInputElement | undefined = $state();

  $effect(() => {
    void $commandPaletteFiltered;
    void $commandPaletteQuery;
    selectedIndex = 0;
  });

  $effect(() => {
    if ($commandPaletteOpen) {
      queueMicrotask(() => inputEl?.focus());
    }
  });

  function runSelected() {
    const list = $commandPaletteFiltered;
    const cmd = list[selectedIndex];
    if (!cmd) return;
    void Promise.resolve(cmd.action()).finally(() => commandPalette.close());
  }

  function onGlobalKeydown(e: KeyboardEvent) {
    const meta = e.metaKey || e.ctrlKey;
    if (meta && e.key === "k") {
      e.preventDefault();
      commandPalette.toggle();
      return;
    }
    if (!$commandPaletteOpen) return;
    if (e.key === "Escape") {
      e.preventDefault();
      commandPalette.close();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const n = $commandPaletteFiltered.length;
      if (n === 0) return;
      selectedIndex = (selectedIndex + 1) % n;
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      const n = $commandPaletteFiltered.length;
      if (n === 0) return;
      selectedIndex = (selectedIndex - 1 + n) % n;
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      runSelected();
    }
  }

  const defaultCommands: Command[] = [
    {
      id: "run-agent",
      label: "Run agent…",
      description: "Open Stage",
      icon: "play_arrow",
      keywords: ["run", "start", "stage", "home"],
      action: () => {
        commandPalette.close();
        void goto("/");
      },
    },
    {
      id: "view-last-run",
      label: "View most recent run",
      description: "Open latest run from history",
      icon: "analytics",
      keywords: ["last", "recent", "run"],
      action: async () => {
        commandPalette.close();
        const res = await fetch(`${CORTEX_SERVER_URL}/api/runs`);
        if (!res.ok) return;
        const runs = (await res.json()) as Array<{ runId: string }>;
        const id = runs[0]?.runId;
        if (id) void goto(`/run/${id}`);
      },
    },
    {
      id: "workshop",
      label: "Open Lab",
      description: "Builder, skills, tools",
      icon: "build",
      keywords: ["workshop", "builder"],
      action: () => {
        commandPalette.close();
        void goto("/workshop");
      },
    },
    {
      id: "skills-tab",
      label: "Lab — Skills",
      description: "Living skills browser",
      icon: "psychology",
      keywords: ["skills"],
      action: () => {
        commandPalette.close();
        void goto("/workshop#skills");
      },
    },
    {
      id: "tools-tab",
      label: "Lab — Tools",
      description: "Tool registry",
      icon: "construction",
      keywords: ["tools"],
      action: () => {
        commandPalette.close();
        void goto("/workshop#tools");
      },
    },
    {
      id: "connect-snippet",
      label: "Copy .withCortex() hint",
      description: "Clipboard",
      icon: "link",
      keywords: ["connect", "cortex", "url"],
      action: async () => {
        commandPalette.close();
        const hint = `.withCortex("${CORTEX_SERVER_URL}")`;
        try {
          await navigator.clipboard.writeText(hint);
        } catch {
          /* ignore */
        }
      },
    },
  ];

  onMount(() => {
    window.addEventListener("keydown", onGlobalKeydown);
    const unregister = commandPalette.register(defaultCommands);
    return () => {
      window.removeEventListener("keydown", onGlobalKeydown);
      unregister();
    };
  });
</script>

{#if $commandPaletteOpen}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm flex items-start justify-center pt-[15vh] px-4"
    onclick={(e) => e.target === e.currentTarget && commandPalette.close()}
    role="presentation"
  >
    <div
      class="w-full max-w-lg rounded-xl border border-outline-variant/20 bg-surface-container shadow-neural-strong p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <div class="flex items-center gap-2 border-b border-outline-variant/10 pb-3 mb-3">
        <span class="material-symbols-outlined text-outline text-sm">search</span>
        <input
          bind:this={inputEl}
          class="flex-1 bg-transparent font-mono text-sm text-on-surface outline-none placeholder:text-on-surface-variant"
          placeholder="Search commands…"
          value={$commandPaletteQuery}
          oninput={(e) => commandPaletteQuery.set(e.currentTarget.value)}
          autocomplete="off"
          spellcheck={false}
        />
      </div>
      <div class="max-h-72 overflow-y-auto space-y-1" role="listbox">
        {#if $commandPaletteFiltered.length === 0}
          <p class="font-mono text-xs text-on-surface-variant px-2 py-4 text-center">No matches</p>
        {:else}
          {#each $commandPaletteFiltered as cmd, i (cmd.id)}
            <button
              type="button"
              role="option"
              aria-selected={i === selectedIndex}
              class="w-full text-left px-3 py-2 rounded-lg font-mono text-xs transition-colors {i ===
              selectedIndex
                ? 'bg-primary/15 text-primary border border-primary/30'
                : 'text-on-surface-variant hover:bg-surface-container-high border border-transparent'}"
              onclick={() => {
                selectedIndex = i;
                runSelected();
              }}
            >
              <span class="text-on-surface">{cmd.label}</span>
              {#if cmd.description}
                <span class="block text-[10px] text-on-surface-variant mt-0.5">{cmd.description}</span>
              {/if}
            </button>
          {/each}
        {/if}
      </div>
      <p class="mt-3 font-mono text-[10px] text-on-surface-variant text-center">
        ↑↓ navigate · ↵ run · esc close · ⌘K toggle
      </p>
    </div>
  </div>
{/if}
