<script lang="ts">
  import { onMount } from "svelte";
  import { chatStore } from "$lib/stores/chat-store.js";
  import ChatSessionList from "$lib/components/ChatSessionList.svelte";
  import ChatPanel from "$lib/components/ChatPanel.svelte";

  const state = $derived($chatStore);

  onMount(async () => {
    await chatStore.loadSessions();
  });

  function selectSession(id: string) {
    void chatStore.selectSession(id);
  }
</script>

<svelte:head>
  <title>CORTEX — Chat</title>
</svelte:head>

<div class="cortex-surface flex h-full overflow-hidden text-on-surface">
  <div class="w-64 flex-shrink-0 overflow-hidden md:w-72">
    <ChatSessionList
      sessions={state.sessions}
      activeSessionId={state.activeSessionId}
      onSelectSession={selectSession}
    />
  </div>

  <div class="flex-1 overflow-hidden">
    {#if !state.activeSessionId}
      <div class="flex h-full items-center justify-center bg-[var(--cortex-bg)]">
        <div class="text-center">
          <span class="material-symbols-outlined mb-3 block text-4xl text-[var(--cortex-text-muted)]"
            >chat_bubble_outline</span
          >
          <p class="font-mono text-[11px] text-[var(--cortex-text-muted)]">
            Select or create a session to start chatting
          </p>
        </div>
      </div>
    {:else if state.loadingSession}
      <div class="flex h-full items-center justify-center bg-[var(--cortex-bg)]">
        <p class="font-mono text-[11px] italic text-[var(--cortex-text-muted)]">Loading session…</p>
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
