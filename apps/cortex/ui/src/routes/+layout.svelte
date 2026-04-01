<script lang="ts">
  import "../app.css";
  import { page } from "$app/stores";
  import { goto } from "$app/navigation";
  import { onMount, onDestroy, setContext } from "svelte";
  import { get } from "svelte/store";
  import ToastContainer from "$lib/components/ToastContainer.svelte";
  import CommandPalette from "$lib/components/CommandPalette.svelte";
  import { commandPalette } from "$lib/stores/command-palette.js";
  import { toast } from "$lib/stores/toast-store.js";
  import { settings } from "$lib/stores/settings.js";
  import { createWsClient } from "$lib/stores/ws-client.js";
  import { createAgentStore } from "$lib/stores/agent-store.js";
  import { createStageStore } from "$lib/stores/stage-store.js";
  import type { AgentStore } from "$lib/stores/agent-store.js";
  import type { StageStore } from "$lib/stores/stage-store.js";

  let { children } = $props();

  const agentStore: AgentStore = createAgentStore();
  const stageStore: StageStore = createStageStore();

  setContext("agentStore", agentStore);
  setContext("stageStore", stageStore);

  let wsUnsub: (() => void) | null = null;
  let refreshTimer: ReturnType<typeof setInterval> | null = null;
  const wsClient = createWsClient("/ws/live/cortex-broadcast");

  const navItems = [
    { label: "Mission Control", href: "/", icon: "hub" },
    { label: "Runs",     href: "/runs",    icon: "history" },
    { label: "Lab", href: "/workshop", icon: "science" },
  ];

  let isDark = $state(true);

  function applyTheme(theme: "dark" | "light") {
    isDark = theme === "dark";
    if (typeof document !== "undefined") {
      // Toggle the .dark class — Tailwind reads this for dark: variants
      document.documentElement.classList.toggle("dark", isDark);
      // Also set data-theme for any CSS selectors that use it
      document.documentElement.setAttribute("data-theme", theme);
    }
  }

  function toggleTheme() {
    const next = isDark ? "light" : "dark";
    applyTheme(next);
    settings.save({ theme: next });
  }

  function handleGlobalKeydown(e: KeyboardEvent) {
    const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
    const isInput = tag === "input" || tag === "textarea" || tag === "select" || (e.target as HTMLElement)?.isContentEditable;
    if (isInput) return;
    if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); commandPalette.toggle(); return; }
    // R — go to Stage and focus input bar
    if (e.key === "r" || e.key === "R") {
      e.preventDefault();
      void goto("/");
      // Broadcast to stage page that input should be focused
      window.dispatchEvent(new CustomEvent("cortex:focus-input"));
    }
  }

  onMount(() => {
    settings.init(); // warm up from localStorage before any submitPrompt call

    // Apply saved theme immediately
    const s = settings.get();
    applyTheme(s.theme);

    stageStore.setNavigate((path) => goto(path));
    window.addEventListener("keydown", handleGlobalKeydown);

    wsUnsub = wsClient.onMessage((raw) => {
      const msg = raw as {
        agentId?: string;
        runId?: string;
        type?: string;
        payload?: Record<string, unknown>;
      };
      if (!msg?.agentId || !msg.runId || !msg.type) return;

      agentStore.handleLiveMessage({
        agentId: msg.agentId,
        runId: msg.runId,
        type: msg.type,
        payload: msg.payload ?? {},
      });

      const agents = get(agentStore);
      const node = agents.find((a) => a.runId === msg.runId);

      // Toasts for key lifecycle events
      if (msg.type === "AgentConnected") {
        stageStore.handleAgentConnected(node ?? { agentId: msg.agentId!, runId: msg.runId!, name: msg.agentId!, state: "running", entropy: 0, iteration: 0, maxIterations: 10, tokensUsed: 0, cost: 0, connectedAt: Date.now(), lastEventAt: Date.now() } as any, agents.length);
        toast.connection(
          `${msg.agentId!.slice(0, 20)} connected`,
          "Agent is streaming to Cortex",
          { label: "View run", href: `/run/${msg.runId}` },
        );
      } else if (msg.type === "AgentCompleted") {
        const success = (msg.payload as any)?.success !== false;
        const agentName = node?.name ?? msg.agentId!.slice(0, 20);
        if (success) {
          toast.success(`${agentName} completed`, undefined, { label: "View run", href: `/run/${msg.runId}` });
        } else {
          toast.error(`${agentName} failed`, undefined, { label: "View run", href: `/run/${msg.runId}` });
        }
      } else if (msg.type === "TaskFailed") {
        toast.error(
          `Run failed`,
          typeof (msg.payload as any)?.error === "string" ? (msg.payload as any).error.slice(0, 80) : undefined,
          { label: "View run", href: `/run/${msg.runId}` },
        );
      }
    });

    // Safety-net reconciliation so deletes/new runs reflect without manual reload
    // even if a WS message is missed during navigation transitions.
    refreshTimer = setInterval(() => {
      void agentStore.refresh();
    }, 5000);

    return () => {
      window.removeEventListener("keydown", handleGlobalKeydown);
      wsUnsub?.();
      wsUnsub = null;
      if (refreshTimer) {
        clearInterval(refreshTimer);
        refreshTimer = null;
      }
    };
  });

  onDestroy(() => {
    wsClient.close();
    agentStore.destroy();
  });
</script>

<div class="h-screen w-screen flex flex-col overflow-hidden bg-background text-on-surface">
  <header
    class="cortex-nav bg-[#17181c] flex justify-between items-center w-full px-6 h-12 border-b border-white/5 shadow-neural z-50 flex-shrink-0"
  >
    <!-- RA neural network logo + wordmark (matches docs site identity) -->
    <a href="/" class="flex items-center gap-2.5 no-underline group" aria-label="Cortex home">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="22" height="22" class="flex-shrink-0" aria-hidden="true">
        <defs>
          <linearGradient id="lh-ed" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#8b5cf6" stop-opacity="0.8"/><stop offset="100%" stop-color="#06b6d4" stop-opacity="0.35"/>
          </linearGradient>
          <linearGradient id="lh-ed2" x1="100%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#06b6d4" stop-opacity="0.6"/><stop offset="100%" stop-color="#8b5cf6" stop-opacity="0.25"/>
          </linearGradient>
          <filter id="lh-gN" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="1.2" result="b"/>
            <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
        </defs>
        <circle cx="24" cy="24" r="18" fill="#8b5cf6" opacity="0.05"/>
        <line x1="14" y1="6" x2="34" y2="6" stroke="url(#lh-ed)" stroke-width="1.1" stroke-linecap="round"/>
        <line x1="14" y1="6" x2="6" y2="20" stroke="url(#lh-ed)" stroke-width="1.1" stroke-linecap="round"/>
        <line x1="34" y1="6" x2="42" y2="20" stroke="url(#lh-ed)" stroke-width="1.1" stroke-linecap="round"/>
        <line x1="6" y1="20" x2="6" y2="34" stroke="url(#lh-ed)" stroke-width="1.1" stroke-linecap="round"/>
        <line x1="42" y1="20" x2="42" y2="34" stroke="url(#lh-ed)" stroke-width="1.1" stroke-linecap="round"/>
        <line x1="6" y1="34" x2="18" y2="44" stroke="url(#lh-ed)" stroke-width="1.1" stroke-linecap="round"/>
        <line x1="42" y1="34" x2="30" y2="44" stroke="url(#lh-ed)" stroke-width="1.1" stroke-linecap="round"/>
        <line x1="18" y1="44" x2="30" y2="44" stroke="url(#lh-ed)" stroke-width="1.1" stroke-linecap="round"/>
        <line x1="14" y1="6" x2="24" y2="24" stroke="url(#lh-ed2)" stroke-width="1.3" stroke-linecap="round"/>
        <line x1="34" y1="6" x2="24" y2="24" stroke="url(#lh-ed2)" stroke-width="1.3" stroke-linecap="round"/>
        <line x1="6" y1="20" x2="24" y2="24" stroke="url(#lh-ed2)" stroke-width="1.3" stroke-linecap="round"/>
        <line x1="42" y1="20" x2="24" y2="24" stroke="url(#lh-ed2)" stroke-width="1.3" stroke-linecap="round"/>
        <line x1="6" y1="34" x2="24" y2="24" stroke="url(#lh-ed2)" stroke-width="1.3" stroke-linecap="round"/>
        <line x1="42" y1="34" x2="24" y2="24" stroke="url(#lh-ed2)" stroke-width="1.3" stroke-linecap="round"/>
        <line x1="18" y1="44" x2="24" y2="24" stroke="url(#lh-ed2)" stroke-width="1.3" stroke-linecap="round"/>
        <line x1="30" y1="44" x2="24" y2="24" stroke="url(#lh-ed2)" stroke-width="1.3" stroke-linecap="round"/>
        <circle cx="14" cy="6" r="2.5" fill="#8b5cf6" filter="url(#lh-gN)"/>
        <circle cx="34" cy="6" r="2.5" fill="#06b6d4" filter="url(#lh-gN)"/>
        <circle cx="6" cy="20" r="2" fill="#a78bfa" filter="url(#lh-gN)"/>
        <circle cx="42" cy="20" r="2" fill="#c4b5fd" filter="url(#lh-gN)"/>
        <circle cx="6" cy="34" r="2" fill="#06b6d4" filter="url(#lh-gN)"/>
        <circle cx="42" cy="34" r="2" fill="#8b5cf6" filter="url(#lh-gN)"/>
        <circle cx="18" cy="44" r="2.5" fill="#a78bfa" filter="url(#lh-gN)"/>
        <circle cx="30" cy="44" r="2.5" fill="#06b6d4" filter="url(#lh-gN)"/>
        <circle cx="24" cy="24" r="4.8" fill="#8b5cf6" opacity="0.9"/>
        <circle cx="24" cy="24" r="7.5" fill="none" stroke="#06b6d4" stroke-width="0.5" opacity="0.2"/>
      </svg>
      <span class="text-base font-semibold tracking-tight ra-gradient-text uppercase select-none">
        Cortex
      </span>
    </a>

    <nav class="hidden md:flex items-center gap-6">
      {#each navItems as item}
        {@const active =
          item.href === "/" ? $page.url.pathname === "/" : $page.url.pathname.startsWith(item.href)}
        <a
          href={item.href}
          class="flex items-center gap-1.5 text-sm font-medium transition-colors duration-200 no-underline {active
            ? 'text-primary border-b-2 border-primary pb-0.5'
            : 'text-outline hover:text-primary'}"
        >
          {item.label}
        </a>
      {/each}
    </nav>

    <div class="flex items-center gap-3">
      <button
        type="button"
        class="hidden md:flex items-center gap-2 px-3 py-1.5 bg-surface-container-lowest rounded border border-outline-variant/10 text-[10px] font-mono text-outline uppercase tracking-widest hover:border-outline-variant/30 transition-colors cursor-pointer border-solid"
        onclick={() => commandPalette.open()}
      >
        <span class="material-symbols-outlined text-sm text-secondary">terminal</span>
        ⌘K
      </button>
      <button
        type="button"
        onclick={toggleTheme}
        class="material-symbols-outlined text-outline hover:text-primary transition-colors p-1 bg-transparent border-0 cursor-pointer"
        title="Toggle {isDark ? 'light' : 'dark'} mode"
        aria-label="Toggle theme"
      >{isDark ? "light_mode" : "dark_mode"}</button>
      <a href="/settings" class="material-symbols-outlined text-outline hover:text-primary transition-colors p-1" title="Settings">settings</a>
    </div>
  </header>

  <main class="flex-1 overflow-hidden min-h-0">
    {@render children()}
  </main>
</div>

<CommandPalette />
<ToastContainer />
