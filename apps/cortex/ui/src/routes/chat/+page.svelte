<script lang="ts">
  import { onMount } from "svelte";
  import { get } from "svelte/store";
  import { chatStore } from "$lib/stores/chat-store.js";
  import ChatSessionList from "$lib/components/ChatSessionList.svelte";
  import ChatPanel from "$lib/components/ChatPanel.svelte";
  import CortexDeskShell from "$lib/components/CortexDeskShell.svelte";
  import { freshChatPayload } from "$lib/chat-defaults.js";
  import { settings } from "$lib/stores/settings.js";
  import { toast } from "$lib/stores/toast-store.js";

  const chat = $derived($chatStore);

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
  }
</script>

<svelte:head>
  <title>CORTEX — Chat</title>
</svelte:head>

<CortexDeskShell>
  <div class="relative z-10 flex h-full min-h-0 overflow-hidden text-on-surface">
    <div class="w-64 flex-shrink-0 overflow-hidden md:w-72">
      <ChatSessionList
        sessions={chat.sessions}
        activeSessionId={chat.activeSessionId}
        onSelectSession={selectSession}
      />
    </div>

    <div class="flex min-h-0 flex-1 overflow-hidden">
      {#if !chat.activeSessionId}
        <div
          class="flex h-full w-full items-center justify-center backdrop-blur-[6px] bg-surface-container-lowest/75 dark:bg-surface/80"
        >
          <div class="text-center">
            <span
              class="material-symbols-outlined mb-3 block text-4xl text-cyan-700/50 dark:text-secondary/40"
              >chat_bubble_outline</span
            >
            <p class="font-mono text-[11px] text-outline">
              Select or create a session to start chatting
            </p>
          </div>
        </div>
      {:else if chat.loadingSession}
        <div
          class="flex h-full w-full flex-col gap-4 bg-surface-container-lowest/75 p-4 backdrop-blur-[6px] dark:bg-surface/80"
          role="status"
          aria-label="Loading session"
        >
          {#each [["end", "w-2/5"], ["start", "w-3/5"], ["end", "w-1/3"], ["start", "w-1/2"]] as [side, width], i}
            <div class="flex {side === 'end' ? 'justify-end' : 'justify-start'}">
              <div class="chat-skeleton h-14 {width} rounded-lg" style:animation-delay="{i * 120}ms"></div>
            </div>
          {/each}
        </div>
      {:else}
        <ChatPanel
          sessionId={chat.activeSessionId}
          turns={chat.activeTurns}
          sending={chat.sending}
          error={chat.error}
        />
      {/if}
    </div>
  </div>
</CortexDeskShell>
