<script lang="ts">
  import "../app.css";
  import { page } from "$app/stores";
  import { goto } from "$app/navigation";
  import { onMount, onDestroy, setContext } from "svelte";
  import { get } from "svelte/store";
  import ToastContainer from "$lib/components/ToastContainer.svelte";
  import ConfirmHost from "$lib/components/ConfirmHost.svelte";
  import CommandPalette from "$lib/components/CommandPalette.svelte";
  import { chatSidebarOpen } from "$lib/stores/chat-sidebar.js";
  import { commandPalette } from "$lib/stores/command-palette.js";
  import { toast } from "$lib/stores/toast-store.js";
  import { runEndToast } from "$lib/run-toast.js";
  import { pendingApprovals, startApprovalWatcher } from "$lib/stores/approval-watcher.js";
  import { pendingInteractions, startInteractionWatcher } from "$lib/stores/interaction-watcher.js";
  import { settings, type CortexSettings } from "$lib/stores/settings.js";
  import { createWsClient } from "$lib/stores/ws-client.js";
  import { createAgentStore, beaconDeskRunLabel } from "$lib/stores/agent-store.js";
  import { createStageStore } from "$lib/stores/stage-store.js";
  import type { AgentStore } from "$lib/stores/agent-store.js";
  import type { StageStore } from "$lib/stores/stage-store.js";
  import { applyMotion } from "$lib/motion.js";
  import { resolveTheme, toggledTheme, type ResolvedTheme } from "$lib/theme.js";
  import TopBar from "$lib/components/TopBar.svelte";
  import { needsYouByRun, runningCount } from "$lib/beacon-board.js";

  let { children } = $props();

  const agentStore: AgentStore = createAgentStore();
  const stageStore: StageStore = createStageStore();

  setContext("agentStore", agentStore);
  setContext("stageStore", stageStore);

  let wsUnsub: (() => void) | null = null;
  let refreshTimer: ReturnType<typeof setInterval> | null = null;
  let stopApprovalWatcher: (() => void) | null = null;
  let stopInteractionWatcher: (() => void) | null = null;
  const wsClient = createWsClient("/ws/live/cortex-broadcast");

  let isDark = $state(true);

  /** Paint a resolved theme: `html.dark` switches the token layer in app.css. */
  function applyTheme(theme: ResolvedTheme) {
    isDark = theme === "dark";
    if (typeof document !== "undefined") {
      document.documentElement.classList.toggle("dark", isDark);
      document.documentElement.setAttribute("data-theme", theme);
    }
  }

  /** Top-bar switch: pin the opposite of what is showing (the settings subscription paints it). */
  function toggleTheme() {
    settings.save({ theme: toggledTheme(isDark ? "dark" : "light") });
  }

  function handleGlobalKeydown(e: KeyboardEvent) {
    // Command palette: always available (even from inputs). Use `code` so layout/locale match physical K.
    if ((e.metaKey || e.ctrlKey) && e.code === "KeyK") {
      e.preventDefault();
      commandPalette.toggle();
      return;
    }
    const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
    const isInput =
      tag === "input" || tag === "textarea" || tag === "select" || (e.target as HTMLElement)?.isContentEditable;
    if (isInput) return;
    // R — go to Beacon and focus input bar (defer so +page / BottomInputBar can bind)
    if (e.key === "r" || e.key === "R") {
      e.preventDefault();
      const fireFocus = () =>
        window.dispatchEvent(new CustomEvent("cortex:focus-input"));
      if (get(page).url.pathname !== "/") {
        void goto("/").then(() => {
          requestAnimationFrame(() => setTimeout(fireFocus, 50));
        });
      } else {
        // Same route: allow Svelte to flush (e.g. empty beacon) before Beacon focuses input
        requestAnimationFrame(() => setTimeout(fireFocus, 50));
      }
    }
  }

  function refreshAgentsSoon() {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    void agentStore.refresh();
  }

  onMount(() => {
    settings.init(); // warm up from localStorage before any submitPrompt call

    // Settings · Appearance: keep the theme and html[data-motion] in step with
    // the saved choices; "Follow the system setting" also tracks OS changes.
    const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
    let themeSetting: CortexSettings["theme"] = settings.get().theme;
    const paintTheme = () => applyTheme(resolveTheme(themeSetting, darkQuery.matches));
    const stopMotion = settings.subscribe((v) => {
      themeSetting = v.theme;
      paintTheme();
      applyMotion(document.documentElement, v.motion);
    });
    darkQuery.addEventListener("change", paintTheme);

    stageStore.setNavigate((path) => goto(path));
    // Durable-HITL: app-wide interactive approval toasts (Approve/Deny).
    stopApprovalWatcher = startApprovalWatcher();
    // Durable-HITL: app-wide `request_user_input` polling (feeds the Runs "Waiting on you" strip).
    stopInteractionWatcher = startInteractionWatcher();
    window.addEventListener("keydown", handleGlobalKeydown);
    window.addEventListener("cortex:toggle-theme", toggleTheme as EventListener);
    window.addEventListener("focus", refreshAgentsSoon);
    window.addEventListener("online", refreshAgentsSoon);
    document.addEventListener("visibilitychange", refreshAgentsSoon);

    wsUnsub = wsClient.onMessage((raw) => {
      const msg = raw as {
        agentId?: string;
        runId?: string;
        type?: string;
        sessionId?: string;
        payload?: Record<string, unknown>;
      };
      if (!msg?.agentId || !msg.runId || !msg.type) return;

      agentStore.handleLiveMessage({
        agentId: msg.agentId,
        runId: msg.runId,
        type: msg.type,
        ...(msg.sessionId ? { sessionId: msg.sessionId } : {}),
        payload: msg.payload ?? {},
      });

      const agents = get(agentStore);
      const node = agents.find((a) => a.runId === msg.runId);

      // Toasts for key lifecycle events
      if (msg.type === "AgentConnected") {
        stageStore.handleAgentConnected(
          node ??
            ({
              agentId: msg.agentId!,
              runId: msg.runId!,
              name: beaconDeskRunLabel({
                agentId: msg.agentId!,
                runId: msg.runId!,
              }),
              state: "running",
              entropy: 0,
              loopIteration: 0,
              reasoningSteps: 0,
              maxIterations: 10,
              tokensUsed: 0,
              cost: 0,
              connectedAt: Date.now(),
              lastEventAt: Date.now(),
            } as import("$lib/stores/agent-store.js").AgentNode),
          agents.length,
        );
        toast.connection(
          `${(node?.name ?? msg.agentId!).slice(0, 28)} connected`,
          "Agent is streaming to Cortex",
          { label: "View run", href: `/run/${msg.runId}` },
        );
      } else {
        // One toast per run (keyed), carrying the run's error on a failure (run-toast.ts).
        const end = runEndToast({
          type: msg.type,
          runId: msg.runId,
          name: node?.name ?? msg.agentId.slice(0, 20),
          payload: msg.payload ?? {},
        });
        if (end) toast[end.kind](end.title, end.message, { label: "View run", href: end.href }, end.key);
      }
    });

    commandPalette.register([
      {
        id: "nav:beacon",
        label: "Go to Beacon",
        description: "Agent grid and live status",
        icon: "beacon",
        keywords: ["beacon", "home", "agents", "grid"],
        action: () => void goto("/"),
      },
      {
        id: "nav:chat",
        label: "New Chat",
        description: "Start a new agent conversation",
        icon: "chat",
        keywords: ["chat", "conversation", "new"],
        action: () => void goto("/chat"),
      },
      {
        id: "nav:runs",
        label: "Runs",
        description: "Browse all agent runs",
        icon: "runs",
        keywords: ["runs", "trace", "history"],
        action: () => void goto("/runs"),
      },
      {
        id: "nav:lab",
        label: "Open Lab",
        description: "Build and configure agents",
        icon: "lab",
        keywords: ["lab", "builder", "configure"],
        action: () => void goto("/lab"),
      },
      {
        id: "nav:prompts",
        label: "Prompt Library",
        description: "Manage reusable prompts",
        icon: "book",
        keywords: ["prompts", "library", "templates", "snippets"],
        action: () => {
          void goto("/lab#prompts");
          // Covers the already-on-/lab case where goto() won't remount the page
          window.dispatchEvent(new CustomEvent("cortex:lab-tab", { detail: "prompts" }));
        },
      },
      {
        id: "nav:settings",
        label: "Settings",
        description: "Configure Cortex",
        icon: "settings",
        keywords: ["settings", "config", "preferences"],
        action: () => void goto("/settings"),
      },
    ]);

    // Safety-net reconciliation so deletes/new runs reflect without manual reload
    // even if a WS message is missed during navigation transitions.
    refreshTimer = setInterval(() => {
      void agentStore.refresh();
    }, 5000);

    return () => {
      stopMotion();
      darkQuery.removeEventListener("change", paintTheme);
      window.removeEventListener("keydown", handleGlobalKeydown);
      window.removeEventListener("cortex:toggle-theme", toggleTheme as EventListener);
      window.removeEventListener("focus", refreshAgentsSoon);
      window.removeEventListener("online", refreshAgentsSoon);
      document.removeEventListener("visibilitychange", refreshAgentsSoon);
      wsUnsub?.();
      wsUnsub = null;
      stopApprovalWatcher?.();
      stopApprovalWatcher = null;
      stopInteractionWatcher?.();
      stopInteractionWatcher = null;
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

<div class="h-screen w-screen flex flex-col overflow-hidden bg-canvas text-text">
  <TopBar
    pathname={$page.url.pathname}
    running={runningCount($agentStore, needsYouByRun($agentStore, $pendingApprovals, $pendingInteractions))}
    {isDark}
    onToggleTheme={toggleTheme}
    onOpenPalette={() => commandPalette.open()}
    chatSidebarOpen={$chatSidebarOpen}
    onToggleChatSidebar={() => chatSidebarOpen.update((v) => !v)}
  />

  <main class="flex-1 overflow-hidden min-h-0">
    {@render children()}
  </main>
</div>

<CommandPalette />
<ToastContainer />
<ConfirmHost />
