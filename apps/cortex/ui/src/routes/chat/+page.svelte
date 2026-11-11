<script lang="ts">
  import { onMount } from "svelte";
  import { get } from "svelte/store";
  import { chatStore } from "$lib/stores/chat-store.js";
  import ChatSessionList from "$lib/components/ChatSessionList.svelte";
  import ChatPanel from "$lib/components/ChatPanel.svelte";
  import CortexDeskShell from "$lib/components/CortexDeskShell.svelte";
  import EmptyState from "$lib/components/kit/EmptyState.svelte";
  import { freshChatPayload } from "$lib/chat-defaults.js";
  import { settings } from "$lib/stores/settings.js";
  import { toast } from "$lib/stores/toast-store.js";
  import { chatSidebarOpen } from "$lib/stores/chat-sidebar.js";
  import { setApprovalView } from "$lib/stores/approval-watcher.js";

  const chat = $derived($chatStore);
  // The open chat shows its own approvals inline, so the app-wide toast skips them (approval-surface.ts).
  const openSessionId = $derived(chat.activeSessionId);
  $effect(() => (openSessionId ? setApprovalView({ kind: "chat", sessionId: openSessionId }) : undefined));
  // An open chat with nothing in it yet (the hero state): the only chat state with the ambient orbs.
  const emptyChat = $derived(
    chat.activeSessionId !== null &&
      !chat.loadingSession &&
      chat.activeTurns.length === 0 &&
      chat.activePendingApprovals.length + chat.activePendingInteractions.length === 0,
  );

  let loaded = $state(false);
  let starting = false;
  let startFailed = false;

  onMount(async () => {
    try {
      await chatStore.loadSessions();
    } catch {
      return; // server unreachable: do not invent a session
    }
    loaded = true;
    const params = new URLSearchParams(window.location.search);
    const sessionParam = params.get("session");
    if (sessionParam) {
      void chatStore.selectSession(sessionParam);
    } else if (!get(chatStore).activeSessionId) {
      // Open the most recently used chat instead of an empty "select a session" screen.
      const latest = [...get(chatStore).sessions].sort((x, y) => y.lastUsedAt - x.lastUsedAt)[0];
      if (latest) void chatStore.selectSession(latest.sessionId);
    }
  });

  // No chats yet (first visit, or the last one was deleted): open a fresh one so there is
  // always somewhere to type. A failed start is not retried in a loop.
  $effect(() => {
    if (!loaded || chat.sessions.length > 0 || starting || startFailed) return;
    starting = true;
    settings.init();
    void freshChatPayload(settings.get())
      .then((payload) => chatStore.createSession(payload))
      .catch((e) => {
        startFailed = true;
        toast.error("Couldn't start a chat", e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        starting = false;
      });
  });

  function selectSession(id: string) {
    void chatStore.selectSession(id);
    chatSidebarOpen.set(false);
  }

  let drawerEl = $state<HTMLDivElement | null>(null);
  let wide = $state(true);
  const drawerOpen = $derived($chatSidebarOpen && !wide);

  onMount(() => {
    // Below 1024px the rail is a drawer: at 768 a fixed 264px rail left the transcript ~500px.
    // Keep in step with the lg: classes below and TopBar's `.sidebar-toggle` media query.
    const mq = window.matchMedia("(min-width: 1024px)");
    const sync = () => {
      wide = mq.matches;
      if (wide) chatSidebarOpen.set(false);
    };
    sync();
    mq.addEventListener("change", sync);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && get(chatSidebarOpen)) chatSidebarOpen.set(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      mq.removeEventListener("change", sync);
      window.removeEventListener("keydown", onKey);
      chatSidebarOpen.set(false);
    };
  });

  // Focus moves into the drawer on open; the header toggle takes it back on close.
  $effect(() => {
    if (!drawerOpen || !drawerEl) return;
    drawerEl.querySelector<HTMLElement>("button, [href], input, [tabindex]:not([tabindex='-1'])")?.focus();
    return () => document.getElementById("chat-sidebar-toggle")?.focus();
  });
</script>

<svelte:head>
  <title>Chat · Cortex</title>
</svelte:head>

<!-- Ambient orbs only behind an empty chat (spec 5.2: the one chat state with orbs). -->
<!-- An opaque canvas: the shell's engineering grid belongs behind page headers, never behind a transcript. -->
<CortexDeskShell ambient={emptyChat} class="bg-[var(--cortex-canvas)]">
  <div class="relative z-10 flex h-full min-h-0 overflow-hidden text-[var(--cortex-text)]">
    {#if drawerOpen}
      <button
        type="button"
        class="absolute inset-0 z-20 cursor-default border-0 bg-black/50 lg:hidden"
        aria-label="Close sessions"
        tabindex="-1"
        onclick={() => chatSidebarOpen.set(false)}
      ></button>
    {/if}
    <div
      bind:this={drawerEl}
      id="chat-sidebar"
      inert={!wide && !drawerOpen}
      role={drawerOpen ? "dialog" : undefined}
      aria-label={drawerOpen ? "Chat sessions" : undefined}
      aria-modal={drawerOpen ? "true" : undefined}
      class="absolute inset-y-0 left-0 z-drawer w-[264px] max-w-[85vw] overflow-hidden transition-transform duration-200 lg:static lg:z-auto lg:max-w-none lg:flex-shrink-0 lg:translate-x-0 {drawerOpen ? 'translate-x-0' : '-translate-x-full'}"
    >
      <ChatSessionList
        sessions={chat.sessions}
        activeSessionId={chat.activeSessionId}
        runningSessionId={chat.sending ? chat.activeSessionId : null}
        onSelectSession={selectSession}
      />
    </div>

    <div class="flex min-h-0 min-w-0 flex-1 overflow-hidden">
      {#if !chat.activeSessionId}
        <div class="grid h-full w-full place-items-center">
          <EmptyState icon="chat" title="No chat open" description="Pick a chat on the left, or start a new one there." />
        </div>
      {:else if chat.loadingSession}
        <div class="mx-auto flex h-full w-full max-w-[var(--cortex-chat-col)] flex-col gap-8 px-[var(--cortex-chat-gutter)] py-6" role="status" aria-label="Loading chat">
          {#each [["end", "w-2/5"], ["start", "w-3/5"], ["end", "w-1/3"], ["start", "w-1/2"]] as [side, width], i}
            <div class="flex {side === 'end' ? 'justify-end' : 'justify-start'}">
              <div class="chat-skeleton h-14 {width} rounded-xl" style:animation-delay="{i * 120}ms"></div>
            </div>
          {/each}
        </div>
      {:else}
        <ChatPanel
          sessionId={chat.activeSessionId}
          turns={chat.activeTurns}
          totals={chat.activeTotals}
          todo={chat.activeTodo}
          documentFailures={chat.activeDocumentFailures}
          sending={chat.sending}
          error={chat.error}
        />
      {/if}
    </div>
  </div>
</CortexDeskShell>
