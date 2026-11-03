<script lang="ts">
  import ChatProposalCard from "$lib/components/ChatProposalCard.svelte";
  import { chatProposalsStore } from "$lib/stores/chat-proposals.js";
  import { toast } from "$lib/stores/toast-store.js";
  import { shouldPollProposals } from "$lib/proposal-view.js";

  interface Props {
    sessionId: string;
    /** A turn is streaming; it may create a proposal, so keep polling. */
    streaming: boolean;
  }
  const { sessionId: sessionIdProp, streaming: streamingProp }: Props = $props();
  // Props arrive as live getters over the whole chat store; $derived compares by value so effects below
  // re-run only when the id/flag really changes, not on every store update.
  const sessionId = $derived(sessionIdProp);
  const streaming = $derived(streamingProp);

  const POLL_MS = 2000;
  const mine = $derived($chatProposalsStore.sessionId === sessionId);
  const proposals = $derived(mine ? $chatProposalsStore.proposals : []);
  const busy = $derived(mine ? $chatProposalsStore.busy : []);

  // New session: drop the other chat's proposals, then load this one's.
  $effect(() => {
    const sid = sessionId;
    chatProposalsStore.reset(sid);
    void chatProposalsStore.load(sid).catch(() => {});
  });

  // Poll only while something can change by itself.
  const polling = $derived(shouldPollProposals(proposals, streaming));
  $effect(() => {
    if (!polling) return;
    const sid = sessionId;
    const t = setInterval(() => void chatProposalsStore.load(sid).catch(() => {}), POLL_MS);
    return () => clearInterval(t);
  });
  // One last read when streaming ends, to catch a proposal created in the final moments.
  let wasStreaming = false;
  $effect(() => {
    if (wasStreaming && !streaming) void chatProposalsStore.load(sessionId).catch(() => {});
    wasStreaming = streaming;
  });

  async function run(verb: "apply" | "dismiss", id: string) {
    try {
      await chatProposalsStore[verb](sessionId, id);
      if (verb === "apply") toast.success("Applied");
    } catch (e) {
      // 422 leaves the error on the card itself; surface it once here too.
      toast.error(`${verb === "apply" ? "Apply" : "Dismiss"} failed`, e instanceof Error ? e.message : String(e));
    }
  }
</script>

{#if proposals.length > 0}
  <div class="flex flex-col gap-2 px-4 pb-3" data-testid="chat-proposals">
    {#each proposals as p (p.id)}
      <ChatProposalCard proposal={p} busy={busy.includes(p.id)} onApply={() => void run("apply", p.id)} onDismiss={() => void run("dismiss", p.id)} />
    {/each}
  </div>
{/if}
