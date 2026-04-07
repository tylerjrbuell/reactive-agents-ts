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
    // ⌘K / Ctrl+K is handled in +layout.svelte only (two listeners here caused open→toggle→close).
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

  function gotoTab(tab: string) {
    commandPalette.close();
    void goto("/lab").then(() => {
      // Give the page a tick to mount before dispatching tab switch
      setTimeout(() => window.dispatchEvent(new CustomEvent("cortex:lab-tab", { detail: tab })), 50);
    });
  }

  const defaultCommands: Command[] = [
    // ── Navigation ────────────────────────────────────────────────────────
    {
      id: "go-beacon",
      label: "Go to Beacon",
      description: "Launch agents from the home input bar",
      icon: "radar",
      shortcut: "R",
      keywords: ["home", "beacon", "launch", "run", "start"],
      action: () => { commandPalette.close(); void goto("/"); },
    },
    {
      id: "go-chat",
      label: "Go to Chat",
      description: "Conversational sessions and message history",
      icon: "chat",
      keywords: ["chat", "conversation", "session", "messages"],
      action: () => { commandPalette.close(); void goto("/chat"); },
    },
    {
      id: "go-trace",
      label: "Go to Trace",
      description: "Run history and execution logs",
      icon: "alt_route",
      keywords: ["runs", "history", "trace", "log"],
      action: () => { commandPalette.close(); void goto("/runs"); },
    },
    {
      id: "go-lab",
      label: "Go to Lab",
      description: "Builder, gateway agents, skills, tools",
      icon: "science",
      keywords: ["lab", "builder", "gateway"],
      action: () => { commandPalette.close(); void goto("/lab"); },
    },
    {
      id: "go-settings",
      label: "Go to Settings",
      description: "Provider defaults, notifications, storage",
      icon: "settings",
      keywords: ["settings", "preferences", "config"],
      action: () => { commandPalette.close(); void goto("/settings"); },
    },

    // ── Lab tabs ──────────────────────────────────────────────────────────
    {
      id: "lab-builder",
      label: "Lab → Builder",
      description: "Configure and run a new agent",
      icon: "smart_toy",
      keywords: ["builder", "agent", "create", "configure"],
      action: () => gotoTab("builder"),
    },
    {
      id: "lab-gateway",
      label: "Lab → Gateway",
      description: "Persistent scheduled agents",
      icon: "schedule",
      keywords: ["gateway", "scheduled", "cron", "persistent", "agent"],
      action: () => gotoTab("gateway"),
    },
    {
      id: "lab-skills",
      label: "Lab → Skills",
      description: "Living skills browser",
      icon: "psychology",
      keywords: ["skills", "living"],
      action: () => gotoTab("skills"),
    },
    {
      id: "lab-tools",
      label: "Lab → Tools",
      description: "Tool registry and MCP connections",
      icon: "construction",
      keywords: ["tools", "mcp", "registry"],
      action: () => gotoTab("tools"),
    },

    // ── Runs / Trace ──────────────────────────────────────────────────────
    {
      id: "view-last-run",
      label: "View most recent run",
      description: "Jump to latest execution trace",
      icon: "analytics",
      keywords: ["last", "recent", "run", "trace"],
      action: async () => {
        commandPalette.close();
        const res = await fetch(`${CORTEX_SERVER_URL}/api/runs`);
        if (!res.ok) return;
        const runs = (await res.json()) as Array<{ runId: string }>;
        const id = runs[0]?.runId;
        if (id) void goto(`/run/${id}`);
      },
    },

    // ── Focus input ───────────────────────────────────────────────────────
    {
      id: "focus-input",
      label: "Focus Beacon input",
      description: "Jump to Beacon and focus the prompt input",
      icon: "edit",
      shortcut: "R",
      keywords: ["input", "prompt", "focus", "type"],
      action: () => {
        commandPalette.close();
        void goto("/");
        setTimeout(() => window.dispatchEvent(new CustomEvent("cortex:focus-input")), 50);
      },
    },

    // ── Theme ─────────────────────────────────────────────────────────────
    {
      id: "toggle-theme",
      label: "Toggle dark / light mode",
      description: "Switch UI colour scheme",
      icon: "brightness_medium",
      keywords: ["theme", "dark", "light", "mode"],
      action: () => {
        commandPalette.close();
        window.dispatchEvent(new CustomEvent("cortex:toggle-theme"));
      },
    },

    // ── Connect ───────────────────────────────────────────────────────────
    {
      id: "connect-snippet",
      label: "Copy .withCortex() snippet",
      description: "Copy connect call to clipboard",
      icon: "link",
      keywords: ["connect", "cortex", "url", "snippet", "copy"],
      action: async () => {
        commandPalette.close();
        const hint = `.withCortex("${CORTEX_SERVER_URL}")`;
        try { await navigator.clipboard.writeText(hint); } catch { /* ignore */ }
      },
    },
    {
      id: "copy-env",
      label: "Copy CORTEX_URL env var",
      description: "Copy the server URL as an env variable",
      icon: "content_copy",
      keywords: ["env", "url", "copy", "cortex_url"],
      action: async () => {
        commandPalette.close();
        try { await navigator.clipboard.writeText(`CORTEX_URL=${CORTEX_SERVER_URL}`); } catch { /* ignore */ }
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
      class="w-full max-w-lg rounded-xl border border-outline-variant/25 bg-surface-container/95 dark:bg-surface-container-low/95 backdrop-blur-xl shadow-[0_24px_80px_rgba(0,0,0,0.35)] dark:shadow-[0_24px_80px_rgba(0,0,0,0.55)] p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <div class="flex items-center gap-2 border-b border-outline-variant/15 pb-3 mb-3">
        <span class="material-symbols-outlined text-secondary/80 text-lg" aria-hidden="true">search</span>
        <input
          bind:this={inputEl}
          class="flex-1 bg-transparent font-mono text-sm text-on-surface outline-none placeholder:text-on-surface-variant/80"
          placeholder="Type a command or route…"
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
