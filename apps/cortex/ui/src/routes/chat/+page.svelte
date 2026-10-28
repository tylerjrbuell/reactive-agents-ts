<script lang="ts">
  import { onMount } from "svelte";
  import { chatStore } from "$lib/stores/chat-store.js";
  import ChatSessionList from "$lib/components/ChatSessionList.svelte";
  import ChatPanel from "$lib/components/ChatPanel.svelte";
  import CortexDeskShell from "$lib/components/CortexDeskShell.svelte";

  const state = $derived($chatStore);

  onMount(async () => {
    await chatStore.loadSessions();
    const params = new URLSearchParams(window.location.search);
    const sessionParam = params.get("session");
    if (sessionParam) void chatStore.selectSession(sessionParam);
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
        sessions={state.sessions}
        activeSessionId={state.activeSessionId}
        onSelectSession={selectSession}
      />
    </div>

    <div class="flex min-h-0 flex-1 overflow-hidden">
      {#if !state.activeSessionId}
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
      {:else if state.loadingSession}
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
          sessionId={state.activeSessionId}
          turns={state.activeTurns}
          sending={state.sending}
          error={state.error}
        />
      {/if}
    </div>
  </div>
</CortexDeskShell>
